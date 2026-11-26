import { uuidv7 } from "uuidv7";
import { InboxHandler, PermanentError, SqlExecutor } from "@ticketing/outbox-inbox";

export const SYSTEM_ACTOR = "00000000-0000-4000-8000-000000000001";
export async function lockRefundEvent(exec: SqlExecutor, eventId: string): Promise<void> {
  await exec.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `refund-event:${eventId.toLowerCase()}`,
  ]);
}
export async function createBatch(
  exec: SqlExecutor,
  eventId: string,
  reason: string,
  actor: string,
  automatic: boolean,
): Promise<string> {
  await lockRefundEvent(exec, eventId);
  const [old] = await exec.query<{ id: string }>(
    "SELECT id FROM refund_batches WHERE event_id=$1::uuid ORDER BY created_at,id LIMIT 1 FOR UPDATE",
    [eventId],
  );
  if (old) {
    if (automatic)
      await exec.query(
        "UPDATE refund_batches SET automatic=true,reason='EVENT_CANCELLED',version=version+1,updated_at=now() WHERE id=$1::uuid AND automatic=false RETURNING id",
        [old.id],
      );
    return old.id;
  }
  const id = uuidv7();
  await exec.query(
    "INSERT INTO refund_batches(id,event_id,reason,status,created_by,automatic) VALUES($1::uuid,$2::uuid,$3,'PENDING',$4::uuid,$5) RETURNING id",
    [id, eventId, reason, actor, automatic],
  );
  return id;
}
export async function createRefunds(
  exec: SqlExecutor,
  eventId: string,
  reason: string,
  trace: string,
  batchId: string | null = null,
  orderId: string | null = null,
  actor: string | null = null,
): Promise<void> {
  const payments = await exec.query<{ id: string; amount_vnd: string }>(
    "SELECT id,amount_vnd FROM payments WHERE purpose='ORDER' AND status='SUCCEEDED' AND event_id=$1::uuid AND ($2::uuid IS NULL OR ref_id=$2::uuid) ORDER BY id",
    [eventId, orderId],
  );
  for (const p of payments) {
    await exec.query(
      `INSERT INTO refunds(id,payment_id,batch_id,amount_vnd,reason,trace_id,approved_by)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::uuid) ON CONFLICT(payment_id) DO NOTHING RETURNING id`,
      [uuidv7(), p.id, batchId, p.amount_vnd, reason, trace, actor],
    );
    if (batchId)
      await exec.query(
        "UPDATE refunds SET batch_id=$2::uuid,version=version+1,updated_at=now() WHERE payment_id=$1::uuid AND batch_id IS NULL RETURNING id",
        [p.id, batchId],
      );
  }
}

/** Inbox gọi handler này trong cùng transaction với processed_events. */
export const refundHandler: InboxHandler = async (exec, message) => {
  if (message.type === "OrderCancelled") {
    if (message.data.reason !== "LATE_PAYMENT") return;
    await lockRefundEvent(exec, message.data.event_id);
    await createRefunds(
      exec,
      message.data.event_id,
      "LATE_PAYMENT",
      message.trace_id ?? message.message_id,
      null,
      message.data.order_id,
    );
    return;
  }
  if (
    message.type !== "EventApproved" &&
    message.type !== "EventUpdated" &&
    message.type !== "EventCancelled"
  )
    return;
  if (message.version !== 2) throw new PermanentError("Refund lifecycle requires v2");
  const d = message.data;
  if (message.tenant_id && message.tenant_id.toLowerCase() !== d.organizer_id.toLowerCase())
    throw new PermanentError("Refund lifecycle tenant mismatch");
  await lockRefundEvent(exec, d.event_id);
  const [owner] = await exec.query<{ organizer_id: string }>(
    "SELECT organizer_id FROM refund_events WHERE id=$1::uuid",
    [d.event_id],
  );
  if (owner && owner.organizer_id !== d.organizer_id.toLowerCase())
    throw new PermanentError("Refund event owner mismatch");
  const changed = await exec.query(
    `INSERT INTO refund_events(id,organizer_id,event_version,cancelled) VALUES($1::uuid,$2::uuid,$3,$4)
    ON CONFLICT(id) DO UPDATE SET event_version=EXCLUDED.event_version,cancelled=EXCLUDED.cancelled,
      updated_at=now(),version=refund_events.version+1
    WHERE refund_events.event_version<EXCLUDED.event_version RETURNING id`,
    [d.event_id, d.organizer_id, d.event_version, message.type === "EventCancelled"],
  );
  if (!changed.length || message.type !== "EventCancelled") return;
  const batch = await createBatch(exec, d.event_id, "EVENT_CANCELLED", SYSTEM_ACTOR, true);
  await createRefunds(
    exec,
    d.event_id,
    "EVENT_CANCELLED",
    message.trace_id ?? message.message_id,
    batch,
  );
  await exec.query(
    "UPDATE payables SET status='CANCELLED',version=version+1,updated_at=now() WHERE event_id=$1::uuid AND purpose='ORDER' AND status='READY' RETURNING id",
    [d.event_id],
  );
};

/** Khóa sự kiện tuần tự hóa hủy và callback mà không gọi service khác. */
export async function refundCancelledPayment(
  exec: SqlExecutor,
  eventId: string,
  trace: string,
  orderId: string,
): Promise<void> {
  const [batch] = await exec.query<{ id: string; reason: string }>(
    "SELECT id,reason FROM refund_batches WHERE event_id=$1::uuid AND automatic=true",
    [eventId],
  );
  if (batch) await createRefunds(exec, eventId, "EVENT_CANCELLED", trace, batch.id, orderId);
}
