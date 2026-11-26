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

## Giám sát HTTP (T-404)

`/metrics` xuất histogram `http_server_request_duration_seconds{service,method,route,status_class}` thay tên HTTP cũ `http_request_duration_seconds`. Route là mẫu đăng ký; URL không khớp dùng `unmatched`, không gắn ID/raw URL vào nhãn. Middleware global ghi mỗi response hoàn tất một lần, bao gồm lỗi guard/filter và 404; lượt scrape không được tính. Metric nghiệp vụ và endpoint hiện có giữ nguyên.

Prometheus/Grafana, rollout backend và chặn metrics qua Kong: [runbook observability](../../docs/ops/observability.md). Không public `/metrics`.
