import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { ParsedMessage, PermanentError, SqlExecutor } from "@ticketing/outbox-inbox";
import { uuidv7 } from "uuidv7";

@Injectable()
export class NftHandler {
  async handle(executor: SqlExecutor, message: ParsedMessage): Promise<void> {
    if (message.type !== "TicketIssued") return;
    const data = message.data;
    // Danh sách trường cố định: thứ tự key JSON không làm đổi business fingerprint.
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          data.ticket_id.toLowerCase(),
          data.order_id.toLowerCase(),
          data.order_item_id.toLowerCase(),
          data.event_id.toLowerCase(),
          data.seat_id?.toLowerCase() ?? null,
          data.owner_user_id.toLowerCase(),
          message.tenant_id?.toLowerCase() ?? null,
        ]),
      )
      .digest("hex");
    const ticket = await executor.query<{ id: string }>(
      `SELECT id FROM tickets WHERE id=$1::uuid AND order_id=$2::uuid AND order_item_id=$3::uuid
       AND event_id=$4::uuid AND seat_id IS NOT DISTINCT FROM $5::uuid
       AND organizer_id IS NOT DISTINCT FROM $6::uuid`,
      [
        data.ticket_id,
        data.order_id,
        data.order_item_id,
        data.event_id,
        data.seat_id,
        message.tenant_id ?? null,
      ],
    );
    if (!ticket.length) throw new PermanentError("NFT_TICKET_MISMATCH");
    const inserted = await executor.query<{ id: string }>(
      `INSERT INTO nft_mints (id,ticket_id,event_id,fingerprint,source_message_id,trace_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6)
       ON CONFLICT (ticket_id) DO NOTHING RETURNING id`,
      [
        uuidv7(),
        data.ticket_id,
        data.event_id,
        fingerprint,
        message.message_id,
        message.trace_id ?? message.message_id,
      ],
    );
    if (!inserted.length) {
      const existing = await executor.query<{ fingerprint: string }>(
        "SELECT fingerprint FROM nft_mints WHERE ticket_id=$1::uuid",
        [data.ticket_id],
      );
      if (existing[0]?.fingerprint !== fingerprint)
        throw new PermanentError("NFT_ISSUANCE_CONFLICT");
    }
  }
}
