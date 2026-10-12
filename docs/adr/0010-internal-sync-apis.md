# ADR-0010: API nội bộ đồng bộ (ngoại lệ có kiểm soát của ADR-0006)

- **Trạng thái:** Đã chấp nhận (Tuấn, 2026-10-12; Sơn và Vũ cần xác nhận phần ảnh hưởng)
- **Ngày:** 2026-10-12
- **Liên quan:** ADR-0001, ADR-0006, ADR-0009

## Bối cảnh

ADR-0006 quy định booking không gọi đồng bộ sang service khác trên đường nóng, và dùng read-model (`event_snapshots`). Hai dữ liệu còn thiếu cho checkout:

- **C5, giá ghế:** ánh xạ `seat_id → ticket_class_id` nằm ở `event-service`. Một sự kiện có thể có vài chục nghìn ghế; đưa toàn bộ vào một message Kafka có rủi ro vượt giới hạn kích thước và phải lắp ghép nhiều phần.
- **C6, giá merch:** booking không biết giá merch, trong khi hợp đồng cần tách `merch_amount_vnd` chính xác.

## Quyết định

### C5. Prefetch `seat_pricing` (không gọi đồng bộ khi khách đặt vé)

- Khi nhận `EventApproved/Updated` có `seat_map_version` mới, booking chạy job nền gọi `GET /v1/internal/events/{eventId}/seat-classes` (phân trang theo cursor) của `event-service` và upsert vào bảng `seat_pricing`.
- Hoàn tất toàn bộ trang mới đặt `event_snapshots.pricing_ready = true` (trong một transaction). Chưa `pricing_ready` thì chưa cho bán (`503 EVENT_NOT_READY`, `Retry-After`).
- Seat map đã publish là bất biến nên chỉ cần lấy một lần cho mỗi `seat_map_version`.
- Đường nóng chỉ đọc bảng cục bộ, không gọi service khác.

### C6. Báo giá merch đồng bộ, chỉ khi order có merch

- Booking gọi `POST /v1/internal/quotes` của `merch-service`, **chỉ khi** order có `merch_items`.
- Timeout 800 ms, retry 1 lần (thao tác đọc), circuit breaker. Merch lỗi → chỉ order có merch nhận `503 MERCH_UNAVAILABLE`; order chỉ có vé không bị ảnh hưởng.
- Tuần 3 hỗ trợ SKU lẻ. Combo trả `422 COMBO_NOT_SUPPORTED`, làm ở tuần 4. Giảm giá combo, khi có, chỉ áp lên dòng merch; giá vé giữ nguyên.

### Bảo mật cho API nội bộ

- Đường dẫn `/v1/internal/*` xác thực bằng header `X-Internal-Key` (so sánh hằng thời gian; khóa đọc từ biến môi trường `INTERNAL_API_KEY`).
- **Kong phải chặn mọi đường `/internal` từ bên ngoài** (route kết thúc 404). Service nội bộ gọi nhau trực tiếp trong mạng nội bộ, không qua Kong.
- Không log giá trị khóa.

## Phương án đã cân nhắc

- **Nhồi toàn bộ ghế vào sự kiện Kafka:** message lớn, khó lắp ghép, khó tái tạo khi mất.
- **Nhân bản bảng giá merch vào booking qua sự kiện:** đúng nguyên tắc hơn nhưng thêm topic, đồng bộ tồn kho/giá và độ trễ cho một luồng ít dùng; hoãn lại nếu đo thấy merch là điểm nghẽn.
- **Gọi event-service mỗi lần khách đặt:** thêm điểm lỗi trên đường nóng.

## Hệ quả

- (+) Đường nóng của vé độc lập; merch lỗi chỉ ảnh hưởng order có merch.
- (-) Thêm hai API nội bộ: Sơn thêm S-206 (`seat-classes`), Vũ thêm V-306 (`quotes`).
- (-) Thêm bảng `seat_pricing` và cờ `pricing_ready` trong `booking_db`, thêm job prefetch (T-203b).
- (-) Quản lý một khóa nội bộ dùng chung (xoay khóa là việc thủ công).
