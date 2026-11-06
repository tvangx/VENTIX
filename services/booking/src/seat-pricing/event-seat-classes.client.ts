import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const pageSchema = z.object({
  event_id: z.string().uuid(),
  seat_map_version: z.number().int().positive(),
  seats: z.array(z.object({ seat_id: z.string().uuid(), ticket_class_id: z.string().uuid() })),
  next_cursor: z.string().nullable(),
});
export type SeatClassesPage = z.infer<typeof pageSchema>;
export interface SeatClassesClient {
  page(eventId: string, version: number, cursor?: string): Promise<SeatClassesPage>;
}

class InvalidSeatClassesResponse extends Error {}

export class EventSeatClassesClient implements SeatClassesClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalKey: string,
    private readonly options = { timeoutMs: 2000, attempts: 3, backoffMs: 100 },
  ) {}

  async page(eventId: string, version: number, cursor?: string): Promise<SeatClassesPage> {
    const url = new URL(
      `/v1/internal/events/${z.string().uuid().parse(eventId)}/seat-classes`,
      this.baseUrl,
    );
    url.searchParams.set("seat_map_version", String(z.number().int().positive().parse(version)));
    url.searchParams.set("limit", "1000");
    if (cursor !== undefined) url.searchParams.set("cursor", cursor);
    for (let attempt = 0; attempt < this.options.attempts; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { "X-Internal-Key": this.internalKey },
          signal: AbortSignal.timeout(this.options.timeoutMs),
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status !== 429 && response.status < 500)
            throw new InvalidSeatClassesResponse(`Seat classes HTTP ${response.status}`);
          throw new Error("Seat classes temporarily unavailable");
        }
        const text = await response.text();
        let body: unknown;
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          throw new InvalidSeatClassesResponse("Invalid seat classes JSON");
        }
        const parsed = pageSchema.safeParse(body);
        if (
          !parsed.success ||
          parsed.data.event_id.toLowerCase() !== eventId.toLowerCase() ||
          parsed.data.seat_map_version !== version
        )
          throw new InvalidSeatClassesResponse("Invalid seat classes page");
        return parsed.data;
      } catch (error) {
        if (error instanceof InvalidSeatClassesResponse) throw error;
        if (attempt + 1 === this.options.attempts)
          throw new Error("Seat classes request failed after retries");
        await delay(this.options.backoffMs * 2 ** attempt);
      }
    }
    throw new Error("Seat classes attempts must be positive");
  }
}
