# Identity service

Tạo từ `services/_template` (xem `docs/dev/new-service.md`).

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
