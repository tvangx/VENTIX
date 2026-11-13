# @ticketing/event-contracts

Hợp đồng sự kiện Kafka dùng chung cho mọi service (schema zod + tên topic + registry).

**Trạng thái: BẢN NHÁP v1 — cần chốt tại workshop T-107 (tuần 1).**

## Quy tắc

- Mọi message dùng envelope: `message_id, type, version, occurred_at, trace_id?, tenant_id?, data`.
- Thay đổi schema theo hướng **tương thích ngược** (chỉ thêm field tùy chọn); thay đổi phá vỡ → tăng `version` và giữ schema cũ.
- Producer publish đúng topic theo `topicOf`; key partition theo comment trong `topics.ts`.
- Consumer luôn gọi `parseMessage` rồi kiểm tra Inbox (`processed_events`) trước khi xử lý.
- Tiền: số nguyên VND. ID: UUID (đổi sang UUIDv7 ở T-103).

## Lifecycle v2 (T-203, CONTRACT CHANGE)

`EventApproved` / `EventUpdated` v2 có toàn bộ dữ liệu Approved v1, thêm `seat_map_version`.
`EventCancelled` v2 thêm `event_version`. Hai phiên bản nghiệp vụ là số nguyên không âm;
producer tăng event_version với mỗi thay đổi của cùng event và partition key luôn là event_id.
Tạo message bằng `newMessage(type, data, { version: 2 })` rồi validate trước khi ghi Outbox.

Schema export `EventApprovedV1/V2`, `EventUpdatedV1/V2`, `EventCancelledV1/V2`;
schema tên không có hậu tố và `parseMessage` chấp nhận cả hai phiên bản.
`newMessage` vẫn mặc định envelope version 1 để giữ hành vi hiện có cho các sự kiện khác.

Consumer booking T-203 yêu cầu lifecycle v2: lifecycle v1 đi DLQ ngay vì thiếu dữ liệu
để bảo đảm snapshot. Producer của Sơn cần chuyển sang v2 và phát lại dữ liệu v2 hợp lệ;
không sửa version trên payload v1 thiếu trường. Xem [ADR-0011](../../docs/adr/0011-versioned-event-lifecycle.md).

## TicketRevoked v2 — Issue #72 (CONTRACT CHANGE)

`TicketRevokedV1` giữ bốn reason REFUNDED, TRANSFERRED, ADMIN, EVENT_CANCELLED.
`TicketRevokedV2` thêm USER_CANCELLED, EXPIRED, LATE_PAYMENT, STOCK_REJECTED,
PAYMENT_FAILED. Registry `TicketRevoked` và `parseMessage` đọc cả hai version.
Topic vẫn `ticket.events`, key `ticket_id`.

Producer S-303 dùng version 2 cho năm reason mới, version 1 cho reason cũ.
Trước khi phát version 2, cập nhật thư viện/parser cho tất cả consumer của topic,
đặc biệt notification, finance và resale. Consumer dùng schema cũ từ chối v2.
Sau khi xác nhận consumer đã cập nhật mới bật producer mới. Replay DLQ phải giữ
đúng message ID và version gốc. Tuấn review lựa chọn version/rollout trong PR hợp
đồng liên quan issue #72, triển khai môi trường thật cần một lượt vận hành riêng.

## Dùng

```ts
import { newMessage, parseMessage, Topics, topicOf } from "@ticketing/event-contracts";
const msg = newMessage("PaymentSucceeded", {/* ... */});
await producer.send({
  topic: topicOf.PaymentSucceeded,
  messages: [{ key: orderId, value: JSON.stringify(msg) }],
});
```
