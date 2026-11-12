import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { ListingPage, ListingQuery, QuoteRequest, QuoteResponse } from "./listing.dto";
import { ListingRepository } from "./listing.repository";
import { TicketSource } from "./ticket-source";
import { assertPriceCap, maximumPrice } from "./price-cap";

@Injectable()
export class ListingService {
  constructor(
    private readonly repo: ListingRepository,
    private readonly tickets: TicketSource,
  ) {}
  async quote(input: QuoteRequest, authorization: string): Promise<QuoteResponse> {
    const ticket = await this.tickets.owned(input.ticket_id, authorization);
    if (ticket.status !== "ACTIVE")
      throw new ProblemException("TICKET_NOT_ACTIVE", 409, "Vé không ở trạng thái hoạt động");
    const original = BigInt(ticket.unit_price_vnd);
    const percent = await this.repo.cap(ticket.event_id);
    const asking = BigInt(input.ask_price_vnd);
    assertPriceCap(original, asking, percent);
    return {
      ticket_id: ticket.id,
      event_id: ticket.event_id,
      original_price_vnd: original.toString(),
      ask_price_vnd: asking.toString(),
      maximum_price_vnd: maximumPrice(original, percent).toString(),
      max_percent: percent,
    };
  }
  async list(sellerId: string, query: ListingQuery): Promise<ListingPage> {
    const rows = await this.repo.list(sellerId, query.cursor, query.limit + 1);
    const items = rows.slice(0, query.limit);
    return { items, next_cursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }
}
