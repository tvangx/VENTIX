# **SERVICE** service

Tạo từ `services/_template` (xem `docs/dev/new-service.md`).

## Chạy local

```bash
cp .env.example .env      # không commit .env
make up                   # từ thư mục gốc repo (Postgres, Kafka, Redis...)
pnpm --filter @ticketing/finance dev
curl localhost:3009/health/ready
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
