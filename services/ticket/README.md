# Ticket service

## Freeze nội bộ cho resale S-404

`POST /v1/internal/tickets/:ticketId/freeze` và `/unfreeze` nhận `{listing_id,seller_id}`, header UUID `Idempotency-Key` bằng listing_id và `X-Internal-Key`. Env INTERNAL_API_KEY có tối thiểu 16 ký tự, thiếu key chặn endpoint. Giao diện service-to-service trả snapshot giá gốc/event/organizer, trạng thái binding và vé. Xác thực key constant-time theo ADR-0010.

Freeze chỉ áp dụng vé ACTIVE của seller, chặn event đã hủy. Cùng binding FROZEN có thể replay, binding RELEASED trả 409 khi freeze lại. Release theo listing ID giữ tombstone để chặn request freeze đến muộn. Binding khác không mở khóa vé đang giữ. Vé terminal hoặc event đã hủy giữ trạng thái khi release. State/binding và AuditRecorded Outbox cùng transaction, unique partial giữ một binding FROZEN mỗi ticket. Xem ADR-0016 và resale-listing sequence.

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

## Ví vé và QR — S-302

`GET /v1/tickets?limit=20&cursor=<uuid>` trả vé của subject trong JWT. Limit 1–100, cursor tăng theo ID, response có `items` và `next_cursor`. Giá VND trả chuỗi số nguyên để giữ độ chính xác. Danh sách hiển thị trạng thái của vé.

`GET /v1/tickets/{ticketId}/token` chỉ cấp mã cho owner của vé ACTIVE có secret đúng `secret_version`, chưa thu hồi. Response có `token`, `secret_version`, `step_seconds`, `server_time`, `expires_at` và `qr_payload`. FE render chuỗi JSON `qr_payload` thành QR và refresh khi hết hạn. Payload v1 gồm `version`, `ticket_id`, `secret_version`, `token`. Hai endpoint trả `Cache-Control: private, no-store`.

TOTP dùng SHA1, 6 chữ số, mốc Unix và bước 30 giây. Hàm verify chấp nhận lệch ±1 bước theo ADR-0007. Thư viện thuần hỗ trợ SHA256/SHA512 và 8 chữ số phục vụ vector [RFC 6238 Appendix B](https://www.rfc-editor.org/rfc/rfc6238). API cấp token hiện tại dùng secret từ S-301. API provisioning wallet offline thuộc bàn giao riêng. Kiểm tra một lần sử dụng tại cổng nằm ở S-402.

## Thu hồi — S-303

Consumer bổ sung payment.events để nhận RefundCompleted và chuyển vé sang REFUNDED. OrderCancelled với reason EVENT_CANCELLED chuyển vé sang REVOKED. Trạng thái REFUNDED giữ ưu tiên khi cancellation đến sau. Secret được thu hồi và TicketRevoked vào Outbox trong cùng transaction Inbox. Khóa advisory theo order serialize issue/refund/cancel giữa các topic, bảng ticket_order_invalidations chặn confirmation đến sau thu hồi.

Theo [hợp đồng reason #72](https://github.com/tvangx/VENTIX/issues/72), USER_CANCELLED, EXPIRED, LATE_PAYMENT, STOCK_REJECTED, PAYMENT_FAILED được phát nguyên trạng trong TicketRevoked v2. REFUNDED và EVENT_CANCELLED tiếp tục dùng v1. Cập nhật parser consumer trước producer v2 theo PR hợp đồng #74. Tuấn review version và rollout trên PR trước khi triển khai môi trường thật.

## S-401 Gate và gói xác thực Staff

Ticket worker nhận thêm `event.lifecycle`, dựng `ticket_events` để ràng buộc event/organizer. Bật `TICKET_WORKERS_ENABLED=true` với key ring hợp lệ để nhận lifecycle và phát audit Outbox. Event chưa đồng bộ trả `409 EVENT_NOT_READY`, event đã hủy chặn quản lý cổng và tải gói.

Organizer cùng tenant hoặc Admin dùng các API sau. Mỗi POST cần UUID `Idempotency-Key`.

| API                                            | Nội dung                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `POST /v1/gates`                               | `{event_id,name}` tạo cổng                                                      |
| `POST /v1/gates/:gateId/staff`                 | `{staff_user_id}` phân công hoặc kích hoạt lại Staff                            |
| `POST /v1/gates/:gateId/staff/revoke`          | `{staff_user_id}` thu hồi phân công                                             |
| `POST /v1/gates/:gateId/tickets`               | `{ticket_ids:[...]}` gắn 1–1000 vé cùng event vào cổng, chặn vé đã có cổng khác |
| `GET /v1/gates/me?limit=50&cursor=<uuid>`      | Staff xem cổng đang được phân công, giới hạn 1–100                              |
| `POST /v1/gates/:gateId/verification-packages` | Staff gửi `{public_key_pem}` để tải snapshot mã hóa                             |

Staff cần JWT có role `STAFF`, `organizer_id` khớp event và assignment hiện hành. Admin/Organizer quản lý phân công bằng UUID tham chiếu Identity. Role Staff được kiểm tra khi tải. Thu hồi assignment chặn cả replay package đã phát. HTTP dùng `Cache-Control: private, no-store`. Môi trường vận hành cần TLS.

Package dùng định dạng `ticket-verification-v1`, thuật toán `RSA-OAEP-256+A256GCM`. Thiết bị gửi RSA SPKI public key 2048–4096 bit. Mỗi package có khóa AES-256 và nonce 12 byte riêng. Response có `encrypted_key`, `nonce`, `aad`, `ciphertext` dạng base64, cùng `package_id`, `event_id`, `gate_id`, `issued_at`, `expires_at`. Ciphertext nối tag GCM 16 byte, tương thích WebCrypto.

Giải mã `encrypted_key` bằng RSA-OAEP SHA-256, import khóa AES-GCM rồi decrypt với `iv=nonce`, `additionalData=aad`, `tagLength=128`. AAD là UTF-8 JSON array `["ticket-verification-v1", package_id, event_id, gate_id, issued_at, expires_at]`. Client đối chiếu metadata ngoài/AAD/payload và event/cổng đã chọn, kiểm tra hạn dùng trước mỗi lượt quét.

Payload chứa metadata trên, cấu hình `totp={algorithm:"SHA1",digits:6,period_seconds:30,window:1}` và `tickets=[{ticket_id,status,secret_version,secret}]`. Secret là base64, chỉ lấy phiên bản hiện hành chưa thu hồi của vé ACTIVE đúng event/cổng. Tên khách, owner ID và thông tin KYC thuộc các dữ liệu riêng của service.

`TICKET_PACKAGE_TTL_SECONDS` mặc định 600, khoảng 60–1800. `TICKET_PACKAGE_MAX_TICKETS` mặc định 10.000, khoảng 1–100.000. Vượt giới hạn trả `409 PACKAGE_TOO_LARGE`. Thiếu/hỏng secret trả `503 TICKET_SECRET_UNAVAILABLE`. Replay cùng key trả package cũ sau khi xác minh quyền. Hết hạn trả `409 PACKAGE_EXPIRED`, cần key mới. Cùng key khác nội dung trả `409 IDEMPOTENCY_KEY_REUSED`.

V-401 thực hiện private key thiết bị, khóa non-extractable dẫn xuất từ phiên/PIN, IndexedDB mã hóa, xóa khi hết sự kiện/đăng xuất. S-401 kiểm tra crypto bằng WebCrypto trong Node và API trên PostgreSQL/Kafka local. Cửa sổ offline và thu hồi theo ADR-0007, delta thuộc S-403. Chi tiết đề xuất giao diện ở `docs/adr/0015-staff-verification-packages.md`.

## S-402 Check-in online

`POST /v1/check-ins` cần JWT Staff, organizer claim và assignment hiện hành của cổng. Header `Idempotency-Key` là UUID. Body dùng QR từ wallet S-302.

```json
{
  "event_id": "<event UUID>",
  "gate_id": "<gate UUID>",
  "qr": {
    "version": 1,
    "ticket_id": "<ticket UUID>",
    "secret_version": 1,
    "token": "123456"
  }
}
```

Response HTTP 200 có `scan_id`, `ticket_id`, `result`, `scanned_at`. Các result gồm `ACCEPTED`, `DUPLICATE`, `WRONG_EVENT`, `WRONG_GATE`, `INVALID`. Vé FROZEN/REVOKED/REFUNDED, sai TOTP hoặc secret_version trả INVALID. Vé đã CHECKED_IN trả DUPLICATE. Giờ xác thực lấy từ PostgreSQL, TOTP SHA1 6 chữ số, bước 30 giây, cửa sổ ±1.

Thiếu/hỏng secret hiện hành trả `503 TICKET_SECRET_UNAVAILABLE`. Sai quyền trả 403, event/gate không khớp hoặc event hủy trả 409. Input QR sai cấu trúc hoặc thiếu key trả 400. Cùng key khác nội dung trả `409 IDEMPOTENCY_KEY_REUSED`. Replay cùng key trả cùng scan_id và kết quả sau khi kiểm tra quyền hiện hành, tạo một lần ghi nhận duy nhất.

Một transaction khóa gate và ticket, cập nhật ACTIVE→CHECKED_IN có điều kiện/version, INSERT `checkin_logs`, thêm `TicketCheckedIn` Outbox và receipt. Index `uq_checkin_accepted` bảo đảm một vé có một log ACCEPTED. Log dùng ID vé nullable để ghi lượt quét ID chưa có trong DB, vẫn giữ `scanned_ticket_id` của request. Token TOTP được dùng để xác thực tại request, log và response chứa ID/kết quả.

`checkin_logs` chỉ INSERT. Migration thu hồi UPDATE/DELETE/TRUNCATE của ticket_user và có trigger append-only. Metric `ticket_online_checkin_responses_total{result}` đếm response đã commit, bao gồm replay. Sự kiện giữ trace/request ID và topic/key theo source `TicketCheckedIn` hiện hành.

## S-403 Đồng bộ offline có HMAC

Sau khi tải verification package, Staff gọi `POST /v1/offline-devices` với `{gate_id,package_id,public_key_pem}` và UUID `Idempotency-Key`. Public key RSA phải khớp key đã dùng tải package của chính Staff/cổng, package còn hạn. Response có `device_id`, `package_id`, `event_id`, `gate_id`, `issued_at`, `expires_at`, `server_time`, `algorithm=HMAC-SHA256`, `encrypted_key`, `oaep_label`.

Mỗi device session có HMAC key 32 byte. Dùng RSA-OAEP SHA-256 với `label=base64decode(oaep_label)` để giải mã `encrypted_key`. Label là UTF-8 JSON array `["ticket-offline-device-v1",device_id,staff_user_id,event_id,gate_id,package_id,issued_at,expires_at]`. Client đối chiếu label với metadata và JWT của mình, rồi import key vào WebCrypto HMAC SHA-256, `extractable=false`. Server lưu key mã hóa AES-GCM với key_id, AAD domain riêng `ticket-offline-device-v1`.

`server_time` là giờ DB hiện hành, được làm mới cả khi replay enrollment. Các trường device/key/package của replay giữ cùng giá trị. Thiết bị tính độ lệch đồng hồ theo server_time tại thời điểm nhận response, dùng giờ đã hiệu chỉnh khi ghi scanned_at và xét TTL. `issued_at`/`expires_at` là cửa sổ quét của package. Timestamp quét phải từ issued_at đến trước expires_at, giới hạn tương lai tối đa 30 giây so với server để bù một bước TOTP. Batch lịch sử được upload sau khi package hết hạn, khi timestamp quét vẫn nằm trong cửa sổ và quyền Staff/tenant/assignment hiện hành hợp lệ.

`POST /v1/offline-sync` nhận `batch_id`, `device_id`, `package_id`, `event_id`, `gate_id`, `scans`, `signature`. Header `Idempotency-Key` bằng batch_id. Batch gồm 1–500 scan, mỗi scan có `scan_id` UUID do thiết bị sinh, `ticket_id`, `secret_version`, `token` 6 số, `scanned_at` UTC dạng `YYYY-MM-DDTHH:mm:ss.sssZ`.

Payload ký HMAC là bytes UTF-8 của JSON array sau, UUID được chuyển chữ thường, các scan giữ thứ tự client.

```text
["ticket-offline-sync-v1",batch_id,device_id,event_id,gate_id,package_id,
 [[scan_id,ticket_id,secret_version,token,scanned_at], ...]]
```

`signature` dùng base64 chuẩn của HMAC-SHA256 32 byte. Chữ ký sai trả `403 INVALID_OFFLINE_SIGNATURE` trước khi ghi batch/log/trạng thái. Context sai trả `409 OFFLINE_CONTEXT_MISMATCH`, timestamp ngoài cửa sổ trả `400 OFFLINE_SCAN_OUTSIDE_WINDOW`. Key mã hóa bị hỏng/thiếu trả `503 OFFLINE_KEY_UNAVAILABLE`.

Response có `batch={batch_id,device_id,record_count,conflict_count,received_at,items}` và `revocations`. Item có `source_scan_id`, `scan_id` server, `ticket_id`, `result`, `scanned_at`, dùng các result của S-402. TOTP được kiểm tra tại timestamp quét đã ký, kết hợp trạng thái/secret_version hiện hành. Hai thiết bị quét cùng vé được ghi ACCEPTED/DUPLICATE theo thứ tự commit. Source scan ID cùng device có nội dung cố định, gửi lại qua batch mới trả log cũ. Đổi nội dung batch/source ID đã có trả `409 OFFLINE_BATCH_ID_REUSED` hoặc `409 OFFLINE_SCAN_ID_REUSED`.

Quyền Staff/tenant/assignment được kiểm tra khi sync và replay. Thu hồi phân công chặn cả hai. Sau event cancel, thiết bị đã đăng ký có thể sync để nhận thu hồi, các lượt quét được ghi INVALID. Nhánh online và enrollment chặn event đã hủy.

`batch` là receipt ổn định, `revocations` lấy mới trong mỗi response kể cả replay. Delta có `revoked_ticket_ids`, `ticket_updates=[{ticket_id,status,secret_version,revoked}]`, `next_cursor`. Client xóa vé có revoked=true và ngừng dùng secret cũ khi version khác, tải package mới khi cần phiên bản hiện hành. Vé ACTIVE từng đổi secret có thể xuất hiện lại với revoked=false và version mới. Những cập nhật lặp được áp dụng idempotent.

Đọc hết delta bằng `GET /v1/offline-devices/:deviceId/revocations?limit=1000&cursor=<uuid>`, giới hạn 1–1000. Mỗi chu kỳ sync mới bắt đầu lại trang đầu để lấy trạng thái hiện hành, tránh bỏ sót transaction commit muộn qua watermark thời gian. Device chỉ đọc delta của cổng được phân công.

Log, chuyển trạng thái, TicketCheckedIn offline=true và receipt batch cùng transaction. Ticket rows khóa theo ID trước khi xử lý batch. Partial unique `uq_offline_source_scan` chống replay, `uq_checkin_accepted` giữ một ACCEPTED mỗi vé. FK batch deferred cho phép INSERT log rồi INSERT receipt batch một lần ở cuối transaction.

Batch append-only có trigger và quyền SQL hạn chế. Cột id được cấp UPDATE riêng để PostgreSQL lấy KEY SHARE khi kiểm tra FK, trigger chặn cả `UPDATE id=id`. Test kiểm tra UPDATE dữ liệu/DELETE bị từ chối và trigger từ chối mọi sửa ID. Quyền khóa hàng này được mô tả trong tài liệu PostgreSQL. [PostgreSQL 16 SELECT](https://www.postgresql.org/docs/16/sql-select.html)

Metric `ticket_offline_scan_responses_total{result}` đếm item trong response đã commit, bao gồm replay. Phần PIN/IndexedDB/hàng đợi và hiển thị conflict ở Staff PWA thuộc V-401/V-402. Vòng đời lưu trữ khóa thiết bị/receipt cần được nhóm thống nhất khi chuẩn bị production.
