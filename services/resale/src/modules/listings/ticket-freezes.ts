import { Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { z } from "zod";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";

const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const freezeSchema = z.object({
  listing_id: uuid,
  ticket_id: uuid,
  seller_id: uuid,
  event_id: uuid,
  organizer_id: uuid.nullable(),
  original_price_vnd: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .max(19)
    .refine((value) => BigInt(value) <= 9223372036854775807n),
  freeze_status: z.enum(["FROZEN", "RELEASED"]),
  ticket_status: z.string(),
});
const refusalSchema = z.object({
  code: z.enum([
    "TICKET_NOT_FOUND",
    "TICKET_NOT_OWNED",
    "TICKET_NOT_ACTIVE",
    "FREEZE_RELEASED",
    "FREEZE_REFERENCE_REUSED",
    "EVENT_CANCELLED",
  ]),
});
export type TicketFreezeView = z.infer<typeof freezeSchema>;

export class TicketRefusal extends ProblemException {
  constructor(code: string, status: number) {
    super(code, status, "Ticket is unavailable for this listing");
  }
}

@Injectable()
export class TicketFreezes {
  constructor(@Inject(ENV) private readonly env: Env) {}

  requireConfigured(): void {
    if (!this.env.INTERNAL_API_KEY)
      throw new ProblemException(
        "TICKET_SERVICE_UNAVAILABLE",
        503,
        "Ticket internal API is not configured",
      );
  }

  async call(
    ticketId: string,
    listingId: string,
    sellerId: string,
    release: boolean,
    traceId: string,
  ): Promise<TicketFreezeView> {
    this.requireConfigured();
    try {
      const response = await fetch(
        new URL(
          `/v1/internal/tickets/${encodeURIComponent(ticketId)}/${release ? "unfreeze" : "freeze"}`,
          this.env.TICKET_SERVICE_URL,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Key": this.env.INTERNAL_API_KEY!,
            "Idempotency-Key": listingId,
            "X-Request-Id": traceId,
          },
          body: JSON.stringify({ listing_id: listingId, seller_id: sellerId }),
          signal: AbortSignal.timeout(2000),
          redirect: "error",
        },
      );
      if (!response.ok) {
        const refused = refusalSchema.safeParse(await response.json());
        if (refused.success && (response.status === 404 || response.status === 409))
          throw new TicketRefusal(refused.data.code, response.status);
        throw new Error("TICKET_FREEZE_UNAVAILABLE");
      }
      const view = freezeSchema.parse(await response.json());
      if (
        view.ticket_id !== ticketId ||
        view.listing_id !== listingId ||
        view.seller_id !== sellerId ||
        view.freeze_status !== (release ? "RELEASED" : "FROZEN")
      )
        throw new Error("TICKET_FREEZE_CONTEXT_MISMATCH");
      return view;
    } catch (error) {
      if (error instanceof TicketRefusal) throw error;
      throw new ProblemException(
        "TICKET_SERVICE_UNAVAILABLE",
        503,
        "Ticket freeze API is unavailable",
      );
    }
  }
}
