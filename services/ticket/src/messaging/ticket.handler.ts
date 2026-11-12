import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { newMessage } from "@ticketing/event-contracts";
import { OutboxService, ParsedMessage, PermanentError, SqlExecutor } from "@ticketing/outbox-inbox";
import { uuidv7 } from "uuidv7";
import { TicketSecrets } from "../modules/tickets/ticket-secrets";

@Injectable()
export class TicketHandler {
  private readonly outbox = new OutboxService();

  constructor(private readonly secrets: TicketSecrets) {}

  async handle(executor: SqlExecutor, message: ParsedMessage): Promise<void> {
    if (
      message.type === "EventApproved" ||
      message.type === "EventUpdated" ||
      message.type === "EventCancelled"
    ) {
      await this.lifecycle(executor, message);
      return;
    }
    if (
      message.type !== "OrderConfirmed" &&
      message.type !== "OrderCancelled" &&
      message.type !== "RefundCompleted"
    )
      return;
    await executor.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [
      message.data.order_id,
    ]);
    if (message.type !== "OrderConfirmed") {
      await this.invalidate(executor, message);
      return;
    }
    const order = message.data;
    const invalidations = await executor.query<{ event_id: string | null }>(
      "SELECT event_id FROM ticket_order_invalidations WHERE order_id=$1::uuid",
      [order.order_id],
    );
    if (invalidations.length > 0) {
      if (invalidations[0].event_id && invalidations[0].event_id !== order.event_id)
        throw new PermanentError("ORDER_EVENT_CONFLICT");
      return;
    }
    const items = [...order.items].sort((first, second) =>
      first.order_item_id.localeCompare(second.order_item_id),
    );
    if (new Set(items.map((item) => item.order_item_id)).size !== items.length)
      throw new PermanentError("DUPLICATE_ORDER_ITEM");
    if (
      items.some(
        (item) =>
          !Number.isSafeInteger(item.unit_price_vnd) || !Number.isSafeInteger(item.quantity),
      )
    )
      throw new PermanentError("INVALID_TICKET_AMOUNT_OR_QUANTITY");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ ...order, items, tenant_id: message.tenant_id ?? null }))
      .digest("hex");
    const inserted = await executor.query<{ order_id: string }>(
      "INSERT INTO ticket_issuances (order_id, fingerprint) VALUES ($1::uuid, $2) ON CONFLICT DO NOTHING RETURNING order_id",
      [order.order_id, fingerprint],
    );
    if (inserted.length === 0) {
      const existing = await executor.query<{ fingerprint: string }>(
        "SELECT fingerprint FROM ticket_issuances WHERE order_id=$1::uuid",
        [order.order_id],
      );
      if (existing[0]?.fingerprint !== fingerprint)
        throw new PermanentError("ORDER_CONFIRMATION_CONFLICT");
      return;
    }
    for (const item of items) {
      if (item.item_type === "MERCH") continue;
      for (let unitIndex = 1; unitIndex <= item.quantity; unitIndex++) {
        const ticketId = uuidv7();
        const seatId = item.item_type === "TICKET_SEAT" ? item.ref_id : null;
        await executor.query(
          `INSERT INTO tickets (id, order_id, order_item_id, unit_index, event_id, organizer_id,
           item_type, ref_id, seat_id, owner_user_id, unit_price_vnd)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6::uuid,$7,$8::uuid,$9::uuid,$10::uuid,$11::bigint)`,
          [
            ticketId,
            order.order_id,
            item.order_item_id,
            unitIndex,
            order.event_id,
            message.tenant_id ?? null,
            item.item_type,
            item.ref_id,
            seatId,
            order.user_id,
            item.unit_price_vnd,
          ],
        );
        const secret = randomBytes(20);
        try {
          const encrypted = this.secrets.encrypt(ticketId, 1, secret);
          await executor.query(
            "INSERT INTO ticket_secrets (id,ticket_id,version,secret_enc,key_id) VALUES ($1::uuid,$2::uuid,1,$3,$4)",
            [uuidv7(), ticketId, encrypted.ciphertext, encrypted.keyId],
          );
        } finally {
          secret.fill(0);
        }
        await this.outbox.add(
          executor,
          newMessage(
            "TicketIssued",
            {
              ticket_id: ticketId,
              order_id: order.order_id,
              order_item_id: item.order_item_id,
              event_id: order.event_id,
              seat_id: seatId,
              owner_user_id: order.user_id,
            },
            { trace_id: message.trace_id, tenant_id: message.tenant_id },
          ),
          ticketId,
        );
      }
    }
  }
  private async lifecycle(
    executor: SqlExecutor,
    message: Extract<ParsedMessage, { type: "EventApproved" | "EventUpdated" | "EventCancelled" }>,
  ): Promise<void> {
    const data = message.data;
    if (message.tenant_id && message.tenant_id !== data.organizer_id)
      throw new PermanentError("EVENT_TENANT_CONFLICT");
    const version = "event_version" in data ? data.event_version : 0;
    if (version < 0) throw new PermanentError("INVALID_EVENT_VERSION");
    const rows = await executor.query<{ id: string }>(
      `INSERT INTO ticket_events (id,organizer_id,source_version,cancelled) VALUES ($1::uuid,$2::uuid,$3,$4)
       ON CONFLICT (id) DO UPDATE SET source_version=GREATEST(ticket_events.source_version,EXCLUDED.source_version),
       cancelled=ticket_events.cancelled OR EXCLUDED.cancelled,version=ticket_events.version+1,updated_at=now()
       WHERE ticket_events.organizer_id=EXCLUDED.organizer_id
       AND (EXCLUDED.source_version>ticket_events.source_version OR EXCLUDED.cancelled AND NOT ticket_events.cancelled)
       RETURNING id`,
      [data.event_id, data.organizer_id, version, message.type === "EventCancelled"],
    );
    if (rows.length === 0) {
      const [existing] = await executor.query<{ organizer_id: string }>(
        "SELECT organizer_id FROM ticket_events WHERE id=$1::uuid",
        [data.event_id],
      );
      if (existing?.organizer_id !== data.organizer_id)
        throw new PermanentError("EVENT_ORGANIZER_CONFLICT");
    }
  }

  private async invalidate(
    executor: SqlExecutor,
    message: Extract<ParsedMessage, { type: "OrderCancelled" | "RefundCompleted" }>,
  ): Promise<void> {
    const orderId = message.data.order_id;
    const refunded = message.type === "RefundCompleted";
    const status = refunded ? "REFUNDED" : "REVOKED";
    const eventId = message.type === "OrderCancelled" ? message.data.event_id : null;
    if (eventId) {
      const conflicting = await executor.query<{ id: string }>(
        "SELECT id FROM tickets WHERE order_id=$1::uuid AND event_id<>$2::uuid LIMIT 1",
        [orderId, eventId],
      );
      if (conflicting.length > 0) throw new PermanentError("ORDER_EVENT_CONFLICT");
      const previous = await executor.query<{ event_id: string | null }>(
        "SELECT event_id FROM ticket_order_invalidations WHERE order_id=$1::uuid",
        [orderId],
      );
      if (previous[0]?.event_id && previous[0].event_id !== eventId)
        throw new PermanentError("ORDER_EVENT_CONFLICT");
    }
    await executor.query(
      `INSERT INTO ticket_order_invalidations (order_id,status,event_id) VALUES ($1::uuid,$2,$3::uuid)
       ON CONFLICT (order_id) DO UPDATE SET status=CASE WHEN ticket_order_invalidations.status='REFUNDED' THEN 'REFUNDED' ELSE EXCLUDED.status END,
       event_id=COALESCE(ticket_order_invalidations.event_id,EXCLUDED.event_id), updated_at=now(), version=ticket_order_invalidations.version+1
       WHERE ticket_order_invalidations.status<>EXCLUDED.status OR ticket_order_invalidations.event_id IS NULL AND EXCLUDED.event_id IS NOT NULL`,
      [orderId, status, eventId],
    );
    const tickets = await executor.query<{ id: string }>(
      `UPDATE tickets SET status=$2, version=version+1, updated_at=now()
       WHERE order_id=$1::uuid AND status<>$2 AND status<>'REFUNDED' RETURNING id`,
      [orderId, status],
    );
    await executor.query(
      "UPDATE ticket_secrets SET revoked_at=now() WHERE revoked_at IS NULL AND ticket_id IN (SELECT id FROM tickets WHERE order_id=$1::uuid)",
      [orderId],
    );
    const reason = message.type === "RefundCompleted" ? "REFUNDED" : message.data.reason;
    const eventVersion = reason === "REFUNDED" || reason === "EVENT_CANCELLED" ? 1 : 2;
    for (const ticket of tickets)
      await this.outbox.add(
        executor,
        newMessage(
          "TicketRevoked",
          { ticket_id: ticket.id, reason },
          { version: eventVersion, trace_id: message.trace_id, tenant_id: message.tenant_id },
        ),
        ticket.id,
      );
  }
}
