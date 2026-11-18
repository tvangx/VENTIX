# Mock API bằng MSW (V-103)

Giao diện chạy được khi backend chưa xong: MSW chặn request `/api/<service>/...` ngay trong trình duyệt và trả dữ liệu giả **đúng hợp đồng OpenAPI**. Dữ liệu lấy từ seed V-104 (`./seed`).

## Chạy

```bash
pnpm --filter @ticketing/web dev:mock   # bật mock (đọc .env.mock: VITE_API_MOCKING=true)
pnpm --filter @ticketing/web dev        # backend thật qua Kong (localhost:8000)
```

Mock chỉ bật khi `import.meta.env.DEV` **và** `VITE_API_MOCKING=true`, nên bản build production không chứa MSW. Request tới service chưa mock (merch, ticket, resale...) đi thẳng tới Kong như bình thường (`onUnhandledRequest: "bypass"`).

## Tài khoản demo

Mật khẩu chung: `ventix-demo-2026` (chỉ dùng cho mock, không phải secret).

| Email                     | Vai trò                                           |
| ------------------------- | ------------------------------------------------- |
| `user@ventix.test`        | USER; có sẵn 1 hồ sơ organizer `PENDING`          |
| `organizer@ventix.test`   | ORGANIZER của organizer `10000000-…-0001` (seed)  |
| `staff@ventix.test`       | STAFF của organizer `10000000-…-0001`             |
| `admin@ventix.test`       | ADMIN                                             |
| `google.user@ventix.test` | Đăng nhập bằng nút Google (mock không gọi Google) |

Phiên đăng nhập và tài khoản đăng ký mới được lưu trong `localStorage` (`ventix.mock.v1`) để tải lại trang vẫn refresh được; dữ liệu khác (ghế, đơn...) mất khi tải lại.

## Phạm vi

| Service  | Nguồn hợp đồng                   | Ghi chú mock                                                                                                                                                                                                         |
| -------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| event    | `services/event/openapi.json`    | Catalog công khai (V-201): `GET /v1/events` (tìm, lọc ngày/giá/tình trạng, sắp xếp, cursor như backend), `GET /v1/events/{id}`; chỉ sự kiện `PUBLISHED` của seed; `mockConfig.now` là đồng hồ tính tình trạng mở bán |
| identity | `services/identity/openapi.json` | Email/refresh/logout, Google giả, tenant token, hồ sơ organizer + upload + Admin duyệt                                                                                                                               |
| booking  | `services/booking/openapi.json`  | Giữ ghế all-or-nothing, giới hạn/người, checkout idempotent, hàng chờ + SSE, seat-stream SSE                                                                                                                         |
| payment  | `services/payment/openapi.json`  | `MOCK` thành công ngay; `VNPAY` redirect về `/payment/vnpay-return`, gọi return → đơn PAID                                                                                                                           |
| finance  | `services/finance/openapi.json`  | Thống kê organizer (VAT 10% theo ADR-0012), audit, DLQ replay/discard                                                                                                                                                |

Chưa mock: merch, ticket, resale, notification (chưa có OpenAPI). Khi chủ service bàn giao OpenAPI: thêm tên vào `SERVICES` trong `scripts/gen-api.mjs`, chạy `gen:api`, thêm client vào `src/lib/api/index.ts` và handler vào `handlers/`.

Ghế: event-service chưa có seat map, nên `db.ts` sinh ghế tất định theo `capacity` các hạng vé SEATED (`seatsOf(eventId)`), khoảng 1/9 số ghế đã bán sẵn. Sự kiện có hàng chờ (`song-am-live-2026`) đòi `X-Admission-Token` lấy từ SSE `/v1/queue/status`.

SSE (`seat-stream`, `queue/status`) cần header `Authorization`, nên phía frontend đọc bằng `fetch` (không dùng `EventSource`).

## Kiểu và client

- `pnpm --filter @ticketing/web gen:api`: sinh lại `src/lib/api/generated/*.d.ts` từ OpenAPI của các service (chỉ đọc file của service).
- `pnpm --filter @ticketing/web gen:api:check`: báo lỗi nếu kiểu đã commit lệch OpenAPI hiện tại.
- Gọi API: `identityApi.post("/v1/auth/login", { body })`. Path, tham số, body và kiểu trả về đều suy từ OpenAPI; lỗi đọc bằng `toProblem(error)`.
- Handler mock dùng `mockService<Paths>()`: sai path/method/kiểu response so với OpenAPI sẽ lỗi typecheck.

## Test

`mocks.spec.ts` chạy các handler qua `msw/node` (`node.ts`) bằng chính typed client. Gọi `resetMockState()` giữa các test.

Cập nhật worker sau khi nâng phiên bản `msw`: `pnpm --filter @ticketing/web msw:init`.
