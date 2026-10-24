# @ticketing/outbox-inbox

Thư viện dùng chung cho **Transactional Outbox + Inbox** theo ADR-0005. Mọi service dùng chung một bản `outbox_events` / `processed_events` (schema chuẩn: [`sql/outbox_inbox.sql`](./sql/outbox_inbox.sql)) và một cặp **producer → relay → consumer**.

## Ví dụ dùng (15 dòng)

```ts
import { newMessage } from "@ticketing/event-contracts";
import {
  OutboxService,
  OutboxRelay,
  createInboxConsumer,
  prismaDatabase,
} from "@ticketing/outbox-inbox";

const db = prismaDatabase(prisma);
const outbox = new OutboxService();

// 1. Ghi nghiệp vụ + sự kiện CÙNG một transaction (rollback => không có sự kiện).
await db.transaction(async (exec) => {
  const msg = newMessage("OrderAwaitingPayment", {
    order_id,
    user_id,
    event_id,
    amount_vnd,
    expires_at,
  });
  await prisma.order.create({ data: { id: order_id } });
  await outbox.add(exec, msg, order_id); // key = order_id (partition của booking.orders)
});

// 2. Relay: chạy nền trong service, publish outbox -> Kafka (idempotent, acks=all).
const relay = new OutboxRelay({ db, kafka, pollIntervalMs: 200, batchSize: 100 });
await relay.start();

// 3. Consumer: parse -> INSERT processed_events -> handler (cùng transaction) -> commit offset.
const consumer = createInboxConsumer({
  kafka,
  groupId: "booking-orders",
  consumerName: "payment-service",
  topics: ["booking.orders"],
  db,
  handler: async (exec, message) => {
    await handleOrder(exec, message);
  },
});
await consumer.start();
```

## API chính

| Thành phần                      | Công dụng                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SqlExecutor`                   | `{ query<T>(sql, params?): Promise<T[]> }` — thư viện **không phụ thuộc cứng vào Prisma**.                                                                                                                                                                                                                           |
| `fromPgClient`                  | Adapter cho `pg` (`Client`/`PoolClient`). `fromPrismaTx(tx)` cho Prisma transaction client.                                                                                                                                                                                                                          |
| `pgDatabase` / `prismaDatabase` | `Database { transaction(fn) }` — BEGIN/COMMIT/ROLLBACK cho relay & consumer.                                                                                                                                                                                                                                         |
| `OutboxService`                 | `add(exec, message, key)` — validate bằng `parseMessage`, `topic` lấy từ `topicOf`, ghi vào `outbox_events` trong transaction của caller.                                                                                                                                                                            |
| `OutboxRelay`                   | Polling `FOR UPDATE SKIP LOCKED` → publish Kafka (producer `idempotent: true`, `acks: -1`) → `published_at = now()`. `start()`/`stop()` graceful. Metric `outbox_relay_published_total`, `outbox_relay_errors_total`, `outbox_relay_publish_lag_seconds`.                                                            |
| `createInboxConsumer`           | `parseMessage` → 1 transaction: `INSERT processed_events ... ON CONFLICT DO NOTHING` (0 dòng ⇒ bỏ qua) → `handler(exec, message)` → commit offset. Sai schema ⇒ **DLQ ngay**; lỗi tạm thời ⇒ retry backoff + jitter (`maxAttempts`); quá hạn ⇒ `<topic>.dlq` với header `x-error`, `x-attempts`, `x-original-topic`. |
| `PermanentError`                | Handler ném lỗi này ⇒ vào DLQ ngay, không retry (lỗi chắc chắn không hết khi thử lại).                                                                                                                                                                                                                               |

## Đảm bảo

- **Không mất**: sự kiện chỉ bị đánh dấu `published_at` _sau khi_ Kafka đã nhận, trong cùng transaction. Relay chết giữa chừng ⇒ lượt sau gửi lại.
- **Có thể trùng, không xử lý trùng**: Kafka là at-least-once. `processed_events` chặn xử lý lần hai (khoá `(message_id, consumer)`). `consumerName` phải **ổn định** — đổi tên = xử lý lại từ đầu.
- **Không gửi trùng khi nhiều relay**: `FOR UPDATE SKIP LOCKED` ⇒ mỗi dòng chỉ một relay giữ.
- **Thứ tự theo key**: giữ được khi chỉ một relay hoạt động. Nhiều relay có thể để batch sau vượt trước batch trước của cùng key ⇒ luồng cần thứ tự chặt chẽ phải chạy **một relay cho mỗi DB**.

## Ghi chú

- `outbox_events.created_at` là thời điểm **bắt đầu** transaction nghiệp vụ (`now()` của Postgres), không phải thời điểm ghi dòng outbox.
- Metric chỉ đăng ký được **một** relay cho mỗi `prom-client` registry (truyền `registry` của service qua `createRelayMetrics(registry)`).
- Test: `pnpm test` (unit) · `pnpm test:int` (Testcontainers Postgres + Kafka) · `pnpm test:conc` (nhiều relay song song). Cần Docker.
