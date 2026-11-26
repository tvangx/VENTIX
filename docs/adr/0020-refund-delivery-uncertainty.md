# ADR-0020: Refund bền vững và kết quả provider không rõ

- **Trạng thái:** Đã chấp nhận — Tuấn duyệt trong phiên T-401 ngày 2026-11-26.
- **Liên quan:** ADR-0005, ADR-0009, T-401; không đổi event-contracts.

## Bối cảnh

UNIQUE(payment_id), Inbox và Outbox chỉ bảo đảm idempotency trong hệ thống. Provider có thể nhận refund rồi client timeout hoặc worker chết trước khi ghi kết quả. Không có transaction phân tán với VNPay. Không coi request ID là bằng chứng provider chỉ hoàn một lần.

Tài liệu [JSON QueryDr/refund](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html) và [bảng mã lỗi](https://sandbox.vnpayment.vn/apis/docs/bang-ma-loi/) mô tả cửa sổ trùng lặp/trạng thái xử lý chưa đủ để cho phép gửi lại vô điều kiện. Đây là cách diễn giải thận trọng cho tích hợp này; chưa xác minh khả năng merchant hiện tại.

## Quyết định

1. Endpoint JSON tham chiếu `https://sandbox.vnpayment.vn/merchant_webapi/api/transaction`, cấu hình `VNPAY_REFUND_URL` riêng, validate allowlist chính xác. Không suy ra URL từ payment URL, không đổi hostname sang `sandbox.vnpaytest.vn`. `VNPAY_REFUND_ENABLED=false` mặc định; Tuấn phải xác minh endpoint và quyền merchant trước khi bật EC2.
2. Claim bằng `FOR UPDATE SKIP LOCKED`, ghi `sent_at`, token và lease rồi commit trước network call. Không giữ transaction/row lock qua network. Token/version chặn worker cũ ghi đè claim mới.
3. Có `sent_at` thì claim phục hồi/manual retry chỉ đối soát, không gửi refund mới. Mất phản hồi/đang xử lý được lên lịch một lượt đối soát có backoff, đi qua cùng giới hạn tốc độ/concurrency. Không đủ bằng chứng thì NEEDS_MANUAL; retry thủ công không xóa dấu gửi.
4. Chỉ xóa dấu gửi khi có bằng chứng chắc chắn không thực hiện và điều kiện gửi lại an toàn. Hiện chỉ MockAdapter phát NOT_PERFORMED xác định; VNPay không phát kết quả này. Lỗi VNPay có chữ ký vẫn không tự cấp quyền gửi lại.
5. Chỉ response refund HMAC đúng, đúng command/TmnCode/TxnRef/số tiền/toàn phần/nội dung gắn refund ID, code/status 00/00 và mã giao dịch refund hợp lệ mới hoàn tất tự động. Trạng thái 05/06, mã 94/98, chữ ký sai, HTTP lỗi hoặc timeout không phải thành công cuối cùng.
6. Query ký riêng, request ID mới mỗi lượt. Query payment gốc thành công không chứng minh refund thành công. Tài liệu hiện có chưa đủ chứng minh lookup refund theo request ID: adapter hiện trả UNKNOWN cả khi query được xác thực. Không bổ sung API đánh dấu thành công thủ công bằng lời khai không có chứng cứ.
7. Refund SUCCEEDED và Outbox RefundCompleted cùng transaction, có điều kiện claim/version. Consumer dùng Inbox; UNIQUE(payment_id) chặn hoàn toàn phần hai lần. Batch hủy sự kiện và callback payment dùng cùng advisory lock theo event để không bỏ sót success đến sau batch.
8. Một dòng refund_dispatch cấp slot thời gian và giới hạn tổng claim PROCESSING giữa replica. Mọi replica dùng cùng cấu hình; concurrency/rate bao gồm gửi mới và query. Lease dài hơn timeout HTTP. refunds_total{status} đếm kết quả attempt sau commit, không thay số liệu DB và có thể thiếu lần tăng nếu process chết ngay sau commit.
9. Mock provider có ledger receipt bền vững, transaction riêng với worker để mô phỏng đã hoàn nhưng mất phản hồi/crash. Ledger giả không chứng minh hành vi VNPay.

## Hệ quả

- Một số refund phải đối soát tay, kể cả crash sau dấu gửi nhưng trước khi network thực sự bắt đầu. VNPay không được tuyên bố tự phục hồi hoàn toàn hoặc đã đạt E2E.
- Consumer refund mới replay lifecycle/booking; booking có consumer cancellation riêng cho sự kiện Inbox cũ đã xử lý trước T-401. Nếu Kafka đã hết retention, cần kiểm kê/backfill có kiểm soát theo hợp đồng; không đọc DB service khác.
- ADMIN không có organizer_id là admin toàn hệ thống. ADMIN có organizer_id bị giới hạn theo lifecycle snapshot; header tenant tùy ý không mở rộng quyền. Snapshot chưa có thì từ chối thao tác scoped.
- Không làm hoàn một phần/resale/UI, không deploy hoặc refund sandbox thật trong task này.
