import { Injectable } from "@nestjs/common";
import { TicketRepository } from "../tickets/ticket.repository";

@Injectable()
export class VerifyRepository {
  constructor(private readonly tickets: TicketRepository) {}
  async find(ticketId: string) {
    const result = await this.tickets.pool.query<{
      id: string;
      status: string;
      mint_status: string | null;
      provider: string | null;
      token_id: string | null;
      tx_hash: string | null;
    }>(
      `SELECT t.id,t.status,n.status AS mint_status,n.provider,n.token_id,n.tx_hash
        FROM tickets t LEFT JOIN nft_mints n ON n.ticket_id=t.id WHERE t.id=$1::uuid`,
      [ticketId],
    );
    return result.rows[0];
  }
}
