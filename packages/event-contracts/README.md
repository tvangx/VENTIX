# @ticketing/event-contracts

Hợp đồng sự kiện Kafka dùng chung cho mọi service (schema zod + tên topic + registry).

**Trạng thái: BẢN NHÁP v1 — cần chốt tại workshop T-107 (tuần 1).**

## Quy tắc

- Mọi message dùng envelope: `message_id, type, version, occurred_at, trace_id?, tenant_id?, data`.
- Thay đổi schema theo hướng **tương thích ngược** (chỉ thêm field tùy chọn); thay đổi phá vỡ → tăng `version` và giữ schema cũ.
- Producer publish đúng topic theo `topicOf`; key partition theo comment trong `topics.ts`.
- Consumer luôn gọi `parseMessage` rồi kiểm tra Inbox (`processed_events`) trước khi xử lý.
- Tiền: số nguyên VND. ID: UUID (đổi sang UUIDv7 ở T-103).

## Dùng

```ts
import { newMessage, parseMessage, Topics, topicOf } from "@ticketing/event-contracts";
const msg = newMessage("PaymentSucceeded", {/* ... */});
await producer.send({
  topic: topicOf.PaymentSucceeded,
  messages: [{ key: orderId, value: JSON.stringify(msg) }],
});
```
