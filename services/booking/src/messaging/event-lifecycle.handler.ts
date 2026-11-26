import { PermanentError, type InboxHandler } from "@ticketing/outbox-inbox";
import { OutboxService } from "@ticketing/outbox-inbox";
import { newMessage } from "@ticketing/event-contracts";
import { releaseOrderStock, SagaOrder } from "../orders/order-saga";
import { transition } from "../orders/order-state";

/** Inbox và snapshot/stock dùng chung executor, rollback cùng nhau. */
export const handleEventLifecycle: InboxHandler = async (exec, message) => {
  if (
    message.type !== "EventApproved" &&
    message.type !== "EventUpdated" &&
    message.type !== "EventCancelled"
  )
    return;
  if (message.version !== 2)
    throw new PermanentError("Lifecycle v2 required; replay a complete versioned snapshot");
  const data = message.data;
  if (message.tenant_id && message.tenant_id.toLowerCase() !== data.organizer_id.toLowerCase()) {
    throw new PermanentError("Lifecycle tenant does not match organizer");
  }
  const cancelled = message.type === "EventCancelled";
  const classes = message.type === "EventCancelled" ? [] : message.data.ticket_classes;
  const phases = message.type === "EventCancelled" ? [] : message.data.sale_phases;
  const mapVersion = message.type === "EventCancelled" ? 0 : message.data.seat_map_version;
  const updated = await exec.query<{ event_id: string }>(
    `INSERT INTO event_snapshots
      (event_id, organizer_id, status, event_version, seat_map_version, pricing_ready, ticket_classes, sale_window)
     VALUES ($1::uuid,$2::uuid,$3,$4,$5,false,$6::jsonb,$7::jsonb)
     ON CONFLICT (event_id) DO UPDATE SET
       status = EXCLUDED.status, event_version = EXCLUDED.event_version,
       seat_map_version = CASE WHEN $8 THEN event_snapshots.seat_map_version ELSE EXCLUDED.seat_map_version END,
       ticket_classes = CASE WHEN $8 THEN event_snapshots.ticket_classes ELSE EXCLUDED.ticket_classes END,
       sale_window = CASE WHEN $8 THEN event_snapshots.sale_window ELSE EXCLUDED.sale_window END,
       pricing_ready = CASE WHEN $8 OR event_snapshots.seat_map_version <> EXCLUDED.seat_map_version
         THEN false ELSE event_snapshots.pricing_ready END,
       synced_at = now()
     WHERE event_snapshots.event_version < EXCLUDED.event_version
       AND ($8 OR event_snapshots.seat_map_version <= EXCLUDED.seat_map_version)
       AND event_snapshots.organizer_id = EXCLUDED.organizer_id
     RETURNING event_id`,
    [
      data.event_id,
      data.organizer_id,
      cancelled ? "CANCELLED" : "APPROVED",
      data.event_version,
      mapVersion,
      JSON.stringify(classes),
      JSON.stringify(phases),
      cancelled,
    ],
  );
  if (!updated.length) {
    const owner = await exec.query<{ organizer_id: string; status: string; event_version: number }>(
      "SELECT organizer_id,status,event_version FROM event_snapshots WHERE event_id=$1::uuid",
      [data.event_id],
    );
    if (owner[0]?.organizer_id !== data.organizer_id.toLowerCase())
      throw new PermanentError("Snapshot organizer mismatch");
    // Replay T-401: snapshot đã hủy trước khi consumer biết hủy order.
    if (
      cancelled &&
      owner[0]?.status === "CANCELLED" &&
      owner[0].event_version === data.event_version
    )
      await cancelUnfinishedOrders(exec, message);
    return;
  }
  // Chỉ bản snapshot được chấp nhận mới được thay đổi stock.
  if (cancelled) {
    await cancelUnfinishedOrders(exec, message);
  }
  for (const ticketClass of [...classes].sort((a, b) => a.id.localeCompare(b.id))) {
    await exec.query(
      `INSERT INTO ticket_class_stock (class_id,total,sold) VALUES ($1::uuid,$2,0)
       ON CONFLICT (class_id) DO UPDATE SET total=GREATEST(EXCLUDED.total,ticket_class_stock.sold),
         version=ticket_class_stock.version+1, updated_at=now() RETURNING class_id`,
      [ticketClass.id, ticketClass.capacity],
    );
  }
};

async function cancelUnfinishedOrders(
  exec: Parameters<InboxHandler>[0],
  message: Parameters<InboxHandler>[1],
): Promise<void> {
  if (message.type !== "EventCancelled") return;
  // Snapshot đang bị khóa: checkout FOR SHARE không thể tạo order sau lần quét này.
  const orders = await exec.query<SagaOrder>(
    "SELECT * FROM orders WHERE event_id=$1::uuid AND status IN ('PENDING','AWAITING_PAYMENT') ORDER BY id FOR UPDATE",
    [message.data.event_id],
  );
  for (const order of orders) {
    await transition(exec, order.id, order.status, "CANCELLED", order.version);
    await releaseOrderStock(exec, order);
    await new OutboxService().add(
      exec,
      newMessage(
        "OrderCancelled",
        { order_id: order.id, event_id: order.event_id, reason: "EVENT_CANCELLED" },
        { trace_id: message.trace_id ?? message.message_id, tenant_id: message.data.organizer_id },
      ),
      order.id,
    );
  }
}
