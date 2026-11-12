# ADR-0013 — Công khai sự kiện sau duyệt

- **Ngày** 2026-11-11
- **Trạng thái** Sơn đã chấp nhận
- **Phạm vi** S-203, liên quan ADR-0010 và ADR-0011

## Bối cảnh

UC-05 yêu cầu Admin duyệt trước khi công khai. Booking dùng snapshot
`EventApproved` v2 để xét mở bán và lấy ánh xạ ghế từ seat map đã publish.
Phát snapshot ở thời điểm duyệt sẽ để Booking và Event thấy hai trạng thái khác nhau.

## Quyết định

- Organizer gửi cấu hình DRAFT/REJECTED sang PENDING. Admin duyệt hoặc từ chối,
  lưu quyết định và lý do vào `event_approvals`.
- Organizer chủ động chuyển APPROVED sang PUBLISHED. Cùng transaction, Event
  công khai seat map tương ứng và ghi `EventApproved` v2 vào outbox. Sale phase
  tiếp tục quyết định thời gian mở bán. Event chỉ có vé GA dùng phiên bản map 0.
- Khi Organizer hủy event đã công khai, ghi `EventCancelled` v2 cùng chuyển
  trạng thái. Hủy event trước công khai chỉ thay đổi dữ liệu Event. T-401 xử lý
  hoàn tiền cho event đã bán vé.
- `EventUpdated` đi cùng quyền sửa sau duyệt đã hoãn tại Q-S201-02.

## Hệ quả

Một bước Admin duyệt hoàn tất kiểm duyệt nội dung. Organizer cần publish để
công khai và cho Booking nhận cấu hình. Bản đồ được đánh dấu publish bất biến
theo trigger S-107. [Nhật ký quyết định](../agent/SON_WEEK2_DECISIONS.md)
