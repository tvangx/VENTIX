# Tin nhắn mẫu gửi Sơn và Vũ

## 1. Tin khởi động (gửi sau khi đã push repo và mời họ)

```text
Repo đã sẵn sàng: <link repo>. Hãy làm theo README.md mục "Bắt đầu trong 10 phút" và gửi lại ảnh chụp kết quả `make verify`.
Việc trong ngày đầu:
- Vũ: V-101 (khởi tạo apps/web, apps/staff-pwa), V-105 (wireframe), V-104 (dữ liệu seed). Chưa cần chờ gì.
- Sơn: soạn SQL migration identity (S-101) dạng file SQL thuần, đọc ADR-0004 (verify JWT trong service) và ADR-0005.
Ngày mai Tuấn bàn giao template service (T-102); từ đó hai bạn gắn vào template.
Quy tắc: không push thẳng main; commit theo Conventional Commits; đọc CONTRIBUTING.md. Task của mỗi người đã tạo thành Issue.
Nếu dùng agent trong IDE, đọc AGENTS.md: đó là quy ước chung.
```

## 2. Tin xác nhận hợp đồng saga (cần cả hai trả lời "OK" hoặc nêu phản đối)

```text
Tuấn đã chốt hợp đồng saga checkout. Cần hai bạn đọc và trả lời OK hoặc phản đối trước <ngày>:
Đọc: docs/adr/0009-post-payment-flow.md, docs/adr/0010-internal-sync-apis.md, docs/api/internal/*.yaml,
và packages/event-contracts/src/events.ts (khối OrderAwaitingPayment, OrderConfirmed).

Tóm tắt thay đổi:
- OrderConfirmed giờ là điểm kích hoạt sau thanh toán và mang items[] (seat/hạng vé/sku, số lượng, giá) + tách ticket/merch amount.
- ticket, merch (commit kho), finance, notification đều kích hoạt từ OrderConfirmed, KHÔNG từ PaymentSucceeded.
- Thanh toán đến muộn sau khi order hết hạn: tự hoàn tiền, không hồi sinh order (ADR-0009).
- PaymentFailed không hủy order; khách được thanh toán lại đến khi hết hạn.

Ảnh hưởng tới Sơn:
- S-301: ticket-service phát vé khi nhận OrderConfirmed (idempotent theo order_item_id). Không consume PaymentSucceeded.
- S-405 (resale mua): resale-service phát ResaleOrderAwaitingPayment (resale.events) khi tạo đơn resale; payment-service dựng read-model và tạo thanh toán; resale lắng nghe PaymentSucceeded{purpose: RESALE} để hoàn tất đơn. Hoàn tiền resale chưa hỗ trợ (ghi vào hạn chế đã biết).
- S-206 (MỚI, 0,5 ngày, tuần 2): GET /v1/internal/events/{id}/seat-classes (phân trang cursor) theo docs/api/internal/seat-classes.yaml,
  xác thực X-Internal-Key. Booking dùng để prefetch giá ghế.

Ảnh hưởng tới Vũ:
- V-305: merch reserve khi OrderCreated (chỉ item MERCH), commit khi OrderConfirmed, release khi OrderExpired/OrderCancelled.
- V-306 (MỚI, 0,75 ngày, tuần 3): POST /v1/internal/quotes (SKU lẻ) theo docs/api/internal/merch-quotes.yaml. Combo trả 422 COMBO_NOT_SUPPORTED.
- V-406 (MỚI, 0,5 ngày, tuần 4): combo upsell và báo giá combo.
- V-303: checkout tuần 3 chỉ SKU lẻ, chưa combo.

Lưu ý tải: tuần 3 của Vũ khoảng 5,25 ngày, tuần 4 khoảng 5,0. Nếu thấy không kịp, báo Tuấn sớm để cắt (đề xuất cắt V-406 trước).
Hai API /internal chỉ gọi nội bộ, Kong chặn từ ngoài. Khóa nội bộ X-Internal-Key đặt trong INTERNAL_API_KEY (Tuấn gửi giá trị dev riêng).
```

## 3. Chốt chính sách escrow (đặt câu hỏi cho cả nhóm tại workshop)

```text
Mặc định đề xuất: giải ngân cho người bán khi người mua check-in thành công, hoặc 24 giờ sau khi sự kiện kết thúc (cái nào đến trước).
Khiếu nại: Admin giữ lại cho đến khi xử lý xong. Cả nhóm đồng ý không? Nếu không, đề xuất phương án khác.
```
