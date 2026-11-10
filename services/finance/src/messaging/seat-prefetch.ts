import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ENV } from "../app.tokens";
import { Env } from "../config/env.schema";
import { FinanceRepository } from "../modules/finance.repository";

const pageSchema = z.object({
  event_id: z.string().uuid(),
  seat_map_version: z.number().int(),
  seats: z.array(z.object({ seat_id: z.string().uuid(), ticket_class_id: z.string().uuid() })),
  next_cursor: z.string().nullable(),
});

@Injectable()
export class SeatPrefetch {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repo: FinanceRepository,
  ) {}
  async tick(): Promise<void> {
    const { rows } = await this.repo.pool.query<{
      event_id: string;
      seat_map_version: number;
      ticket_classes: { id: string }[];
    }>(
      "SELECT event_id,seat_map_version,ticket_classes FROM events_ref WHERE NOT pricing_ready ORDER BY event_id LIMIT 10",
    );
    for (const row of rows) await this.load(row.event_id, row.seat_map_version, row.ticket_classes);
  }
  async load(eventId: string, version: number, classes: { id: string }[]): Promise<void> {
    const seats: z.infer<typeof pageSchema>["seats"] = [];
    const seen = new Set<string>(),
      cursors = new Set<string>();
    let cursor: string | null = null;
    let sourceVersion = version;
    do {
      const url = new URL(
        `/v1/internal/events/${eventId}/seat-classes`,
        this.env.EVENT_SERVICE_URL,
      );
      if (sourceVersion > 0) url.searchParams.set("seat_map_version", String(sourceVersion));
      if (cursor !== null) url.searchParams.set("cursor", cursor);
      const response = await fetch(url, {
        headers: { "X-Internal-Key": this.env.INTERNAL_API_KEY ?? "" },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(`Seat prefetch failed (${response.status})`);
      const page = pageSchema.parse(await response.json());
      if (
        page.event_id !== eventId ||
        (sourceVersion > 0 && page.seat_map_version !== sourceVersion)
      )
        throw new Error("Seat map identity mismatch");
      sourceVersion = page.seat_map_version;
      for (const seat of page.seats) {
        if (seen.has(seat.seat_id) || !classes.some((c) => c.id === seat.ticket_class_id))
          throw new Error("Invalid seat mapping");
        seen.add(seat.seat_id);
        seats.push(seat);
      }
      cursor = page.next_cursor;
      if (cursor !== null) {
        if (cursors.has(cursor)) throw new Error("Seat cursor loop");
        cursors.add(cursor);
      }
    } while (cursor !== null);
    await this.repo.db.transaction(async (e) => {
      const locked = await e.query(
        "SELECT id FROM events_ref WHERE event_id=$1::uuid AND seat_map_version=$2 AND NOT pricing_ready FOR UPDATE",
        [eventId, version],
      );
      if (!locked.length) return;
      for (const seat of seats)
        await e.query(
          `INSERT INTO seat_classes(id,event_id,seat_id,ticket_class_id,seat_map_version)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5) ON CONFLICT(event_id,seat_id,seat_map_version) DO NOTHING RETURNING id`,
          [randomUUID(), eventId, seat.seat_id, seat.ticket_class_id, version],
        );
      await e.query(
        "UPDATE events_ref SET pricing_ready=true,updated_at=now(),version=version+1 WHERE event_id=$1::uuid AND seat_map_version=$2 RETURNING id",
        [eventId, version],
      );
    });
  }
}
