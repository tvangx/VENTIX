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

## S-201 — Quản lý sự kiện của Organizer

Gửi JWT có role `ORGANIZER` và claim `organizer_id`. Các API quản trị lấy tenant
từ JWT. Tài nguyên của tenant khác trả 404.

| Tài nguyên | Đường dẫn collection                            |
| ---------- | ----------------------------------------------- |
| Địa điểm   | `/v1/organizer/venues`                          |
| Sự kiện    | `/v1/organizer/events`                          |
| Hạng vé    | `/v1/organizer/events/{eventId}/ticket-classes` |
| Đợt mở bán | `/v1/organizer/events/{eventId}/sale-phases`    |

Qua Kong, thêm tiền tố `/api/event`. Mỗi collection có GET danh sách và POST tạo.
Thêm `/{id}` để GET chi tiết, PATCH hoặc DELETE. GET danh sách nhận `limit` từ 1
đến 100 (mặc định 20) và `cursor` từ `next_cursor` của trang trước. Tham khảo
Swagger `/docs` hoặc `openapi.json` để xem cấu trúc request và response.

- POST, PATCH và DELETE cần `Idempotency-Key` là UUID. Gửi lại cùng yêu cầu và
  key trả lại kết quả ban đầu. Đổi yêu cầu với cùng key trong tenant trả 409.
- PATCH gửi `version` hiện tại trong JSON cùng các trường cần đổi. DELETE gửi
  `?version=<version>`. Phiên bản cũ hoặc tài nguyên còn tham chiếu trả 409.
- Chỉ sửa/xóa sự kiện và ghi hạng vé, đợt mở bán ở DRAFT hoặc REJECTED. Sửa địa
  điểm bị chặn khi có sự kiện gắn với địa điểm ở trạng thái khác.

Khi nâng cấp dữ liệu S-107, migration tự gán venue cho Organizer nếu tất cả sự
kiện gắn với venue thuộc cùng tenant. Nếu venue chưa có sự kiện hoặc được nhiều
tenant dùng, migration rollback. Chủ dữ liệu cần đối chiếu và thống nhất cách
tách hoặc ánh xạ các venue đó trước khi thử lại.
File rollback `prisma/rollback/event-organizer-crud.sql` dùng cho bản sao kiểm thử đã xác nhận.
