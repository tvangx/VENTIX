# ADR-0017 — Điều kiện giải ngân escrow resale

Ngày 2026-11-12. Chính sách đã được người giao việc xác nhận trong chat VENTIX khi chọn phương án trong plan-6-weeks. Nhóm review phần triển khai trong PR S-405/S-501.

## Bối cảnh

Plan giả định số 4 và architecture-v2 mục 6.2 yêu cầu chốt điều kiện giải ngân. Tiền resale được giữ trong escrow sau thanh toán thành công. S-501 thực hiện job giải ngân và xử lý tranh chấp.

## Quyết định

Giải ngân cho người bán khi người mua check-in thành công hoặc 24 giờ sau khi sự kiện kết thúc, điều kiện nào đến trước. Khiếu nại đang mở chặn giải ngân cho đến khi Admin xử lý xong.

Mốc kết thúc sự kiện lấy từ hợp đồng lifecycle hoặc API thuộc Event, thời gian UTC. Check-in phải thuộc buyer/ticket của giao dịch resale hợp lệ. Triển khai phải giữ điều kiện tranh chấp và chuyển trạng thái escrow trong cùng transaction, chống job chạy đồng thời và retry.

## Hoàn tiền

Người giao việc chọn đề nghị Tuấn mở rộng hoàn tiền resale ở Issue #82 để xử lý payment muộn và nhánh hoàn của tranh chấp. Chi tiết schema và code Payment đang chờ Tuấn chốt. S-405 cần hợp đồng này trước phần cài đặt liên quan.

## Phạm vi tiếp theo

S-405 tạo escrow HELD và chuyển quyền theo ResaleCompleted. S-501 kiểm tra điều kiện giải ngân và tranh chấp. Thao tác chi trả thực tế cần adapter và quyền vận hành được giao riêng.
