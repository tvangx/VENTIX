import { Pool } from "pg";
import { z } from "zod";
import { SeatClassesClient, SeatClassesPage } from "./event-seat-classes.client";

const classesSchema = z.array(z.object({ id: z.string().uuid() }));

/** Tải HTTP ngoài transaction; công bố toàn bộ batch + readiness nguyên tử sau khi kiểm tra lại phiên bản. */
export class SeatPricingPrefetch {
  constructor(
    private readonly pool: Pool,
    private readonly client: SeatClassesClient,
  ) {}

  async run(eventId: string, version: number): Promise<boolean> {
    const pending = await this.pool.query(
      `SELECT 1 FROM event_snapshots WHERE event_id=$1 AND seat_map_version=$2
       AND NOT pricing_ready AND status='APPROVED'`,
      [eventId, version],
    );
    if (!pending.rowCount) return false;
    const seats: SeatClassesPage["seats"] = [];
    const seenSeats = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    if (version > 0) {
      do {
        const page = await this.client.page(eventId, version, cursor);
        if (
          page.event_id.toLowerCase() !== eventId.toLowerCase() ||
          page.seat_map_version !== version
        )
          throw new Error("Seat classes identity mismatch");
        for (const seat of page.seats) {
          const id = seat.seat_id.toLowerCase();
          if (seenSeats.has(id)) throw new Error("Duplicate seat in seat map");
          seenSeats.add(id);
          seats.push(seat);
        }
        if (page.next_cursor === null) break;
        if (cursors.has(page.next_cursor)) throw new Error("Seat classes cursor loop");
        cursors.add(page.next_cursor);
        cursor = page.next_cursor;
      } while (cursor !== undefined);
    }
    const conn = await this.pool.connect();
    try {
      await conn.query("BEGIN");
      const locked = await conn.query<{ ticket_classes: unknown }>(
        `SELECT ticket_classes FROM event_snapshots WHERE event_id=$1 AND seat_map_version=$2
         AND NOT pricing_ready AND status='APPROVED' FOR UPDATE`,
        [eventId, version],
      );
      if (!locked.rowCount) {
        await conn.query("ROLLBACK");
        return false;
      }
      const classes = new Set(
        classesSchema.parse(locked.rows[0].ticket_classes).map((item) => item.id.toLowerCase()),
      );
      if (seats.some((seat) => !classes.has(seat.ticket_class_id.toLowerCase())))
        throw new Error("Seat map references an unknown ticket class");
      for (let offset = 0; offset < seats.length; offset += 1000) {
        await conn.query(
          `INSERT INTO seat_pricing (event_id,seat_id,seat_map_version,ticket_class_id)
           SELECT $1::uuid,seat_id,$2::int,ticket_class_id FROM jsonb_to_recordset($3::jsonb)
             AS seats(seat_id uuid,ticket_class_id uuid)
           ON CONFLICT (event_id,seat_id) DO UPDATE SET
             seat_map_version=EXCLUDED.seat_map_version,ticket_class_id=EXCLUDED.ticket_class_id
           WHERE seat_pricing.seat_map_version <= EXCLUDED.seat_map_version`,
          [eventId, version, JSON.stringify(seats.slice(offset, offset + 1000))],
        );
      }
      await conn.query(
        "UPDATE event_snapshots SET pricing_ready=true WHERE event_id=$1 AND seat_map_version=$2",
        [eventId, version],
      );
      await conn.query("COMMIT");
      return true;
    } catch (error) {
      await conn.query("ROLLBACK");
      throw error;
    } finally {
      conn.release();
    }
  }
}
