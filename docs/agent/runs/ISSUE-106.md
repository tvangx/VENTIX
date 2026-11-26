# Run report — Issue #106 vị trí và hình dạng trong layout seat map (PR 1)

- **Ngày:** 2026-11-26 · **Agent/IDE:** Claude Code · **Nhánh:** `feat/event-issue106-seat-map-placement` · **PR:** chưa mở
- **Trạng thái:** Hoàn thành một phần (ảnh nền và web chưa làm)

## 1. Kiểm tra điều kiện (Bước 0)

- Issue [#106](https://github.com/tvangx/VENTIX/issues/106): Tuấn duyệt ngày 2026-11-25 "các contract change theo đề xuất".
- Cách hiểu: chọn tọa độ đầy đủ theo đề xuất ở #100, không chọn `placement: front/back/left/right`.
- Phụ thuộc: `ga_areas` (#98) đã merge.

## 2. Kế hoạch

- Sửa `seat-map.layout.ts`, `organizer.dto.ts`, README, OpenAPI; sinh lại kiểu API của web.
- Test: unit layout, integration seat map.

## 3. Đã làm

- `layout` thêm `canvas`, `stage`, `zones[].blocks[].position`, `ga_areas[].position`, đều tùy chọn.
- Hình dạng `rect`, `ellipse` (có `rotation`) và `polygon` 3–50 đỉnh.
- Mã lỗi mới `INVALID_PLACEMENT`, `PARTIAL_PLACEMENT`.

## 4. Quyết định và lệch so với spec

| Quyết định                                                    | Lý do                                                | Tác động                                |
| ------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| Vị trí ở mức Khu (`zones[].blocks[]`)                         | Đề xuất #100; các Khu của một Block thường tách nhau | Block chỉ là nhóm đặt tên               |
| Chưa thêm hình cung/quạt                                      | `polygon` đủ cho bản đầu                             | Đặt tay không giữ được đường cong thật  |
| `rotation` quanh tâm khung, theo chiều kim đồng hồ (giả định) | #100 không nêu                                       | Web (Konva) phải đặt offset về tâm      |
| Chỉ kiểm khung trước khi xoay nằm trong `canvas`              | #100 chỉ yêu cầu tọa độ nằm trong canvas             | Góc sau khi xoay có thể ra ngoài canvas |
| `canvas` mỗi cạnh trong `(0, 10000]`                          | Giới hạn ví dụ của #100                              |                                         |
| `stage` không tính vào quy tắc "tất cả hoặc không"            | #100 chỉ áp dụng cho Khu và khu đứng                 | Có thể chỉ đặt sân khấu                 |
| Không đổi luật sửa sơ đồ sau mở bán                           | `createSeatMap` đã chỉ cho sửa ở `DRAFT`, `REJECTED` |                                         |

## 5. Kiểm chứng (kết quả THẬT)

| Lệnh                                       | Kết quả                |
| ------------------------------------------ | ---------------------- |
| `pnpm --filter @ticketing/event lint`      | pass                   |
| `pnpm --filter @ticketing/event typecheck` | pass                   |
| `pnpm --filter @ticketing/event test`      | 72 test pass, 7 suite  |
| `pnpm --filter @ticketing/event test:int`  | 66 test pass, 11 suite |
| `pnpm --filter @ticketing/web typecheck`   | pass                   |
| `pnpm --filter @ticketing/web test`        | 198 test pass, 18 file |
| `pnpm --filter @ticketing/event test:conc` | 4 test pass, 2 suite   |
| `pnpm format:check`                        | pass                   |
| `pnpm build`                               | pass, 16/16 task       |

Chạy bằng Node 20.20.1 và pnpm 9.15.9 qua `npx`.

## 6. Tự review

- [x] Concurrency, idempotency, outbox: đường ghi seat map không đổi.
- [x] Bảo mật: input validate bằng zod `.strict()`, giới hạn số đỉnh và tọa độ.
- [x] Env: không có biến mới.
- [x] Không còn `any`/`console.log`/TODO.

## 7. Tài liệu đã cập nhật

README event-service (mục S-202), `openapi.json`. Không đổi schema DB.

## 8. Thay đổi hợp đồng / thư viện mới

- **CONTRACT CHANGE (OpenAPI organizer `POST seat-maps` và seat map công khai):** `layout` thêm các
  trường tùy chọn ở mục 3, thêm hai mã lỗi. Layout cũ vẫn hợp lệ. Kafka không đổi.
- `apps/web/src/lib/api/generated/event.d.ts` (vùng của Vũ) được sinh lại bằng `gen:api`.
- Thư viện mới: không.

## 9. Việc theo sau

- Ảnh nền (#106 phần 3 giai đoạn 1): `layout.background`, endpoint upload, `background_url`.
- Vũ: viewer V-202 và editor V-203 dùng tọa độ; thông báo cho hai mã lỗi mới.
- `payment.d.ts` trên `main` đang lệch so với OpenAPI của payment (không thuộc task này, chưa sửa).
