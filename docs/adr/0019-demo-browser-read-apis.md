# ADR-0019: API đọc phục vụ browser demo T-208

- Trạng thái: Tuấn duyệt trực tiếp ngày 2026-11-26, chờ review cài đặt.
- Liên quan: ADR-0001/0004/0009/0010, T-208.

## Quyết định

CONTRACT CHANGE additive, không đổi DB schema hoặc Kafka:

- Booking `GET /v1/orders/{orderId}` yêu cầu JWT; lọc đồng thời order ID và user ID, đơn người khác trả 404 như đơn không tồn tại. Trả trạng thái server, tiền VND nguyên, hạn thanh toán và items; `Cache-Control: private, no-store`. Browser Return không được xác nhận thành công từ query VNPay.
- Event `GET /v1/events/{id}/seats` yêu cầu `seat_map_version`, hỗ trợ `cursor`, `limit` mặc định 1000/tối đa 5000. Chỉ trả event PUBLISHED và map có published_at. Mỗi ghế có UUID, hạng vé, tên zone/block, row_label và seat_no để ánh xạ layout đã công khai. Thiếu map/version hoặc event không công khai trả 404. Không lộ giá trị internal key, không mở route internal qua Kong.
- Browser tạo payment với provider VNPAY, dùng URL sandbox qua env allowlist; Return frontend `/payments/return` đọc trạng thái đơn; chỉ backend IPN sau kiểm chữ ký mới làm chuyển trạng thái qua luồng hiện có.

## Hệ quả

Frontend không tự suy UUID từ chỉ số layout và không truy cập DB. Polling đơn/vé dùng API đúng chủ sở hữu; phát hành vé vẫn qua Kafka/Inbox hiện tại. Không thêm chính sách nghiệp vụ, không thay nghiệm thu production/load test/pipeline.
