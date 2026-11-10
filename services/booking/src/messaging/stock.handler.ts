import { newMessage } from "@ticketing/event-contracts";
import { InboxHandler, OutboxService, PermanentError } from "@ticketing/outbox-inbox";
import { transition } from "../orders/order-state";
import { releaseOrderStock, SagaOrder } from "../orders/order-saga";

export function stockHandler(): InboxHandler {
  return async (exec, message) => {
    if (message.type !== "StockReserved" && message.type !== "StockRejected") return;
    const rows = await exec.query<SagaOrder>("SELECT * FROM orders WHERE id=$1::uuid FOR UPDATE", [
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
      await transition(exec, order.id, order.status, "CANCELLED", order.version);
      await releaseOrderStock(exec, order);
      await outbox.add(
        exec,
        newMessage(
          "OrderCancelled",
          { order_id: order.id, event_id: order.event_id, reason: "STOCK_REJECTED" },
          { trace_id: message.trace_id },
        ),
        order.id,
      );
    }
  };
}
