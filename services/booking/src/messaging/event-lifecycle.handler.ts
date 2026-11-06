import { PermanentError, type InboxHandler } from "@ticketing/outbox-inbox";

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
    const owner = await exec.query<{ organizer_id: string }>(
      "SELECT organizer_id FROM event_snapshots WHERE event_id=$1::uuid",
      [data.event_id],
    );
    if (owner[0]?.organizer_id !== data.organizer_id.toLowerCase())
      throw new PermanentError("Snapshot organizer mismatch");
    return;
  }
  // Chỉ bản snapshot được chấp nhận mới được thay đổi stock.
  for (const ticketClass of [...classes].sort((a, b) => a.id.localeCompare(b.id))) {
    await exec.query(
      `INSERT INTO ticket_class_stock (class_id,total,sold) VALUES ($1::uuid,$2,0)
       ON CONFLICT (class_id) DO UPDATE SET total=GREATEST(EXCLUDED.total,ticket_class_stock.sold),
         version=ticket_class_stock.version+1, updated_at=now() RETURNING class_id`,
      [ticketClass.id, ticketClass.capacity],
    );
  }
};
