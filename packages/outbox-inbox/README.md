# @ticketing/outbox-inbox (TODO — task T-103, Tuấn)

Thư viện dùng chung cho Transactional Outbox + Inbox. Chưa có code; thư mục này đã có
`sql/outbox_inbox.sql` là schema chuẩn để mọi service copy vào migration.

Phạm vi T-103:

- `OutboxService.add(tx, message)` ghi `outbox_events` trong cùng transaction nghiệp vụ.
- `OutboxRelay` polling `FOR UPDATE SKIP LOCKED`, publish Kafka (producer idempotent, `acks=all`).
- `inboxHandler(consumerName, handler)` bọc consumer: parse bằng `@ticketing/event-contracts`,
  kiểm tra `processed_events`, xử lý trong cùng transaction, retry + chuyển DLQ sau N lần.
- Test Testcontainers: lỗi giữa chừng không mất/không trùng; message trùng chỉ xử lý 1 lần.
