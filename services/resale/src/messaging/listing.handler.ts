import { Injectable } from "@nestjs/common";
import { newMessage } from "@ticketing/event-contracts";
import { OutboxService, ParsedMessage, PermanentError, SqlExecutor } from "@ticketing/outbox-inbox";
import { ListingRepository } from "../modules/listings/listing.repository";

@Injectable()
export class ListingHandler {
  private readonly outbox = new OutboxService();
  constructor(private readonly listings: ListingRepository) {}

  async handle(executor: SqlExecutor, message: ParsedMessage): Promise<void> {
    if (message.type !== "TicketRevoked" && message.type !== "TicketCheckedIn") return;
    if (message.type === "TicketRevoked" && message.data.reason === "TRANSFERRED") return;
    const ticketId = message.data.ticket_id.toLowerCase();
    await this.listings.lockTicket(executor, ticketId);
    if (message.tenant_id) {
      const conflicts = await executor.query(
        `SELECT id FROM listings WHERE ticket_id=$1::uuid AND organizer_id IS NOT NULL AND organizer_id<>$2::uuid
        UNION ALL SELECT id FROM listing_operations WHERE ticket_id=$1::uuid AND organizer_id IS NOT NULL AND organizer_id<>$2::uuid LIMIT 1`,
        [ticketId, message.tenant_id],
      );
      if (conflicts.length > 0) throw new PermanentError("TICKET_TENANT_CONFLICT");
    }
    const status = message.type === "TicketRevoked" ? "REVOKED" : "CHECKED_IN";
    await executor.query(
      `INSERT INTO resale_ticket_invalidations (id,status) VALUES ($1::uuid,$2)
      ON CONFLICT (id) DO UPDATE SET status=CASE WHEN resale_ticket_invalidations.status='REVOKED' THEN 'REVOKED' ELSE EXCLUDED.status END,
      version=resale_ticket_invalidations.version+1,updated_at=now()
      WHERE resale_ticket_invalidations.status<>EXCLUDED.status`,
      [ticketId, status],
    );
    const rows = await executor.query<{ id: string; organizer_id: string | null }>(
      "UPDATE listings SET status='CANCELLED',version=version+1,updated_at=now() WHERE ticket_id=$1::uuid AND status='ACTIVE' RETURNING id,organizer_id",
      [ticketId],
    );
    for (const listing of rows)
      await this.outbox.add(
        executor,
        newMessage(
          "ListingCancelled",
          { listing_id: listing.id, ticket_id: ticketId },
          { tenant_id: listing.organizer_id ?? message.tenant_id, trace_id: message.trace_id },
        ),
        listing.id,
      );
  }
}
