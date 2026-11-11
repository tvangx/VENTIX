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
    if (message.type !== "OrderConfirmed") return;
    const order = message.data;
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
}
