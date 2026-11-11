# Event service

Tạo từ `services/_template` (xem `docs/dev/new-service.md`).

## Chạy local

```bash
cp .env.example .env      # không commit .env
make up                   # từ thư mục gốc repo (Postgres, Kafka, Redis...)
pnpm --filter @ticketing/event dev
curl localhost:3002/health/ready
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

## S-107 — Schema và migration

Chín bảng nghiệp vụ theo architecture-v2 mục 5.2: venues, events, ticket_classes,
sale_phases, seat_maps, zones, blocks, seats, event_approvals; thêm Outbox/Inbox
chuẩn. ERD và quyết định ràng buộc ở `docs/erd/event.md`.

```bash
pnpm --filter @ticketing/event prisma:migrate:deploy
pnpm --filter @ticketing/event exec prisma generate
pnpm --filter @ticketing/event test:int
```

Dùng event_user/event_db riêng; organizer_id và admin_id không có FK sang Identity.
Client Prisma sinh trong generated/client của Event để không ghi đè Identity.
Migration có CHECK thời gian/trạng thái/giá/capacity, FK ghép bảo vệ event của ghế,
unique tọa độ ghế và version map. Map đã publish và hierarchy không được thay đổi
(SQL trigger, serialize theo event). CRUD/validate layout/sinh 10k ghế nằm ở tuần 2.

Testcontainers postgres:16 là mặc định. TEST_DATABASE_URL cho phép kiểm thử trên
PostgreSQL riêng với event_user có CREATEDB; mỗi suite tạo/xóa đúng DB ngẫu nhiên
của mình. Rollback `prisma/rollback/event-init.sql` xóa dữ liệu Event, chỉ chạy khi
đã xác nhận DB kiểm thử đích. Không tự chạy rollback trên DB có dữ liệu thật.
