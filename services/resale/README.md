# Resale service

S-304 tạo nền schema niêm yết và kiểm tra giá cho resale_db riêng.

## Chạy local

```bash
cp .env.example .env      # không commit .env
make up                   # từ thư mục gốc repo (Postgres, Kafka, Redis...)
pnpm --filter @ticketing/resale exec prisma migrate deploy
pnpm --filter @ticketing/resale dev
curl localhost:3006/health/ready
```

## Lệnh

| Lệnh                      | Việc                                                          |
| ------------------------- | ------------------------------------------------------------- |
| `dev` / `build` / `start` | chạy watch / biên dịch / chạy bản build                       |
| `lint` / `typecheck`      | ESLint / tsc                                                  |
| `test`                    | unit (`src/**/*.spec.ts`)                                     |
| `test:int`                | integration, Testcontainers (cần Docker)                      |
| `test:conc`               | concurrency (`test/concurrency/*.conc-spec.ts`)               |
| `openapi:export`          | ghi `openapi.json` (commit file này)                          |
| `prisma:migrate:create`   | `prisma migrate dev --create-only --name <mô_tả>` rồi sửa SQL |

## Có sẵn

`/health/live`, `/health/ready` (kiểm tra DB), `/metrics`, `/docs` (Swagger), log JSON có `request_id`/`trace_id`,
lỗi `application/problem+json`, JWT RS256 qua `@ticketing/auth-guard` (mặc định mọi route cần token; dùng `@Public()` để mở).
OpenTelemetry chỉ bật khi đặt `OTEL_EXPORTER_OTLP_ENDPOINT`.

## Khung niêm yết S-304

`GET /v1/listings/me?limit=20&cursor=<uuid>` đọc listing theo subject JWT của người bán, limit 1–100, cursor tăng theo ID.

`POST /v1/listings/quote` nhận `ticket_id`, `ask_price_vnd` (số nguyên VND an toàn, không âm). Service gọi API ví vé S-302 ở `TICKET_SERVICE_URL` bằng JWT caller để lấy giá thực thu và trạng thái vé của owner. Client không truyền giá gốc. Vé khác owner trả 404, vé không ACTIVE trả 409, giá vượt trần trả 422.

Giá tối đa bằng phần nguyên của `original_price_vnd * max_percent / 100`, tính bằng BigInt. Trần mặc định 120%, `price_cap_rules` cho phép siết thấp hơn theo event. Response trả tiền bằng chuỗi số nguyên, tương tự ví vé. Endpoint quote thực hiện đọc và không tạo listing. Luồng tạo listing ACTIVE và freeze vé đồng bộ thuộc S-404.

Client Ticket chặn redirect, dùng timeout tổng 2 giây và tối đa 100 trang × 100 vé. Lỗi schema, lỗi upstream, vòng lặp cursor hoặc vượt giới hạn trả 503. Mọi listing và dữ liệu vé nằm ở DB chủ sở hữu, liên kết qua API/ID.

Schema có CHECK trạng thái/giá/version và partial unique `uq_listing_active_ticket`. SQL dùng numeric khi nhân để tránh tràn bigint. Outbox/Inbox đã có cho task tiếp theo. Giá cap được snapshot tại listing, thay đổi rule sau này cần được xử lý ở luồng S-404.

## Listing và phục hồi S-404

`POST /v1/listings` nhận `{ticket_id,ask_price_vnd}` và UUID `Idempotency-Key`, seller lấy từ JWT. Service gọi freeze nội bộ Ticket để xác minh owner/trạng thái và lấy giá gốc. Cap được đọc lại trước khi tạo ACTIVE. Trả 201 với ListingView, 404 cho vé khác owner/không tồn tại, 409 cho vé/listing không khả dụng hoặc key đổi nội dung, 422 khi vượt cap. Cùng key trả receipt đã lưu.

`POST /v1/listings/:listingId/cancel` cần cùng seller và UUID key, trả 200 với trạng thái đã hủy. Listing SOLD trả 409. Listing CANCELLED/EXPIRED đã có giữ trạng thái hiện hành khi release binding cũ. Create receipt và cancel receipt được giữ theo request, GET me trả trạng thái hiện hành.

`GET /v1/listings?event_id=<uuid>&min_price_vnd=0&max_price_vnd=120000&limit=20&cursor=<uuid>` tìm ACTIVE. Mọi filter đều tùy chọn, limit 1–100. API cần JWT theo mặc định service. Giá response là chuỗi VND.

Cấu hình `INTERNAL_API_KEY` chung với Ticket và `TICKET_SERVICE_URL`. Timeout RPC 2 giây, chặn redirect và xác minh response binding. Thiếu key trả 503 trước khi tạo intent. Khi đã có intent mà mất phản hồi/DB lỗi, API trả `503 LISTING_OPERATION_PENDING`, caller gửi lại cùng key.

`RESALE_RECOVERY_ENABLED=true` bật phục hồi intent, poll mặc định 1000 ms và backoff tối đa 60 giây. `RESALE_WORKERS_ENABLED=true` bật Kafka Inbox TicketRevoked/CheckedIn và Outbox relay qua `KAFKA_BROKERS`. Hai cờ mặc định false. Worker dừng và chờ công việc trước khi đóng DB. Metric `resale_recovery_attempts_total{outcome}` ghi completed/failed/retry. Trace ID được giữ qua intent và Outbox.

Các bảng listing_operations và resale_ticket_invalidations lưu receipt/tombstone. Tạo/hủy listing và sự kiện cùng transaction. Unique ACTIVE và unique operation đang dở theo ticket chống thao tác cạnh tranh. Chi tiết ở ADR-0016 và docs/sequence/resale-listing.md.

## Kiểm thử S-304 và S-404

Unit kiểm tra trần 120%, làm tròn giá lẻ, zero và giá lớn. Integration PostgreSQL 16 qua Testcontainers dùng role resale_user NOSUPERUSER, Ticket HTTP stub có verify JWT thật để kiểm tra owner và pagination. Concurrency 50 insert cùng ticket chỉ tạo được một listing ACTIVE.
