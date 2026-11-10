# ADR-0012: Sổ cái finance, làm tròn VAT và audit hash-chain

- **Trạng thái:** Đã chấp nhận trong phạm vi T-402; Tuấn đồng ý prefetch và chỉ hỗ trợ giá gồm VAT ngày 2026-11-10.
- **Ngày:** 2026-11-10
- **Liên quan:** ADR-0005, ADR-0009, ADR-0010; không thay đổi quyết định các ADR này.

## Bối cảnh

Finance cần ghi số thực thu chính xác, đảo sổ khi hoàn toàn bộ và thống kê hạng vé mà không đọc DB khác. OrderConfirmed đã cố định giá thực thu, tổng bằng tổng các item; item SEATED chỉ có seat_id. VND là số nguyên, VAT có thể sinh phần lẻ. Kafka có thể trùng và đảo thứ tự giữa các topic.

## Quyết định

1. Chỉ hỗ trợ `PRICES_INCLUDE_VAT=true` ở T-402. False bị từ chối khi khởi động; không tự cộng VAT vượt tiền thực thu. Tuấn đã chấp thuận giới hạn này. VAT ticket/merch mặc định 10% chỉ là **giả định phát triển, cần xác nhận với quy định thuế hiện hành trước khi dùng trong báo cáo thật**.
2. Rate dạng tỷ lệ 0–1, chính xác tối đa bốn chữ số thập phân. Với tổng gross từng category/order, dùng BigInt tính `net = floor((gross * 10000 + floor((10000 + rate_bps)/2)) / (10000 + rate_bps))`, tức half-up; `vat = gross - net`. Không làm tròn từng item rồi cộng, không dùng float cho tiền. Refund dùng số gốc đã lưu.
3. Header duy nhất `(order_id,kind)` và các entry chỉ INSERT. Trigger deferred kiểm tra tổng Nợ = Có và không cho nhóm rỗng. Header được trigger đóng dấu transaction id PostgreSQL `created_xid`; chỉ transaction đó được ghi entry, tránh nối thêm bút toán vào nhóm đã commit. Trigger chặn UPDATE/DELETE/TRUNCATE cả header/entries; thu hồi UPDATE/DELETE/TRUNCATE trên ledger_entries/audit_logs của finance_user. Header giữ quyền cần thiết cho kiểm tra FK nhưng trigger chặn mọi sửa/xóa. Không cần function SECURITY DEFINER.
4. Inbox, ledger, revenue, stats và Outbox cùng transaction. Advisory lock theo order serialize các topic. Refund đến trước confirm được lưu pending; khi confirm đến, sale và đảo thực hiện nguyên tử. Tổng hoàn hoặc payment_id khác số gốc: không đảo và phát AuditRecorded cảnh báo qua Outbox. Không thay đổi state machine booking.
5. Tuấn chấp thuận finance prefetch API seat-classes hiện có vào bảng cục bộ. Không thêm field vào OrderConfirmed và không sửa booking/event. Thiếu map thì rollback và retry/DLQ; replay sau khi đủ snapshot. Refund sử dụng snapshot item đã lưu, không phụ thuộc map/config hiện tại.
6. Audit có id bigint theo ERD 5.9 (ngoại lệ quy ước UUID). Giữ các cột truy vấn và JSON record canonical. Advisory lock toàn chuỗi trước khi cấp sequence. Hash SHA256 của prev_hash nối JSON chuẩn hóa: key object sắp tăng theo code unit, array giữ thứ tự, JSON.stringify cho scalar; genesis 64 số 0. Record gồm id, message_id, actor/action/resource, before/after (thiếu thành null), created_at UTC ISO mili giây. Verify kiểm tra record canonical và cột SQL.
7. DLQ giữ bytes gốc bằng base64, khóa nguồn `(topic,partition,offset)`. Replay xếp vào dlq_replays trong transaction với trạng thái dead letter. Relay dùng producer idempotent, acks=all và khóa SKIP LOCKED; không publish trong HTTP handler. Giữ nguyên envelope/message_id; crash sau ack trước commit có thể phát trùng, Inbox chặn. Payload sai schema hoặc topic không khớp hợp đồng trả 409, cho phép discard; không sửa chứng cứ raw.
8. API tiền/id bigint là chuỗi số nguyên. Stats đọc snapshot REPEATABLE READ để hai read-model nhất quán khi refund đồng thời. Tenant được xác minh từ events_ref và JWT organizer_id; ADMIN xem mọi event.

## Hệ quả

- Không thay event-contracts, OpenAPI nội bộ hay DB service khác. Thêm client nền gọi API hiện có, không thêm gọi đồng bộ vào checkout.
- events_ref, seat_classes, finance_orders, pending_refunds, event_revenue_stats, dead_letters, dlq_replays bổ sung ERD 5.9; schema/migration trong service là mô hình chi tiết. Không tạo payouts hoặc payout_id FK; chưa triển khai thanh toán organizer.
- Hash-chain phát hiện thay đổi trong chuỗi còn giữ; chưa có anchor ngoài DB để phát hiện rewrite toàn bộ hoặc xóa đuôi bằng superuser. Quyền DDL phải quản trị riêng.
- Refund chưa từng có confirm còn pending để đối soát; không ghi âm doanh thu khi chưa có sale. SSE, partial refund, resale refund và logic hóa đơn ngoài T-402.
- Phiên bản legacy không đủ snapshot/map có thể vào DLQ; cần snapshot hợp lệ trước replay. Verify audit hiện đọc toàn bộ chain trong một SELECT nhất quán.

## Phương án đã cân nhắc

- Bổ sung ticket_class_id vào OrderConfirmed: cần CONTRACT CHANGE, chưa chọn.
- Cộng VAT khi cờ false: lệch tiền đã thanh toán theo ADR-0009, không chọn.
- Chỉ kiểm tra cân bằng trong TypeScript: SQL trực tiếp có thể bỏ qua, không chọn.
- UPDATE entry khi hoàn: phá lịch sử sổ cái, không chọn.
- Publish replay trong HTTP handler: không nguyên tử với trạng thái DB, không chọn.
