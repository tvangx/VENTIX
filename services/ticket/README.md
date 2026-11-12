# Ticket service

S-301 phát hành vé từ `OrderConfirmed` theo ADR-0009, dùng `ticket_db` riêng.

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

## Ví vé và QR — S-302

`GET /v1/tickets?limit=20&cursor=<uuid>` trả vé của subject trong JWT. Limit 1–100, cursor tăng theo ID, response có `items` và `next_cursor`. Giá VND trả chuỗi số nguyên để giữ độ chính xác. Danh sách hiển thị trạng thái của vé.

`GET /v1/tickets/{ticketId}/token` chỉ cấp mã cho owner của vé ACTIVE có secret đúng `secret_version`, chưa thu hồi. Response có `token`, `secret_version`, `step_seconds`, `server_time`, `expires_at` và `qr_payload`. FE render chuỗi JSON `qr_payload` thành QR và refresh khi hết hạn. Payload v1 gồm `version`, `ticket_id`, `secret_version`, `token`. Hai endpoint trả `Cache-Control: private, no-store`.

TOTP dùng SHA1, 6 chữ số, mốc Unix và bước 30 giây. Hàm verify chấp nhận lệch ±1 bước theo ADR-0007. Thư viện thuần hỗ trợ SHA256/SHA512 và 8 chữ số phục vụ vector [RFC 6238 Appendix B](https://www.rfc-editor.org/rfc/rfc6238). API cấp token hiện tại dùng secret từ S-301. API provisioning wallet offline thuộc bàn giao riêng. Kiểm tra một lần sử dụng tại cổng nằm ở S-402.

## Draft thu hồi — S-303

Consumer bổ sung payment.events để nhận RefundCompleted và chuyển vé sang REFUNDED. OrderCancelled với reason EVENT_CANCELLED chuyển vé sang REVOKED. Trạng thái REFUNDED giữ ưu tiên khi cancellation đến sau. Secret được thu hồi và TicketRevoked vào Outbox trong cùng transaction Inbox. Khóa advisory theo order serialize issue/refund/cancel giữa các topic, bảng ticket_order_invalidations chặn confirmation đến sau thu hồi.

S-303 đang chờ quyết định [hợp đồng reason #72](https://github.com/tvangx/VENTIX/issues/72). Các reason USER_CANCELLED, EXPIRED, LATE_PAYMENT, STOCK_REJECTED, PAYMENT_FAILED hiện đi DLQ với TICKET_REVOCATION_REASON_CONTRACT_PENDING. Cần hoàn tất hợp đồng và test cho các reason này trước merge hoặc vận hành draft.
