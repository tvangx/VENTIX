import { readFile } from "node:fs/promises";
import { loadEnv } from "@ticketing/common";
import { Pool } from "pg";
import { envSchema, seatPricingSeedSchema } from "../config/env.schema";
import { SeatClassesPage } from "../seat-pricing/event-seat-classes.client";
import { SeatPricingPrefetch } from "../seat-pricing/seat-pricing-prefetch";
import { z } from "zod";

/** Dev: cùng pipeline transaction/version với worker; không tự tạo hay thay snapshot. */
export async function seedSeatPricing(): Promise<void> {
  const env = loadEnv(envSchema);
  if (env.NODE_ENV === "production") throw new Error("Seat pricing seed is disabled in production");
  const config = loadEnv(seatPricingSeedSchema);
  const seats = z
    .array(z.object({ seat_id: z.string().uuid(), ticket_class_id: z.string().uuid() }))
    .parse(JSON.parse(await readFile(config.SEED_SEATS_FILE, "utf8")) as unknown);
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 2000,
    query_timeout: 10000,
  });
  try {
    const job = new SeatPricingPrefetch(pool, {
      page: async (eventId, version, cursor): Promise<SeatClassesPage> => {
        const offset = Number(cursor ?? 0);
        return {
          event_id: eventId,
          seat_map_version: version,
          seats: seats.slice(offset, offset + 1000),
          next_cursor: offset + 1000 < seats.length ? String(offset + 1000) : null,
        };
      },
    });
    const applied = await job.run(config.SEED_EVENT_ID, config.SEED_SEAT_MAP_VERSION);
    process.stdout.write(
      `Seat pricing seed: ${applied ? "ready" : "skipped (already ready, stale or missing snapshot)"}\n`,
    );
  } finally {
    await pool.end();
  }
}
