# Run report — Issue #98 khu đứng (GA) trong layout seat map (Cách B)

- **Ngày:** 2026-11-23 · **Agent/IDE:** Claude Code · **Nhánh:** `feat/event-issue98-ga-areas-layout` · **PR:** chưa mở
- **Trạng thái:** Hoàn thành một phần (chờ Tuấn duyệt CONTRACT CHANGE trước khi merge)

## 1. Kiểm tra điều kiện (Bước 0)

- Issue [#98](https://github.com/tvangx/VENTIX/issues/98) (`owner:son`): đề xuất Cách A (ảnh sơ đồ) hoặc Cách B (`ga_areas` trong layout). Người giao việc (Sơn, chủ `services/event`) chọn **Cách B**.
- Vùng sở hữu: `services/event/` thuộc `@luxmountain @tvangx`, không chạm vùng người khác.
- Giả định: `ga_areas` lưu trong JSON `seat_maps.layout` (cột đã có) nên **không cần migration**; mô tả hạng vé (`description`, mục tùy chọn trong issue) **chưa làm** vì cần migration và đổi DTO hạng vé.
- Câu hỏi đã gửi: đã hỏi chọn A/B; được trả lời "làm cách B". Tuấn chưa duyệt CONTRACT CHANGE (checklist trong issue).

## 2. Kế hoạch

- Sửa `seat-map.layout.ts`, `organizer.repository.ts`, `event-lifecycle.repository.ts`, `organizer.dto.ts`, README, OpenAPI.
- Test: unit layout; integration seat-map (tạo, từ chối, tenant) và lifecycle (publish GA-only + GET công khai).
- Rủi ro: hợp đồng OpenAPI organizer (thêm trường tùy chọn, tương thích ngược) và seat map công khai; Kafka `EventApproved` không đổi.

## 3. Đã làm

- `layout.zones` cho phép rỗng; thêm `ga_areas[{name, ticket_class_id}]` tùy chọn (≤100). Layout phải có ít nhất một zone hoặc một khu đứng.
- Validate: tên khu đứng dùng chung không gian tên với zone; một hạng vé GA chỉ gắn một khu; `ticket_class_id` phải thuộc event và `kind = GA` (`INVALID_GA_CLASS`).
- Publish: event toàn GA có map `ga_areas` thì map được publish để catalog công khai trả `seat_map`; `seat_map_version` trong `EventApproved` vẫn 0.
- Viewer V-202 (apps/web, vùng của Vũ) **chưa sửa**: cần vẽ `layout.ga_areas` cạnh zone.

## 4. Quyết định và lệch so với spec

| Quyết định                                 | Lý do                                                                             | Tác động                           |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------- |
| Không tạo bảng area, lưu trong JSON layout | Layout đã trả nguyên JSON ở API organizer và công khai; area không có ghế để khóa | Không migration; booking không đổi |
| GA-only giữ `seat_map_version=0`           | Booking dùng giá trị này để prefetch `seat_pricing` và `pricing_ready`            | Không đổi Kafka contract           |
| Chưa làm `description` hạng vé             | Mục tùy chọn, cần migration và đổi DTO hạng vé                                    | Việc theo sau                      |

## 5. Kiểm chứng (kết quả THẬT)

| Lệnh                                                                                 | Kết quả                |
| ------------------------------------------------------------------------------------ | ---------------------- |
| `pnpm --filter @ticketing/event lint`                                                | pass                   |
| `pnpm --filter @ticketing/event typecheck`                                           | pass                   |
| `pnpm --filter @ticketing/event test`                                                | 21 test pass, 3 suite  |
| `pnpm --filter @ticketing/event test:int -- seat-map event-lifecycle public-catalog` | 17 test pass, 3 suite  |
| `pnpm --filter @ticketing/event test:int` (toàn bộ)                                  | pass, 9 suite, 44 test |

**Chưa chạy được:** `pnpm build` toàn repo thất bại ở các service khác (`service-template`, `notification`, `merch`: thiếu `nest`) vì worktree chỉ cài dependencies cho `@ticketing/event...`; build riêng event-service và các package phụ thuộc thành công.

Chạy bằng Node 20.20.1 và pnpm 9.15.9 qua `npx` (máy không có pnpm trong Volta).

## 6. Tự review

- [x] Concurrency: tạo map vẫn trong transaction + khóa advisory như cũ; publish GA-only lấy cùng khóa `seatmap:<event>`.
- [x] Idempotency: đường tạo map không đổi (Idempotency-Key).
- [x] Outbox/Inbox: payload `EventApproved` không đổi.
- [x] Bảo mật: kiểm tra tenant giữ nguyên (404 với organizer khác, có test); input validate bằng zod `.strict()`.
- [x] Env: không có biến mới.
- [x] Không còn `any`/`console.log`/TODO.

## 7. Tài liệu đã cập nhật

README event-service (mục S-202, S-203). OpenAPI: xem mục 8. Chưa cập nhật ERD (không đổi schema DB).

## 8. Thay đổi hợp đồng / thư viện mới

- **CONTRACT CHANGE (OpenAPI organizer `POST /v1/organizer/events/{eventId}/seat-maps` và seat map công khai):**
  - request/response `layout` thêm `ga_areas` (tùy chọn); `zones` có thể rỗng khi có `ga_areas`;
  - mã lỗi mới `INVALID_GA_CLASS`, `DUPLICATE_GA_CLASS`; `DUPLICATE_SEAT_MAP_LABEL` đổi thông điệp;
  - tương thích ngược: layout cũ vẫn hợp lệ.
- Thư viện mới: không.

## 9. Việc cần Tuấn làm / rủi ro / việc theo sau

- Tuấn duyệt CONTRACT CHANGE trước khi merge.
- Vũ: viewer V-202 và wizard V-203 vẽ/chọn `ga_areas`.
- Theo sau: `description` ≤500 ký tự cho ticket class (cần migration).
