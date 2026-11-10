import { randomUUID } from "node:crypto";
import { EventMessage, newMessage, parseMessage } from "@ticketing/event-contracts";
import { Database, OutboxService, PermanentError, SqlExecutor } from "@ticketing/outbox-inbox";
import { SeatHoldRedisClient } from "../seat-hold/seat-hold-redis";
import { OrderStatus, transition } from "./order-state";

export interface SagaOrder {
  id: string;
  user_id: string;
  event_id: string;
  status: OrderStatus;
  version: number;
  ticket_amount_vnd: string;
  merch_amount_vnd: string;
  total_amount_vnd: string;
  expires_at: Date;
}

export async function enqueueSagaWork(
  exec: SqlExecutor,
  orderId: string,
  kind: "PAYMENT" | "SELL" | "RELEASE",
  payload: unknown,
  id: string = randomUUID(),
): Promise<void> {
  await exec.query(
    "INSERT INTO order_saga_work(id,order_id,kind,payload) VALUES($1::uuid,$2::uuid,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",
    [id, orderId, kind, JSON.stringify(payload)],
  );
}

export async function confirmPayment(
  exec: SqlExecutor,
  order: SagaOrder,
  message: EventMessage<"PaymentSucceeded">,
): Promise<void> {
  if (BigInt(order.total_amount_vnd) !== BigInt(message.data.amount_vnd))
    throw new PermanentError("Payment amount does not match order");
  if (order.status === "PENDING") {
    // Inbox có thể commit; công việc này chỉ được xóa sau khi order rời PENDING.
    await enqueueSagaWork(exec, order.id, "PAYMENT", message, message.message_id);
    return;
  }
  const outbox = new OutboxService();
  const metadata = { trace_id: message.trace_id, tenant_id: message.tenant_id };
  if (["EXPIRED", "FAILED", "CANCELLED"].includes(order.status)) {
    await transition(exec, order.id, order.status, "REFUND_REQUIRED", order.version);
    await outbox.add(
      exec,
      newMessage(
        "OrderCancelled",
        {
          order_id: order.id,
          event_id: order.event_id,
          reason: "LATE_PAYMENT",
        },
        metadata,
      ),
      order.id,
    );
    return;
  }
  if (order.status !== "AWAITING_PAYMENT") return;
  const items = await exec.query<{
    order_item_id: string;
    item_type: "TICKET_SEAT" | "TICKET_GA" | "MERCH";
    ref_id: string;
    quantity: number;
    unit_price_vnd: string;
  }>(
    "SELECT id AS order_item_id,item_type,ref_id,quantity,unit_price_vnd FROM order_items WHERE order_id=$1::uuid ORDER BY id",
    [order.id],
  );
  const sold = await exec.query<{ seat_id: string }>(
    "UPDATE seat_allocations SET state='SOLD',version=version+1,updated_at=now() WHERE order_id=$1::uuid AND state='HELD' RETURNING seat_id",
    [order.id],
  );
  if (sold.length !== items.filter((i) => i.item_type === "TICKET_SEAT").length)
    throw new Error("Order seat allocations are not all HELD");
  await transition(exec, order.id, "AWAITING_PAYMENT", "CONFIRMED", order.version);
  await enqueueSagaWork(exec, order.id, "SELL", { trace_id: message.trace_id });
  const confirmed = newMessage(
    "OrderConfirmed",
    {
      order_id: order.id,
      user_id: order.user_id,
      event_id: order.event_id,
      payment_id: message.data.payment_id,
      items: items.map((i) => ({ ...i, unit_price_vnd: Number(i.unit_price_vnd) })),
      ticket_amount_vnd: Number(order.ticket_amount_vnd),
      merch_amount_vnd: Number(order.merch_amount_vnd),
      total_amount_vnd: Number(order.total_amount_vnd),
      confirmed_at: new Date().toISOString(),
    },
    metadata,
  );
  // Validate cả bất biến tổng tiền trước khi transaction có thể commit.
  parseMessage(confirmed);
  await outbox.add(exec, confirmed, order.id);
}

export async function releaseOrderStock(exec: SqlExecutor, order: SagaOrder): Promise<void> {
  await exec.query(
    "UPDATE seat_allocations SET state='RELEASED',version=version+1,updated_at=now() WHERE order_id=$1::uuid AND state='HELD' RETURNING id",
    [order.id],
  );
  const stock = await exec.query<{ class_id: string; quantity: string }>(
    "SELECT ref_id AS class_id,sum(quantity)::text AS quantity FROM order_items WHERE order_id=$1::uuid AND item_type='TICKET_GA' GROUP BY ref_id ORDER BY ref_id",
    [order.id],
  );
  for (const item of stock) {
    const changed = await exec.query(
      "UPDATE ticket_class_stock SET sold=sold-$2,version=version+1,updated_at=now() WHERE class_id=$1::uuid AND sold >= $2 RETURNING class_id",
      [item.class_id, Number(item.quantity)],
    );
    if (changed.length !== 1) throw new Error("Cannot compensate ticket stock");
  }
  await enqueueSagaWork(exec, order.id, "RELEASE", {});
}

export async function sweepExpiredOrders(exec: SqlExecutor, graceSeconds: number): Promise<number> {
  const orders = await exec.query<SagaOrder>(
    `SELECT * FROM orders WHERE status IN ('PENDING','AWAITING_PAYMENT')
     AND expires_at < now()-($1 * interval '1 second')
     ORDER BY expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`,
    [graceSeconds],
  );
  for (const order of orders) {
    await transition(exec, order.id, order.status, "EXPIRED", order.version);
    await releaseOrderStock(exec, order);
    await new OutboxService().add(
      exec,
      newMessage(
        "OrderExpired",
        {
          order_id: order.id,
          event_id: order.event_id,
        },
        { trace_id: `order-expiry:${order.id}` },
      ),
      order.id,
    );
  }
  return orders.length;
}

export async function drainSagaWork(
  db: Database,
  cache: Pick<SeatHoldRedisClient, "connected">,
  onError?: (orderId: string) => void,
): Promise<number> {
  // Toujours verrouiller order AVANT ses travaux, comme les handlers et le sweeper.
  const ids = await db.transaction((exec) =>
    exec.query<{ id: string }>(
      `SELECT id FROM orders o WHERE EXISTS (
       SELECT 1 FROM order_saga_work w WHERE w.order_id=o.id AND (w.kind<>'PAYMENT' OR o.status<>'PENDING')
     ) ORDER BY id LIMIT 100`,
    ),
  );
  let count = 0;
  for (const { id } of ids) {
    count += await db
      .transaction(async (exec) => {
        const [order] = await exec.query<SagaOrder>(
          "SELECT * FROM orders WHERE id=$1::uuid FOR UPDATE SKIP LOCKED",
          [id],
        );
        if (!order) return 0;
        const work = await exec.query<{ id: string; kind: string; payload: unknown }>(
          "SELECT * FROM order_saga_work WHERE order_id=$1::uuid ORDER BY created_at,id FOR UPDATE",
          [id],
        );
        let done = 0;
        for (const task of work) {
          if (task.kind === "PAYMENT") {
            if (order.status === "PENDING") continue;
            const message = parseMessage(task.payload);
            if (message.type !== "PaymentSucceeded")
              throw new Error("Invalid pending payment work");
            await confirmPayment(exec, order, message);
            // Các công việc còn lại phải nhìn thấy version/trạng thái vừa thay đổi.
            Object.assign(
              order,
              (await exec.query<SagaOrder>("SELECT * FROM orders WHERE id=$1::uuid", [id]))[0],
            );
          } else {
            if (task.kind === "RELEASE") {
              // Checkout cùng user/event dùng cùng khóa; không nhả allocation mới
              // vừa tái dùng hold và deadline của order cũ trước khi cleanup chạy.
              await exec.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
                `checkout:user:${order.event_id}:${order.user_id}`,
              ]);
            }
            const seats = await exec.query<{ seat_id: string }>(
              `SELECT a.seat_id FROM seat_allocations a WHERE a.order_id=$1::uuid AND a.state=$2
             AND ($2='SOLD' OR NOT EXISTS (SELECT 1 FROM seat_allocations active
               WHERE active.event_id=a.event_id AND active.seat_id=a.seat_id
               AND active.order_id<>a.order_id AND active.state IN ('HELD','SOLD')))
             ORDER BY a.seat_id`,
              [id, task.kind === "SELL" ? "SOLD" : "RELEASED"],
            );
            if (seats.length) {
              const redis = await cache.connected();
              const slot = `{evt:${order.event_id}}`;
              await redis.sagaSeats(
                4 + seats.length,
                `hold:${slot}:${order.user_id}`,
                `sold:${slot}`,
                `hexp:${slot}`,
                `delta:${slot}`,
                ...seats.map((s) => `seat:${slot}:${s.seat_id}`),
                task.kind,
                `H:${order.user_id}`,
                order.expires_at.getTime(),
                ...seats.map((s) => s.seat_id),
              );
            }
          }
          await exec.query("DELETE FROM order_saga_work WHERE id=$1::uuid RETURNING id", [task.id]);
          done++;
        }
        return done;
      })
      .catch((error: unknown) => {
        if (!onError) throw error;
        onError(id);
        return 0;
      });
  }
  return count;
}
