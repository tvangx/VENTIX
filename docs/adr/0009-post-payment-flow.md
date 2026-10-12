# ADR-0009: Luồng sau thanh toán, thanh toán đến muộn và máy trạng thái order

- **Trạng thái:** Đã chấp nhận (Tuấn, 2026-10-12; Sơn và Vũ cần xác nhận phần ảnh hưởng)
- **Ngày:** 2026-10-12
- **Liên quan:** ADR-0002, ADR-0005, ADR-0006; hợp đồng `packages/event-contracts`

## Bối cảnh

Khi rà luồng saga checkout, bản hợp đồng nháp thiếu thông tin để các service hoạt động độc lập (mỗi service một database):

1. `payment-service` không biết số tiền và hạn thanh toán của order.
2. `OrderConfirmed` không mang ghế/hạng vé nên `ticket-service` không phát vé được; không tách được doanh thu vé và merch để tính VAT.
3. Chưa có chính sách khi thanh toán thành công đến **sau** khi order đã hết hạn hoặc bị hủy (khách mất tiền, ghế có thể đã bán cho người khác).
4. Máy trạng thái order chưa có nhánh xử lý hoàn tiền.

## Quyết định

### C1. Sự kiện `OrderAwaitingPayment`

Booking phát `OrderAwaitingPayment {order_id, user_id, event_id, amount_vnd, expires_at}` (topic `booking.orders`, key `order_id`) khi order sẵn sàng thanh toán (ngay trong transaction tạo order nếu không có merch; sau `StockReserved` nếu có merch).
`payment-service` dựng read-model `payable_orders` từ sự kiện này. Client gọi `POST /v1/payments {order_id, provider}`; nếu read-model chưa có dữ liệu, payment trả `409 ORDER_NOT_READY` kèm `Retry-After: 1`.

### C2. `OrderConfirmed` là điểm kích hoạt sau thanh toán

`OrderConfirmed` mang `payment_id`, `items[]` (`order_item_id, item_type, ref_id, quantity, unit_price_vnd, combo_id?`), `ticket_amount_vnd`, `merch_amount_vnd`, `total_amount_vnd`, `confirmed_at`. Hợp đồng kiểm tra bất biến tổng tiền. Booking chỉ phát sau khi ghế đã `SOLD` trong DB.

| Consumer             | Hành động khi nhận `OrderConfirmed`                                                 |
| -------------------- | ----------------------------------------------------------------------------------- |
| ticket-service       | Phát vé cho từng item `TICKET_SEAT` / `TICKET_GA` (idempotent theo `order_item_id`) |
| merch-service        | Commit tồn kho đã reserve cho `order_id`                                            |
| finance-service      | Ghi sổ cái, tách doanh thu vé / merch và VAT                                        |
| notification-service | Gửi xác nhận cho khách                                                              |

`ticket-service` **không** lắng nghe `PaymentSucceeded` (khác với bản kế hoạch ban đầu của S-301).
`PaymentSucceeded` chỉ được booking (chốt order), finance (đối soát) và resale (đơn resale) lắng nghe.

### C3. Thanh toán đến muộn: tự hoàn tiền, không hồi sinh order

Khi booking nhận `PaymentSucceeded` cho order đã `EXPIRED`, `FAILED` hoặc `CANCELLED`:

1. Order chuyển sang `REFUND_REQUIRED` (cập nhật có điều kiện).
2. Booking phát `OrderCancelled {reason: "LATE_PAYMENT"}`.
3. `payment-service` thấy payment `SUCCEEDED` của order đã hủy → tạo hoàn tiền → phát `RefundCompleted`.
4. Booking nhận `RefundCompleted` → order chuyển sang `REFUNDED`.

Giảm thiểu để trường hợp này hiếm xảy ra:

- `vnp_ExpireDate` gửi VNPay bằng `orders.expires_at`.
- Sweeper của booking chờ thêm `ORDER_EXPIRY_GRACE_SECONDS` (mặc định 30) sau `expires_at` rồi mới hủy.

Lý do không hồi sinh order: ghế có thể đã được nhả và bán cho người khác; hồi sinh làm tăng nguy cơ bán trùng, trái ADR-0002.

### C4. Máy trạng thái order

| Từ                               | Sang (hợp lệ)                                          |
| -------------------------------- | ------------------------------------------------------ |
| `PENDING`                        | `AWAITING_PAYMENT`, `CANCELLED`, `EXPIRED`             |
| `AWAITING_PAYMENT`               | `CONFIRMED`, `EXPIRED`, `CANCELLED`, `FAILED`          |
| `CONFIRMED`                      | `REFUNDED`                                             |
| `EXPIRED`, `FAILED`, `CANCELLED` | `REFUND_REQUIRED` (chỉ khi có `PaymentSucceeded` muộn) |
| `REFUND_REQUIRED`                | `REFUNDED`                                             |
| `REFUNDED`                       | — (trạng thái cuối)                                    |

Mọi chuyển trạng thái là cập nhật có điều kiện `WHERE id=:id AND status=:from AND version=:v`.

### D7. `PaymentFailed` không hủy order

Thanh toán thất bại là tình huống thường gặp (nhập sai OTP...). Khách được thanh toán lại đến khi order hết hạn. Mỗi order chỉ có tối đa 1 payment đang hoạt động (`PENDING` hoặc `SUCCEEDED`). Order chỉ sang `FAILED` khi payment-service xác định không thể tiếp tục (ví dụ vượt số lần thử cấu hình), còn mặc định cứ chờ hết hạn.

## Phương án đã cân nhắc

- **Payment đọc DB booking / gọi REST booking:** vi phạm database-per-service (ADR-0001) và tạo điểm lỗi trên đường nóng.
- **Hồi sinh order khi thanh toán muộn:** nguy cơ bán trùng; phải khóa lại ghế đã nhả.
- **Ticket lắng nghe `PaymentSucceeded`:** `ticket-service` không có dữ liệu order; phải gọi sang booking hoặc nhân bản dữ liệu.

## Hệ quả

- (+) Mỗi service tự đủ dữ liệu; luồng thanh toán muộn xác định, không bán trùng.
- (+) Vé chỉ được phát sau khi ghế đã `SOLD`.
- (-) Thêm một sự kiện và mở rộng `OrderConfirmed`; Sơn (S-301) và Vũ (V-305) phải đổi consumer.
- (-) Thêm nhánh hoàn tiền tự động cần test kỹ (T-303, T-401).
