# Ticket service

S-301 phát hành vé từ `OrderConfirmed` theo ADR-0009, dùng `ticket_db` riêng.

## Tra cứu công khai — S-503

- Mở `http://localhost:3005/v1/verify`, nhập UUID vé; trang HTML không cần đăng nhập hoặc JavaScript.
- API `GET /v1/public/tickets/:ticketId` trả ticket_id/status/active và nft status/provider/token_id/tx_hash. Không trả owner/order/secret/giá/PII. ACTIVE không chứng minh quyền sở hữu và không thay TOTP/check-in.
- Query đọc trạng thái hiện tại, `Cache-Control: no-store`. UUID sai trả 400, không tìm thấy trả 404, quá giới hạn trả 429 + Retry-After; API lỗi theo problem+json. Cả trang và API dùng noindex/no-referrer.
- MOCK luôn có tx_hash NULL và giao diện ghi rõ mô phỏng. NFT FAILED không làm vé ACTIVE vô hiệu. Phụ thuộc schema nft_mints từ S-502; không có on-chain tx thật trong bản mock.
- Rate limit mặc định 60 request/socket peer và 1000 request/process trong 60 giây, map tối đa 10.000 peer. Các biến VERIFY_RATE_* nằm trong env schema/example. Không tin X-Forwarded-For từ client. Khi qua proxy, peer là proxy nên dùng chung giới hạn; nhiều replica có bộ đếm riêng. Cần nhóm hạ tầng cấu hình hạn mức gateway khi public qua Kong, đây không phải distributed per-user limiter.
- HTTP test dùng DB thật cho từng status và không rò dữ liệu; concurrency 50 request kiểm tra 429 và header giả. UI nằm trong Ticket, không sửa apps/web/staff-pwa hoặc route Kong.

## Chạy local

```bash
cp .env.example .env      # không commit .env
make up                   # từ thư mục gốc repo (Postgres, Kafka, Redis...)
pnpm --filter @ticketing/ticket exec prisma migrate deploy
pnpm --filter @ticketing/ticket dev
curl localhost:3005/health/ready
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

`GET /v1/whoami` vẫn là endpoint mẫu; S-301 không thêm hoặc sửa API công khai.

## Phát hành vé

- Bật `TICKET_WORKERS_ENABLED=true`, cấu hình `KAFKA_BROKERS`, `TICKET_ENCRYPTION_KEYS` (JSON key ring), `TICKET_ACTIVE_KEY_ID` khớp key ring. Mỗi khóa là 32 byte mã hóa base64 chuẩn. Thiếu/sai khóa khi bật worker sẽ fail-fast.
- Tạo khóa local bằng `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"`, đưa vào `.env` riêng. Không commit khóa hoặc dùng khóa test ở production.
- Consumer group/Inbox cố định `ticket-issuance-v1`, chỉ subscribe `booking.orders`. `PaymentSucceeded` không kích hoạt phát vé.
- `TICKET_SEAT` có một vé; `TICKET_GA` có `quantity` vé. `MERCH` không phát vé. Khóa duy nhất `(order_item_id, unit_index)` bảo đảm phát đủ GA khi replay; partial unique `(event_id, seat_id)` chặn hai vé còn hiệu lực cho một ghế.
- Trong một transaction: Inbox → `ticket_issuances` → `tickets` → `ticket_secrets` → Outbox `TicketIssued`. Relay publish `ticket.events`, key `ticket_id`, giữ trace/tenant từ message đầu vào. Không có FK/JOIN/API sang DB khác.
- Receipt `ticket_issuances` dùng `order_id` làm khóa tự nhiên và fingerprint nội dung đã chuẩn hóa thứ tự item. Replay bằng message ID khác vẫn không phát lại; cùng order nhưng khác nội dung bị đưa DLQ. Bản ghi Inbox cũng rollback khi nghiệp vụ thất bại.
- Sai schema hoặc dữ liệu bất biến xung đột đi DLQ; lỗi tạm thời dùng retry/backoff của `outbox-inbox`. DLQ `booking.orders.dlq` cần được giám sát và replay sau xử lý nguyên nhân.
- `unit_price_vnd` là giá thực thu theo hợp đồng; `ref_id` là ghế hoặc hạng GA. Không suy diễn hạng vé SEATED hoặc organizer khi envelope không có tenant.

## Secret và vận hành

Mỗi vé có secret ngẫu nhiên 20 byte độc lập, version 1. `secret_enc` lưu nonce 12 byte + authentication tag 16 byte + ciphertext AES-256-GCM; AAD gắn ticket ID, secret version và key ID. Secret không đưa vào Kafka, HTTP hoặc log. Giữ khóa cũ trong key ring khi đổi active key để vẫn giải mã được vé cũ; script xoay mã hóa toàn bộ dữ liệu thuộc S-504.

Metric `ticket_issuance_attempts_total` đếm lượt handler trước commit; metric Outbox dùng thư viện chung. Khi shutdown, worker/relay dừng trước pool nghiệp vụ. Mặc định worker tắt để export OpenAPI và khởi động template không cần Kafka; muốn phát vé phải bật rõ ràng.

## Kiểm thử S-301

Chạy `test`, `test:int`, `test:conc` trong bảng lệnh. Integration/concurrency dùng PostgreSQL 16 riêng với role `ticket_user` NOSUPERUSER; worker integration dùng Kafka 3.8.0 riêng qua Testcontainers. Bao phủ GA, duplicate message/business key, rollback Outbox, xác thực ciphertext, key rotation và 50 tác vụ đồng thời. TOTP/QR, hoàn vé, gate/check-in, resale và NFT thuộc task tiếp theo.

# NFT worker — S-502

Sau migration, đặt `NFT_WORKER_ENABLED=true`, `NFT_PROVIDER=MOCK` và `KAFKA_BROKERS` để bật consumer riêng `ticket-nft-v1`. Cờ này độc lập với `TICKET_WORKERS_ENABLED`; phát hành vé vẫn cần key ring S-301. Mặc định worker NFT tắt.

Consumer nhận TicketIssued v1, ghi durable job và Inbox cùng transaction. Poller xử lý từng job ngoài transaction phát hành; lease/version bảo vệ nhiều replica và restart. Timeout mặc định 10 giây, lease 30 giây, tối đa 5 attempts, retry có jitter từ 1 tới 60 giây. Xem toàn bộ biến trong `.env.example`; schema chặn lease không lớn hơn timeout hoặc provider chưa hỗ trợ.

Kết quả nằm ở `nft_mints`: provider MOCK, tx_hash NULL, token_id/metadata_uri/mock_reference riêng. Đây là mô phỏng local, không phải NFT on-chain. Lỗi mint không thay đổi trạng thái hoặc secret của vé. Log có request_id/trace_id; metric `ticket_nft_attempts_total{outcome}` có nhãn hữu hạn. FAILED và LEASE_EXPIRED phải được điều tra, chưa có API replay quản trị.

Kiểm thử bằng `pnpm --filter @ticketing/ticket test:int` và `test:conc` (Docker/Testcontainers), cùng unit `test --runInBand`. Test dùng PostgreSQL 16/Kafka thật và dữ liệu giả. Luồng, schema, giới hạn và đánh giá ERC-721/Amoy/Pinata nằm trong [sequence NFT](../../docs/sequence/nft-mint.md).
