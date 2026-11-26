# **SERVICE** service

Tạo từ `services/_template` (xem `docs/dev/new-service.md`).

## Chạy local

```bash
cp .env.example .env      # không commit .env
make up                   # từ thư mục gốc repo (Postgres, Kafka, Redis...)
pnpm --filter @ticketing/__SERVICE__ dev
curl localhost:__PORT__/health/ready
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

## Gi?m s?t HTTP (T-404)

`/metrics` xu?t histogram `http_server_request_duration_seconds{service,method,route,status_class}` thay t?n HTTP c? `http_request_duration_seconds`. Route l? m?u ??ng k?; URL kh?ng kh?p d?ng `unmatched`, kh?ng g?n ID/raw URL v?o nh?n. Middleware global ghi m?i response ho?n t?t m?t l?n, bao g?m l?i guard/filter v? 404; l??t scrape kh?ng ???c t?nh. Metric nghi?p v? v? endpoint hi?n c? gi? nguy?n.

Prometheus/Grafana, rollout backend v? ch?n metrics qua Kong: [runbook observability](../../docs/ops/observability.md). Kh?ng public `/metrics`.
