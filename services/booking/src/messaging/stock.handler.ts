import { newMessage } from "@ticketing/event-contracts";
import { InboxHandler, OutboxService, PermanentError } from "@ticketing/outbox-inbox";
import { transition, OrderStatus } from "../orders/order-state";

interface StockOrder {
  id: string;
  user_id: string;
  event_id: string;
  status: OrderStatus;
  version: number;
  total_amount_vnd: string;
  expires_at: Date;
}
export function stockHandler(
  release: (user: string, event: string, seats: string[]) => Promise<void>,
): InboxHandler {
  return async (exec, message) => {
    if (message.type !== "StockReserved" && message.type !== "StockRejected") return;
    const rows = await exec.query<StockOrder>("SELECT * FROM orders WHERE id=$1::uuid FOR UPDATE", [
      message.data.order_id,
    ]);
    const order = rows[0];
    if (!order) throw new Error("Stock order not visible yet");
    if (message.type === "StockReserved" && order.status !== "PENDING") return;
    if (
      message.type === "StockRejected" &&
      order.status !== "PENDING" &&
      order.status !== "AWAITING_PAYMENT"
    )
      return;
    const merch = await exec.query<{ ref_id: string; quantity: number }>(
      "SELECT ref_id,quantity FROM order_items WHERE order_id=$1::uuid AND item_type='MERCH' ORDER BY ref_id",
      [order.id],
    );
    if (!merch.length) return;
    const outbox = new OutboxService();
    if (message.type === "StockReserved") {
      const actual = [...message.data.reservations].sort((a, b) =>
        a.sku_id.localeCompare(b.sku_id),
      );
      if (
        actual.length !== merch.length ||
        actual.some(
          (i, n) => i.sku_id.toLowerCase() !== merch[n].ref_id || i.quantity !== merch[n].quantity,
        )
      )
        throw new PermanentError("Stock reservations do not match order merchandise");
      if (order.expires_at.getTime() <= Date.now()) return;
      await transition(exec, order.id, "PENDING", "AWAITING_PAYMENT", order.version);
      await outbox.add(
        exec,
        newMessage(
          "OrderAwaitingPayment",
          {
            order_id: order.id,
            user_id: order.user_id,
            event_id: order.event_id,
            amount_vnd: Number(order.total_amount_vnd),
            expires_at: order.expires_at.toISOString(),
          },
          { trace_id: message.trace_id },
        ),
        order.id,
      );
    } else {
      if (!merch.some((i) => i.ref_id === message.data.sku_id.toLowerCase()))
        throw new PermanentError("Rejected SKU does not belong to order");
      const seats = await exec.query<{ seat_id: string }>(
        "SELECT seat_id FROM seat_allocations WHERE order_id=$1::uuid AND state='HELD' ORDER BY seat_id",
        [order.id],
      );
      const stock = await exec.query<{ class_id: string; quantity: string }>(
        `SELECT ref_id AS class_id, sum(quantity)::text AS quantity
         FROM order_items WHERE order_id=$1::uuid AND item_type='TICKET_GA'
         GROUP BY ref_id ORDER BY ref_id`,
        [order.id],
      );
      await transition(exec, order.id, order.status, "CANCELLED", order.version);
      await exec.query(
        "UPDATE seat_allocations SET state='RELEASED',version=version+1,updated_at=now() WHERE order_id=$1::uuid AND state='HELD' RETURNING id",
        [order.id],
      );
      for (const item of stock) {
        const changed = await exec.query(
          "UPDATE ticket_class_stock SET sold=sold-$2,version=version+1,updated_at=now() WHERE class_id=$1::uuid AND sold >= $2 RETURNING class_id",
          [item.class_id, Number(item.quantity)],
        );
        if (changed.length !== 1) throw new Error("Cannot compensate ticket stock");
      }
      await outbox.add(
        exec,
        newMessage(
          "OrderCancelled",
          { order_id: order.id, event_id: order.event_id, reason: "STOCK_REJECTED" },
          { trace_id: message.trace_id },
        ),
        order.id,
      );
      // Trước commit: Redis lỗi sẽ rollback Inbox/DB, để consumer retry cleanup.
      // Nếu commit lỗi sau cleanup, DB vẫn giữ allocation nên unique index chặn bán trùng.
      await release(
        order.user_id,
        order.event_id,
        seats.map((s) => s.seat_id),
      );
    }
  };
}
