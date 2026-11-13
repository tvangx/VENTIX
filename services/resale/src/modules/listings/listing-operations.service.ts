import { Injectable } from "@nestjs/common";
import { ProblemException, requestContext } from "@ticketing/common";
import { newMessage } from "@ticketing/event-contracts";
import { OutboxService, SqlExecutor } from "@ticketing/outbox-inbox";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ListingView, QuoteRequest } from "./listing.dto";
import {
  ListingOperation,
  ListingOperationRepository,
  OperationChanges,
} from "./listing-operation.repository";
import { assertPriceCap } from "./price-cap";
import { TicketFreezes, TicketRefusal } from "./ticket-freezes";

@Injectable()
export class ListingOperationsService {
  private readonly outbox = new OutboxService();
  constructor(
    private readonly repo: ListingOperationRepository,
    private readonly freezes: TicketFreezes,
  ) {}

  private key(value: string): string {
    if (!z.string().uuid().safeParse(value).success)
      throw new ProblemException(
        "IDEMPOTENCY_KEY_REQUIRED",
        400,
        "A UUID Idempotency-Key is required",
      );
    return value.toLowerCase();
  }
  private fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
  private match(operation: ListingOperation, fingerprint: string): ListingOperation {
    if (operation.fingerprint !== fingerprint)
      throw new ProblemException(
        "IDEMPOTENCY_KEY_REUSED",
        409,
        "Request key was used with different input",
      );
    return operation;
  }

  async create(sellerId: string, key: string, input: QuoteRequest): Promise<ListingView> {
    this.freezes.requireConfigured();
    const requestKey = this.key(key);
    const ticketId = input.ticket_id.toLowerCase();
    const asking = BigInt(input.ask_price_vnd).toString();
    const fingerprint = this.fingerprint({ ticket_id: ticketId, ask_price_vnd: asking });
    const operation = await this.repo.listings.db.transaction(async (executor) => {
      await this.repo.listings.lockTicket(executor, ticketId);
      const existing = await this.repo.request(executor, sellerId, "create", requestKey);
      if (existing) return this.match(existing, fingerprint);
      if (await this.repo.invalidated(executor, ticketId))
        throw new ProblemException("TICKET_NOT_AVAILABLE", 409, "Ticket was revoked or checked in");
      if (await this.repo.active(executor, ticketId))
        throw new ProblemException(
          "LISTING_ALREADY_ACTIVE",
          409,
          "Ticket already has an active listing",
        );
      if (await this.repo.pending(executor, ticketId))
        throw new ProblemException(
          "LISTING_OPERATION_PENDING",
          409,
          "Ticket has an operation in progress",
        );
      const context = requestContext.get();
      const next = await this.repo.insert(executor, {
        sellerId,
        scope: "create",
        key: requestKey,
        fingerprint,
        kind: "CREATE",
        ticketId,
        askPrice: asking,
        traceId: context?.traceId ?? context?.requestId ?? requestKey,
      });
      await this.audit(executor, next, "LISTING_CREATE_REQUESTED");
      return next;
    });
    return this.drive(operation.id);
  }

  async cancel(sellerId: string, key: string, listingId: string): Promise<ListingView> {
    this.freezes.requireConfigured();
    const requestKey = this.key(key);
    const resourceId = listingId.toLowerCase();
    const owned = await this.repo.listings.db.transaction((executor) =>
      this.repo.ownedListing(executor, resourceId, sellerId),
    );
    if (!owned)
      throw new ProblemException("LISTING_NOT_FOUND", 404, "Owned listing is unavailable");
    const scope = `cancel:${resourceId}`;
    const fingerprint = this.fingerprint({ listing_id: resourceId });
    const operation = await this.repo.listings.db.transaction(async (executor) => {
      await this.repo.listings.lockTicket(executor, owned.ticket_id);
      const existing = await this.repo.request(executor, sellerId, scope, requestKey);
      if (existing) return this.match(existing, fingerprint);
      const listing = await this.repo.ownedListing(executor, resourceId, sellerId, true);
      if (!listing)
        throw new ProblemException("LISTING_NOT_FOUND", 404, "Owned listing is unavailable");
      if (listing.status === "SOLD")
        throw new ProblemException(
          "LISTING_NOT_CANCELLABLE",
          409,
          "Sold listing cannot be cancelled",
        );
      if (await this.repo.pending(executor, listing.ticket_id))
        throw new ProblemException(
          "LISTING_OPERATION_PENDING",
          409,
          "Ticket has an operation in progress",
        );
      const context = requestContext.get();
      const next = await this.repo.insert(executor, {
        sellerId,
        scope,
        key: requestKey,
        fingerprint,
        kind: "CANCEL",
        ticketId: listing.ticket_id,
        listingId: listing.id,
        askPrice: listing.ask_price_vnd,
        traceId: context?.traceId ?? context?.requestId ?? requestKey,
      });
      const cancelled = await this.repo.cancelListing(executor, listing);
      if (listing.status === "ACTIVE")
        await this.outbox.add(
          executor,
          newMessage(
            "ListingCancelled",
            { listing_id: listing.id, ticket_id: listing.ticket_id },
            { trace_id: next.trace_id ?? next.id },
          ),
          listing.id,
        );
      const saved = await this.repo.save(executor, next, { response: cancelled });
      await this.audit(executor, saved, "LISTING_CANCEL_REQUESTED");
      return saved;
    });
    return this.drive(operation.id);
  }

  async drive(id: string): Promise<ListingView> {
    let operation = await this.repo.peek(id);
    for (let step = 0; step < 4; step++) {
      if (operation.state === "COMPLETED") return operation.response!;
      if (operation.state === "FAILED")
        throw new ProblemException(
          operation.failure_code!,
          operation.failure_status!,
          "Listing request could not be completed",
        );
      try {
        operation = await this.step(operation);
      } catch {
        await this.repo.defer(id);
        throw new ProblemException(
          "LISTING_OPERATION_PENDING",
          503,
          "Listing operation is pending; retry with the same Idempotency-Key",
        );
      }
    }
    throw new ProblemException(
      "LISTING_OPERATION_PENDING",
      503,
      "Listing operation is pending; retry with the same Idempotency-Key",
    );
  }

  private async step(snapshot: ListingOperation): Promise<ListingOperation> {
    return this.repo.listings.db.transaction(async (executor) => {
      await this.repo.listings.lockTicket(executor, snapshot.ticket_id);
      const operation = await this.repo.locked(executor, snapshot.id);
      if (operation.state === "COMPLETED" || operation.state === "FAILED") return operation;
      if (operation.kind === "CANCEL" || operation.state === "RELEASING") {
        try {
          await this.freezes.call(
            operation.ticket_id,
            operation.listing_id,
            operation.seller_id,
            true,
            operation.trace_id ?? operation.id,
          );
        } catch (error) {
          if (!(error instanceof TicketRefusal && error.getStatus() === 404)) throw error;
        }
        return this.transition(executor, operation, {
          state: operation.kind === "CANCEL" ? "COMPLETED" : "FAILED",
        });
      }
      let changes: OperationChanges;
      try {
        if (await this.repo.invalidated(executor, operation.ticket_id))
          throw new ProblemException(
            "TICKET_NOT_AVAILABLE",
            409,
            "Ticket was revoked or checked in",
          );
        const binding = await this.freezes.call(
          operation.ticket_id,
          operation.listing_id,
          operation.seller_id,
          false,
          operation.trace_id ?? operation.id,
        );
        const cap = await this.repo.cap(executor, binding.event_id);
        assertPriceCap(BigInt(binding.original_price_vnd), BigInt(operation.ask_price_vnd), cap);
        changes = {
          event_id: binding.event_id,
          organizer_id: binding.organizer_id,
          original_price_vnd: binding.original_price_vnd,
          max_percent: cap,
        };
      } catch (error) {
        if (
          error instanceof TicketRefusal ||
          (error instanceof ProblemException && error.getStatus() < 500)
        )
          return this.transition(executor, operation, {
            state: "RELEASING",
            failure_code: error.code,
            failure_status: error.getStatus(),
          });
        throw error;
      }
      if (operation.state === "PENDING")
        return this.transition(executor, operation, { ...changes, state: "FROZEN" });
      const current = { ...operation, ...changes };
      const listing = await this.repo.createListing(executor, current);
      await this.outbox.add(
        executor,
        newMessage(
          "ListingCreated",
          {
            listing_id: listing.id,
            ticket_id: listing.ticket_id,
            seller_id: operation.seller_id,
            event_id: listing.event_id,
            ask_price_vnd: Number(operation.ask_price_vnd),
          },
          {
            trace_id: operation.trace_id ?? operation.id,
            tenant_id: current.organizer_id ?? undefined,
          },
        ),
        listing.id,
      );
      return this.transition(executor, operation, {
        ...changes,
        state: "COMPLETED",
        response: listing,
      });
    });
  }

  private async transition(
    executor: SqlExecutor,
    operation: ListingOperation,
    changes: OperationChanges,
  ): Promise<ListingOperation> {
    const next = await this.repo.save(executor, operation, changes);
    await this.audit(executor, next, "LISTING_OPERATION_UPDATED");
    return next;
  }
  private async audit(
    executor: SqlExecutor,
    operation: ListingOperation,
    action: string,
  ): Promise<void> {
    await this.outbox.add(
      executor,
      newMessage(
        "AuditRecorded",
        {
          actor_id: operation.seller_id,
          action,
          resource_type: "listing_operation",
          resource_id: operation.id,
          after_state: {
            kind: operation.kind,
            state: operation.state,
            listing_id: operation.listing_id,
          },
        },
        {
          trace_id: operation.trace_id ?? operation.id,
          tenant_id: operation.organizer_id ?? undefined,
        },
      ),
      operation.id,
    );
  }
}
