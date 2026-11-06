# ADR-0011: Lifecycle v2 cung cấp đủ dữ liệu cho booking snapshot

- **Trạng thái:** Đã chấp nhận (Tuấn trả lời “ok” cho đề xuất CONTRACT CHANGE của T-203, 2026-11-06)
- **Liên quan:** ADR-0005, ADR-0006, ADR-0010; T-203

## Bối cảnh

Lifecycle v1 chưa có `seat_map_version`; `EventUpdated` chỉ có ID và event_version, `EventCancelled` không có event_version. Booking không thể dựng snapshot mới nhất và bỏ qua bản cũ một cách xác định nếu tự đoán các dữ liệu thiếu.

## Quyết định

- Thêm lifecycle **envelope version 2**, giữ parser/schema v1 để các consumer khác vẫn đọc được bản cũ. Không thay đổi ADR-0009/0010.
- `EventApproved` và `EventUpdated` v2 mang toàn bộ payload Approved v1, thêm `seat_map_version`; `event_version` và `seat_map_version` là số nguyên không âm. Producer tăng event_version cho từng thay đổi lifecycle của cùng event.
- `EventCancelled` v2 giữ ID/organizer/reason và thêm `event_version`. Consumer có thể tạo tombstone chưa có map (`seat_map_version=0`, JSON rỗng, `pricing_ready=false`) khi cancel đến trước Approved; bản Approved cũ không được ghi đè tombstone.
- Consumer T-203 yêu cầu v2, không suy đoán phiên bản hoặc gọi REST để bù dữ liệu lifecycle v1. V1 đi DLQ ngay bằng PermanentError, không ghi Inbox. Khi chuyển producer, cần phát lại snapshot/cancellation v2 có phiên bản nghiệp vụ đúng.
- Updated đầy đủ giúp xử lý ngay cả khi đến trước Approved. Snapshot và stock chỉ ghi khi event_version tăng, cùng transaction Inbox. Chỉ T-203b được đặt pricing_ready=true; T-203 xóa cờ khi map thay đổi hoặc cancel, giữ cờ hiện tại nếu map không đổi.

## Hệ quả

Producer event-service của Sơn cần chuyển lifecycle sang v2; T-203 không sửa service đó. Script dữ liệu giả phát Approved v2 để dev/test trong thời gian chờ. Đổi envelope version cần producer/consumer phối hợp triển khai và theo dõi DLQ, không được đơn giản đổi version của message cũ thiếu payload.
