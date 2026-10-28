# Booking service — T-201

Scaffold có sẵn từ T-102, cổng 3003. T-201 thêm schema `booking_db`; chưa triển khai Lua, holds, checkout hoặc consumer Kafka. Health, JWT, log JSON, metrics và endpoint mẫu `/v1/whoami` được giữ từ template.

## Chạy local

Từ thư mục gốc repo:

```bash
make up && make verify
cp services/booking/.env.example services/booking/.env
pnpm --filter @ticketing/booking exec prisma migrate deploy
pnpm --filter @ticketing/booking dev
```

Prisma CLI đọc `.env` trong thư mục service. Không commit `.env`. `DATABASE_URL` phải trỏ tới `booking_db` bằng `booking_user`; env schema từ chối user/DB khác. Không dùng user `postgres`, không FK hoặc JOIN sang DB service khác.

## Schema và ràng buộc

| Bảng                  | Vai trò / khóa                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `orders`              | UUID, tiền bigint VND, idempotency key unique, timestamps và version                                  |
| `order_items`         | FK order; CHECK chỉ `TICKET_SEAT`, `TICKET_GA`, `MERCH`                                               |
| `seat_allocations`    | FK order; CHECK `HELD`, `SOLD`, `RELEASED`; unique theo event/seat khi active                         |
| `ticket_class_stock`  | PK `class_id`; CHECK `0 <= sold <= total`                                                             |
| `event_snapshots`     | PK `event_id`; event/seat-map version, ticket_classes/sale_window JSONB; pricing_ready mặc định false |
| `seat_pricing`        | PK `(event_id, seat_id)`; index `(event_id, seat_map_version)`                                        |
| `vouchers`            | UUID, code unique, discount/max uses/expiry; chưa có API voucher                                      |
| `voucher_redemptions` | PK `(voucher_id, order_id)`, FK nội bộ tới voucher/order                                              |
| `idempotency_keys`    | PK key, user_id, request_hash, response JSONB, created_at                                             |
| `outbox_events`       | SQL dùng chung; index chưa publish theo created_at                                                    |
| `processed_events`    | SQL dùng chung; PK `(message_id, consumer)`                                                           |

Khóa tự nhiên/khóa kép giữ theo ERD; không thêm UUID id thay thế cho các khóa này. ID UUID do ứng dụng cấp (UUIDv7 theo kiến trúc). Bảng nghiệp vụ có created_at; order/allocation/stock/voucher có updated_at + version. Với raw SQL, bên ghi phải tự tăng version và cập nhật updated_at; `@updatedAt` chỉ do Prisma Client xử lý.

`prisma/migrations/20261028152531_booking_schema/migration.sql` được tạo bằng `prisma migrate dev --create-only --name booking_schema`, sau đó sửa tay. File giữ nguyên khối SQL T-201: `uq_seat_active`, CHECK trạng thái/type/stock, index expiry/user/seat pricing. Prisma không biểu diễn partial index/CHECK đầy đủ; migration sau phải review SQL và giữ các ràng buộc này. Migration bao trong transaction; SQL lỗi sẽ rollback DDL.

ERD kiến trúc §5.3 còn liệt kê COMBO. Tuấn đã xác nhận dùng CHECK T-201 loại COMBO, giữ nguyên ERD trong task này. `REFUND_REQUIRED` được cho phép theo ADR-0009; CHECK kiểm tra tập trạng thái, logic chuyển trạng thái có điều kiện thuộc các task saga sau.

Client sinh riêng ở `generated/prisma` (không commit, tránh ghi đè client của service khác).

## Migration tiếp theo và rollback

```bash
pnpm --filter @ticketing/booking prisma:migrate:create --name <name>
# Mở migration MỚI, bổ sung SQL tay và review trước khi áp dụng.
```

`booking_user` local không có CREATEDB. Để dùng `migrate dev`, chạy trên Postgres development tạm với booking_user được cấp CREATEDB cho shadow DB; không cấp quyền này cho runtime/prod. T-201 tạo migration trên Testcontainers tạm, không đổi quyền user local. Production chỉ dùng `migrate deploy`.

Trước khi migrate môi trường có dữ liệu, sao lưu riêng booking_db. Migration đầu tiên chỉ thêm schema; rollback deploy bằng cách quay về bản ứng dụng trước và giữ schema. Nếu cần khôi phục DB, Tuấn phê duyệt thao tác và phục hồi backup booking_db; không chạy reset/drop tự động, không chỉnh migration đã áp dụng.

## Kiểm chứng

```bash
pnpm --filter @ticketing/booking lint
pnpm --filter @ticketing/booking typecheck
pnpm --filter @ticketing/booking test
pnpm --filter @ticketing/booking test:int
pnpm --filter @ticketing/booking test:conc
pnpm --filter @ticketing/booking openapi:export
pnpm format:check && pnpm build
```

Integration/concurrency cần Docker, dùng image `postgres:16` đã có trong template; role bootstrap chỉ khởi tạo container test, mọi migration/SQL kiểm chứng schema chạy bằng booking_user NOSUPERUSER NOCREATEDB. Test tự tạo DB rỗng và áp dụng migration bằng Prisma, không dùng DB local. Concurrency chạy 50 insert: đúng 1 thành công, 49 lỗi 23505. Chi tiết số liệu: [run report T-201](../../docs/agent/runs/T-201.md).
