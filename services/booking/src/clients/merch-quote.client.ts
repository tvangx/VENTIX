import CircuitBreaker from "opossum";
import { z } from "zod";
import { ProblemException } from "@ticketing/common";

export interface MerchItem {
  sku_id: string;
  quantity: number;
}
export interface MerchQuoteRequest {
  event_id: string;
  ticket_class_ids: string[];
  merch_items: MerchItem[];
}
const quoteSchema = z.object({
  lines: z.array(
    z
      .object({
        sku_id: z.string().uuid(),
        quantity: z.number().int().positive(),
        unit_price_vnd: z.number().int().nonnegative().safe(),
      })
      .strict(),
  ),
  merch_amount_vnd: z.number().int().nonnegative().safe(),
  discount_vnd: z.number().int().nonnegative().safe(),
});
export type MerchQuote = z.infer<typeof quoteSchema>;
export interface MerchQuotePort {
  quote(request: MerchQuoteRequest): Promise<MerchQuote>;
}
export const MERCH_QUOTE = Symbol("MERCH_QUOTE");

export class MerchQuoteClient implements MerchQuotePort {
  private readonly breaker: CircuitBreaker<[MerchQuoteRequest], MerchQuote>;
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly timeoutMs = 800,
  ) {
    this.breaker = new CircuitBreaker((request: MerchQuoteRequest) => this.request(request), {
      timeout: false,
      errorThresholdPercentage: 50,
      volumeThreshold: 5,
      resetTimeout: 10000,
    });
  }
  async quote(request: MerchQuoteRequest): Promise<MerchQuote> {
    try {
      return await this.breaker.fire(request);
    } catch {
      throw new ProblemException(
        "MERCH_UNAVAILABLE",
        503,
        "Merchandise quotes are temporarily unavailable",
      );
    }
  }
  onApplicationShutdown(): void {
    this.breaker.shutdown();
  }
  private async request(request: MerchQuoteRequest): Promise<MerchQuote> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(new URL("/v1/internal/quotes", this.url), {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Key": this.key },
          body: JSON.stringify(request),
          redirect: "error",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("Quote HTTP failure");
        }
        const quote = quoteSchema.parse(await response.json());
        const expected = new Map(request.merch_items.map((i) => [i.sku_id, i.quantity]));
        if (quote.lines.length !== expected.size) throw new Error("Quote line mismatch");
        let sum = 0;
        for (const line of quote.lines) {
          const id = line.sku_id.toLowerCase();
          if (expected.get(id) !== line.quantity) throw new Error("Quote quantity mismatch");
          expected.delete(id);
          line.sku_id = id;
          sum += line.quantity * line.unit_price_vnd;
        }
        if (!Number.isSafeInteger(sum) || sum !== quote.merch_amount_vnd)
          throw new Error("Quote amount mismatch");
        return quote;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
    throw new Error("Quote unavailable");
  }
}
