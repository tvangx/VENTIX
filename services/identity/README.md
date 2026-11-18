# Identity service

Tạo từ `services/_template` (xem `docs/dev/new-service.md`).

## Xoay khóa mã hóa KYC (S-504)

Thêm khóa mới vào `KYC_ENCRYPTION_KEYS` của mọi instance, sau đó đặt `KYC_ACTIVE_KEY_ID` thành ID mới. Giữ `KYC_HMAC_PEPPER` và khóa cũ. Mỗi ID phải luôn trỏ tới cùng một khóa.

```bash
pnpm --filter @ticketing/identity build
pnpm --filter @ticketing/identity keys:rotate
pnpm --filter @ticketing/identity keys:rotate --apply
pnpm --filter @ticketing/identity keys:rotate
```

Lệnh mặc định đọc và thử giải mã hồ sơ dùng khóa khác active key. `--apply` chỉ cập nhật ciphertext của hai trường cùng với `key_id` và version trong một lần ghi. Chạy lại được nếu bị gián đoạn. Khi có xung đột, kiểm tra lại và chạy tiếp với cùng active key. Sau khi đóng mọi writer cũ, lượt cuối phải có `checked: 0`. Giữ khóa cũ cho OTP mang ciphertext còn hiệu lực và bản sao lưu còn trong thời hạn lưu giữ.

## Chạy local

```bash
cp .env.example .env      # không commit .env
make up                   # từ thư mục gốc repo (Postgres, Kafka, Redis...)
pnpm --filter @ticketing/identity dev
curl localhost:3001/health/ready
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

`GET /v1/whoami` là endpoint mẫu: xóa khi viết module thật.

## S-101 — Cơ sở dữ liệu

`prisma/schema.prisma` triển khai ERD mục 5.1: users, oauth_accounts,
refresh_tokens (chỉ hash SHA-256; có family_id), roles, user_roles,
kyc_profiles (chỉ ciphertext/HMAC/key_id), organizers, organizer_documents.
Outbox/Inbox giữ cấu trúc thư viện dùng chung. Client Prisma sinh riêng trong
`generated/client` và không commit.

```bash
pnpm --filter @ticketing/identity prisma:migrate:deploy
pnpm --filter @ticketing/identity exec prisma generate
pnpm --filter @ticketing/identity seed
pnpm --filter @ticketing/identity test:int
```

Seed tạo đúng 4 role USER, ORGANIZER, STAFF, ADMIN, chạy lại an toàn; chưa tạo tài
khoản Admin (S-104). Role ORGANIZER/STAFF phải có organizer_id, USER/ADMIN không
có scope. Theo khóa ghép ERD, mỗi user chỉ có một scope cho mỗi role.

Integration mặc định dùng Testcontainers postgres:16. Có thể đặt TEST_DATABASE_URL
trỏ tới PostgreSQL kiểm thử riêng với user có CREATEDB: mỗi suite tạo DB tên ngẫu
nhiên, chạy migration/seed và xóa đúng DB đó khi kết thúc. Không dùng DB chứa dữ
liệu thật. Rollback kiểm thử nằm ở prisma/rollback/identity-init.sql; rollback
sẽ xóa dữ liệu Identity và chỉ được chạy sau khi xác nhận DB đích.

## S-102 — Đăng nhập email

- `POST /v1/auth/register`: body email/password (12–128 ký tự), header Idempotency-Key UUID; trả id/email, không tạo phiên. Cùng key/body trả cùng kết quả, đổi body trả 409.
- `POST /v1/auth/login`: body email/password; trả access_token, token_type, expires_in và cookie ventix_refresh HttpOnly, SameSite=Lax, Secure ở production.
- `POST /v1/auth/refresh`: dùng cookie, không có body. Mỗi lần đổi token; dùng lại token cũ thu hồi cả family và trả 401. Client phải gom các lần refresh đồng thời.
- `POST /v1/auth/logout`: thu hồi family của cookie và xóa cookie, 204; access JWT đã phát còn hiệu lực tối đa ACCESS_TOKEN_TTL_SECONDS.
- `GET /.well-known/jwks.json`: public RSA JWK (RS256, kid), không có trường private key. Qua gateway: `/api/identity/.well-known/jwks.json`.

Client dùng credentials/include khi gọi cookie API. Chỉ WEB_ORIGIN được CORS; session API từ Origin khác bị 403. Refresh token không trả trong JSON, không đưa vào localStorage. DB chỉ lưu SHA-256 refresh token; reuse xử lý và commit thu hồi trước khi báo lỗi.

Production bắt buộc JWT_PRIVATE_KEY_PEM là PKCS8 RSA ≥2048 bits. Dev/test không đặt biến sinh khóa tạm, restart làm access JWT cũ mất hiệu lực và key đăng ký cũ có thể trả 409 (fingerprint HMAC phụ thuộc khóa). Để dev ổn định, đặt khóa riêng trong `.env` không commit. JWKS hiện có một khóa; chưa có giai đoạn giữ đồng thời khóa cũ/mới khi xoay khóa.

Argon2 0.41.1 được ghim vì hỗ trợ Node 20, giấy phép MIT, có native binary Windows/Linux. jose chuyển từ devDependency sang runtime dependency. Không thêm thư viện hashing khác.

## S-103 — Google OAuth

Cấu hình GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI trong `.env`.
Google Cloud Console cần đăng ký redirect URI khớp chính xác (dev mặc định
http://localhost:3001/v1/auth/google/callback, hoặc URL gateway tương ứng).
Production bắt buộc HTTPS. Không có credentials thì Google start trả 503,
các luồng email vẫn hoạt động.

1. GET `/v1/auth/google/start` với credentials/include: nhận authorization_url và
   cookie ventix_oauth HttpOnly. Trình duyệt chuyển đến URL Google.
2. Google callback về service: kiểm tra state/cookie TTL 10 phút, consume một lần,
   exchange code với PKCE S256, verify ID token RS256/issuer/audience/exp/nonce/email_verified.
3. Đặt refresh cookie, redirect về WEB_ORIGIN/auth/callback?provider=google.
   Frontend gọi POST auth/refresh để lấy access token vào bộ nhớ.

Nếu email đã tồn tại chưa link: trả ACCOUNT_LINK_REQUIRED (409). Người dùng login
bằng email trước, gọi GET `/v1/auth/google/link` với Bearer JWT rồi đi theo URL
trả về để liên kết; email Google phải trùng tài khoản đó. Không tự gộp theo email.
Record state chỉ lưu hash; không lưu Google access/refresh token. Dọn record state
hết hạn là tác vụ vận hành định kỳ, không ảnh hưởng việc từ chối state hết hạn.

Tài liệu đối chiếu: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## S-104 — Quyền và tenant

GET `/v1/auth/me` với Bearer token trả global roles và memberships còn hiệu lực.
POST `/v1/auth/tenants/{organizerId}/token` trả access token mới có organizer_id
và chỉ các role global + role thuộc organizer đã chọn. Organizer phải APPROVED.
Token đăng nhập ban đầu không có scope ORGANIZER/STAFF; refresh trả lại token global,
client chọn lại tenant sau khi refresh.

GET `/v1/organizers/{organizerId}/context` yêu cầu role ORGANIZER hoặc STAFF, scope
trùng path và membership hiện còn trong DB. User bị suspend hoặc quyền bị thu hồi
không dùng lại token tenant cũ để truy cập được. Không có bypass tenant cho ADMIN;
Admin dùng các API `/v1/admin/*` riêng.

Bootstrap Admin: cấu hình ADMIN_EMAIL, ADMIN_PASSWORD (12–128 ký tự) trong `.env`,
chạy `pnpm --filter @ticketing/identity seed` rồi
`pnpm --filter @ticketing/identity seed:admin`. Không có default password.
Chạy lại giữ mật khẩu hiện có, chỉ bảo đảm role ADMIN; không tái kích hoạt user suspend.

## S-105 — Hồ sơ Organizer và giấy phép

- POST `/v1/organizer-applications` (Bearer + Idempotency-Key UUID): company_name,
  tax_code tùy chọn; tạo PENDING và chưa cấp role.
- GET `/v1/organizer-applications/{id}`: owner hoặc Admin xem hồ sơ/documents.
- POST `/v1/organizer-applications/{id}/documents`: multipart file +
  doc_type=BUSINESS_LICENSE, Bearer của owner + Idempotency-Key. Chỉ PENDING;
  PDF/PNG/JPEG đúng magic/MIME, tối đa 1 MiB. Retry cùng key/file không upload trùng.
- GET `/v1/organizer-applications/{id}/documents/{documentId}/download`: owner/Admin,
  trả URL tải attachment có chữ ký, hiệu lực 60 giây. Bucket organizer-docs phải private.
- GET `/v1/admin/organizer-applications?status=PENDING&limit=20&cursor={uuid}`:
  Admin, next_cursor hoặc null, tối đa 100 dòng.
- PATCH `/v1/admin/organizer-applications/{id}`: Admin, body decision
  (APPROVED/REJECTED) và version. Chỉ PENDING đúng version được xử lý; approved
  phải có giấy phép và cấp scope ORGANIZER trong cùng transaction. Hai request
  đồng thời chỉ một thành công, request còn lại 409.

MINIO_ENDPOINT, MINIO_BUCKET, MINIO_ACCESS_KEY, MINIO_SECRET_KEY cấu hình ở service.
Dev values trong `.env.example` khớp compose; production cấp key riêng chỉ có
quyền bucket organizer-docs. Thiếu cấu hình/lỗi storage trả 503, DB không có document
giả. I/O bị hủy sau 5 giây; transaction tối đa 15 giây để bao gồm SDK retry/backoff.
Upload thành công nhưng DB commit lỗi có thể để object mồ côi; retry cùng key dùng
lại object key an toàn. Chưa có tác vụ dọn object mồ côi.

ERD hiện chỉ cho một scope ORGANIZER/user; duyệt hồ sơ thứ hai không chuyển quyền
khỏi hồ sơ trước mà trả ORGANIZER_SCOPE_CONFLICT. Chưa phát OrganizerApproved
vì event-contracts hiện không có loại sự kiện Identity; thêm cần review contract riêng.

`test:int` kiểm tra HTTP/DB với storage adapter giả, và hủy HTTP upstream bị treo.
`test:storage` dùng MinIO thật qua Testcontainers, kiểm tra bytes và bucket private;
chạy riêng vì cần Docker và image MinIO hạ tầng hiện có.

## S-106 — OpenAPI và request mẫu

`pnpm --filter @ticketing/identity openapi:export` sinh spec từ app thật;
`openapi.json` được commit để Vũ sinh client. Bộ Postman 18 request và environment
trống mật khẩu nằm ở `docs/api/identity/`, cùng hướng dẫn cookie, tenant, Google
callback và upload. Không cần DB để export OpenAPI.

## KYC qua email — S-305

Bật `KYC_ENABLED=true` và cấu hình `KYC_REDIS_URL`, `KYC_ENCRYPTION_KEYS` (JSON key ring base64 32 byte), `KYC_ACTIVE_KEY_ID`, `KYC_HMAC_PEPPER` (khóa 32 byte riêng), cùng SMTP theo `.env.example`. Mặc định KYC tắt, các endpoint KYC trả 503 nếu chưa cấu hình. Production yêu cầu SMTP TLS bằng `KYC_SMTP_SECURE=true` hoặc STARTTLS bắt buộc qua `KYC_SMTP_REQUIRE_TLS=true`.

- `POST /v1/kyc/challenges` nhận `id_number` 12 chữ số và `full_name`, yêu cầu JWT và `Idempotency-Key` UUID. OTP 6 chữ số gửi tới email của user ACTIVE trong DB. Không nhận địa chỉ nhận từ client. Response chỉ có `challenge_id` và `expires_at`.
- `POST /v1/kyc/verify` nhận `challenge_id` và `code`, yêu cầu JWT và `Idempotency-Key`. OTP đúng tạo hồ sơ, xác nhận email và ghi AuditRecorded Outbox trong cùng transaction. Unique HMAC trong DB chặn cùng CCCD trên nhiều tài khoản. Hồ sơ đã verified giữ nguyên định danh.
- `GET /v1/kyc/me` trả `verified` và `kycHash` của caller. `GET /v1/internal/users/{userId}/kyc` dùng `X-Internal-Key` từ `INTERNAL_API_KEY`, phục vụ giới hạn vé qua API. Backend gọi trực tiếp trong mạng nội bộ, áp dụng chặn `/internal` ở Kong theo ADR-0010.

OTP có TTL mặc định 300 giây, cooldown 60 giây, tối đa 5 lần thử. Tạo challenge cùng idempotency key/nội dung trong TTL giữ nguyên challenge và không gửi lại email. Key trùng nhưng khác nội dung trả 409. Lỗi SMTP vô hiệu challenge và giữ cooldown. OTP chỉ dùng sau khi SMTP xác nhận gửi. Chứng cứ consume trong DB và kết quả idempotent bảo đảm retry sau commit dù Redis đã xóa hoặc hết hạn, đồng thời chặn dùng lại với key mới.

CCCD/tên và payload Redis mã hóa AES-256-GCM, nonce ngẫu nhiên, AAD gắn user/field/key ID. Redis chỉ giữ HMAC OTP. Giữ khóa cũ trong key ring khi chuyển active key, giữ pepper HMAC ổn định để bảo toàn uniqueness. Không có endpoint xuất PII plaintext. KYC trong task này xác minh quyền truy cập email và dữ liệu tự khai, tích hợp đối soát giấy tờ/eKYC chưa được định nghĩa.

Bật `IDENTITY_OUTBOX_ENABLED=true` và cấu hình `KAFKA_BROKERS` để relay AuditRecorded sang Kafka. Khi relay tắt, sự kiện nằm bền vững trong Outbox. Relay dùng pool riêng và dừng trước khi đóng pool.

Local dùng Mailpit SMTP ở `127.0.0.1:11025` theo stack VENTIX hiện tại. Test dùng container riêng với image `KYC_TEST_MAILPIT_IMAGE=axllent/mailpit:v1.33.0` đã pull thành công. Có thể thay hostname/port bằng SMTP dev của bạn. Nodemailer tắt debug/file/URL content access và đặt timeout kết nối, theo [tài liệu SMTP](https://nodemailer.com/smtp).

Run report ở `docs/agent/runs/S-305.md`. Test KYC dùng PostgreSQL 16, Redis 7.4, Mailpit và Kafka thật, với dữ liệu tổng hợp.
