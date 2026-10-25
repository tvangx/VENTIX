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
