import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { TicketRepository } from "./ticket.repository";
import { TicketSecrets } from "./ticket-secrets";
import { TicketPage, TicketQuery, TicketToken } from "./ticket.dto";
import { totp } from "./totp";

@Injectable()
export class TicketService {
  constructor(
    private readonly repo: TicketRepository,
    private readonly secrets: TicketSecrets,
  ) {}

  async list(userId: string, query: TicketQuery): Promise<TicketPage> {
    const rows = await this.repo.listOwned(userId, query.cursor, query.limit + 1);
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return { items, next_cursor: hasMore ? items[items.length - 1].id : null };
  }

  async token(userId: string, ticketId: string): Promise<TicketToken> {
    const ticket = await this.repo.ownedSecret(userId, ticketId);
    if (!ticket) throw new ProblemException("TICKET_NOT_FOUND", 404, "Không tìm thấy vé");
    if (ticket.status !== "ACTIVE")
      throw new ProblemException("TICKET_NOT_ACTIVE", 409, "Vé không ở trạng thái hoạt động");
    if (!ticket.secret_enc || !ticket.key_id)
      throw new ProblemException(
        "TICKET_SECRET_UNAVAILABLE",
        503,
        "Secret hiện hành chưa sẵn sàng",
      );
    let secret: Buffer;
    try {
      secret = this.secrets.decrypt(ticketId, ticket.secret_version, {
        keyId: ticket.key_id,
        ciphertext: ticket.secret_enc,
      });
    } catch {
      throw new ProblemException(
        "TICKET_SECRET_UNAVAILABLE",
        503,
        "Secret hiện hành chưa sẵn sàng",
      );
    }
    try {
      const seconds = Math.floor(Date.now() / 1000);
      const token = totp(secret, seconds);
      return {
        ticket_id: ticketId,
        secret_version: ticket.secret_version,
        token,
        step_seconds: 30,
        server_time: new Date(seconds * 1000).toISOString(),
        expires_at: new Date((Math.floor(seconds / 30) + 1) * 30000).toISOString(),
        qr_payload: JSON.stringify({
          version: 1,
          ticket_id: ticketId,
          secret_version: ticket.secret_version,
          token,
        }),
      };
    } finally {
      secret.fill(0);
    }
  }
}
