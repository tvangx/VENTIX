# ADR-0012 — Quyền quản lý địa điểm và cấu hình sự kiện

- **Ngày** 2026-11-10
- **Phạm vi** S-201, Event service
- **Trạng thái** Sơn xác nhận phạm vi triển khai

## Bối cảnh

Organizer cần tạo địa điểm hoặc chọn địa điểm đã có trong tenant của mình.
Schema S-107 có quan hệ từ sự kiện tới địa điểm nhưng thiếu tenant của địa điểm.

## Quyết định

- Lấy tenant từ JWT. Event DB lưu `organizer_id` của địa điểm và kiểm tra
  `(venue_id, organizer_id)` ở khóa ngoại của sự kiện.
- Chỉ tự gán tenant cho địa điểm cũ khi các sự kiện gắn với nó thuộc đúng một
  Organizer. Nếu chưa xác định được, migration rollback để chủ dữ liệu xử lý.
- Chỉ sửa và xóa event, hoặc ghi hạng vé và đợt mở bán, ở DRAFT/REJECTED.
  Địa điểm gắn với sự kiện ngoài hai trạng thái này cũng bị khóa chỉnh sửa.
- Quyền sửa sau duyệt theo BR-02.4 sẽ được chốt riêng. Theo dõi danh sách trường,
  duyệt lại và thông báo ở Q-S201-02. [Nhật ký quyết định](../agent/SON_WEEK2_DECISIONS.md)

## Hệ quả

Organizer có thể dùng lại địa điểm trong tenant. Thay đổi trực tiếp cấu hình của
sự kiện đang duyệt hoặc đã duyệt đi qua luồng xử lý riêng sau khi chính sách
được chốt.
