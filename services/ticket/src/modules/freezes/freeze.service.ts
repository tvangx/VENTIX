import { Injectable } from "@nestjs/common";
import { ProblemException, requestContext } from "@ticketing/common";
import { newMessage } from "@ticketing/event-contracts";
import { OutboxService } from "@ticketing/outbox-inbox";
import { TicketRepository } from "../tickets/ticket.repository";
import { FreezeInput, FreezeView } from "./freeze.dto";
import { FreezeRepository } from "./freeze.repository";

@Injectable()
export class FreezeService {
  private readonly outbox = new OutboxService();
  constructor(
    private readonly repo: FreezeRepository,
    private readonly tickets: TicketRepository,
  ) {}

  async handle(
    ticketId: string,
    key: string,
    input: FreezeInput,
    release: boolean,
  ): Promise<FreezeView> {
    if (key?.toLowerCase() !== input.listing_id)
      throw new ProblemException(
        "IDEMPOTENCY_KEY_REQUIRED",
        400,
        "Idempotency-Key must equal listing_id",
      );
    return this.tickets.db.transaction(async (executor) => {
      const ticket = await this.repo.ticket(executor, ticketId);
      if (!ticket) throw new ProblemException("TICKET_NOT_FOUND", 404, "Ticket is unavailable");
      let binding = await this.repo.binding(executor, input.listing_id);
      if (binding && (binding.ticket_id !== ticket.id || binding.seller_id !== input.seller_id))
        throw new ProblemException(
          "FREEZE_REFERENCE_REUSED",
          409,
          "Listing reference was used for another ticket or seller",
        );
      if (!binding && ticket.owner_user_id !== input.seller_id)
        throw new ProblemException("TICKET_NOT_OWNED", 404, "Seller does not own the ticket");
      let changed = false;
      if (release) {
        if (!binding) {
          binding = await this.repo.insert(executor, ticket, input, "RELEASED");
          changed = true;
        } else if (binding.status === "FROZEN") {
          if (!(await this.repo.release(executor, binding)))
            throw new ProblemException(
              "TICKET_STATE_CONFLICT",
              409,
              "Freeze binding changed while releasing",
            );
          binding = { ...binding, status: "RELEASED", version: binding.version + 1 };
          if (
            ticket.status === "FROZEN" &&
            ticket.owner_user_id === input.seller_id &&
            !ticket.event_cancelled
          ) {
            if (!(await this.repo.status(executor, ticket, "FROZEN", "ACTIVE")))
              throw new ProblemException(
                "TICKET_STATE_CONFLICT",
                409,
                "Ticket changed while releasing its freeze",
              );
            ticket.status = "ACTIVE";
          }
          changed = true;
        }
      } else {
        if (binding?.status === "RELEASED")
          throw new ProblemException("FREEZE_RELEASED", 409, "Listing freeze was already released");
        if (ticket.owner_user_id !== input.seller_id)
          throw new ProblemException("TICKET_NOT_OWNED", 404, "Seller does not own the ticket");
        if (ticket.event_cancelled)
          throw new ProblemException("EVENT_CANCELLED", 409, "Event is cancelled");
        if (!binding) {
          if (ticket.status !== "ACTIVE")
            throw new ProblemException(
              "TICKET_NOT_ACTIVE",
              409,
              "Ticket is unavailable for listing",
            );
          binding = await this.repo.insert(executor, ticket, input, "FROZEN");
          if (!(await this.repo.status(executor, ticket, "ACTIVE", "FROZEN")))
            throw new ProblemException(
              "TICKET_STATE_CONFLICT",
              409,
              "Ticket changed while freezing",
            );
          ticket.status = "FROZEN";
          changed = true;
        } else if (ticket.status !== "FROZEN")
          throw new ProblemException("TICKET_NOT_ACTIVE", 409, "Ticket is unavailable for listing");
      }
      if (changed) {
        const context = requestContext.get();
        await this.outbox.add(
          executor,
          newMessage(
            "AuditRecorded",
            {
              actor_id: input.seller_id,
              action: release ? "TICKET_FREEZE_RELEASED" : "TICKET_FROZEN",
              resource_type: "ticket",
              resource_id: ticket.id,
              after_state: {
                listing_id: input.listing_id,
                status: ticket.status,
                freeze_status: binding.status,
              },
            },
            {
              tenant_id: binding.organizer_id ?? undefined,
              trace_id: context?.traceId ?? context?.requestId,
            },
          ),
          ticket.id,
        );
      }
      return {
        listing_id: binding.id,
        ticket_id: binding.ticket_id,
        seller_id: binding.seller_id,
        event_id: binding.event_id,
        organizer_id: binding.organizer_id,
        original_price_vnd: binding.original_price_vnd,
        freeze_status: binding.status,
        ticket_status: ticket.status,
      };
    });
  }
}
