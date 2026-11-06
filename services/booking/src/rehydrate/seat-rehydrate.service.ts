import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "@ticketing/common";
import Redis from "ioredis";
import { Pool } from "pg";
import { ENV, LOGGER } from "../app.tokens";
import { Env } from "../config/env.schema";
import { SeatHoldRedisClient } from "../seat-hold/seat-hold-redis";

export interface RehydrateAllocation {
  id: string;
  event_id: string;
  seat_id: string;
  state: "SOLD" | "HELD";
  user_id: string;
  expires_at_ms: string;
}
export type RehydrateRedis = Redis & {
  rehydrateSeat(keys: number, ...args: (string | number)[]): Promise<number>;
};
export function registerRehydrateCommand(redis: Redis): RehydrateRedis {
  redis.defineCommand("rehydrateSeat", {
    lua: readFileSync(join(__dirname, "lua/rehydrate_seat.lua"), "utf8"),
  });
  return redis as RehydrateRedis;
}

@Injectable()
export class SeatRehydrateService implements OnApplicationShutdown {
  private readonly pool: Pool;
  constructor(
    @Inject(ENV) env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly client: SeatHoldRedisClient,
  ) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 2000,
      query_timeout: 10000,
    });
    this.pool.on("error", () => undefined);
  }
  async run(): Promise<void> {
    const redis = registerRehydrateCommand(await this.client.connected());
    let cursor = "00000000-0000-0000-0000-000000000000";
    let restored = 0;
    for (;;) {
      const page = await this.pool.query<RehydrateAllocation>(
        `SELECT a.id,a.event_id,a.seat_id,a.state,o.user_id,
           floor(extract(epoch FROM o.expires_at)*1000)::bigint::text AS expires_at_ms
         FROM seat_allocations a JOIN orders o ON o.id=a.order_id AND o.event_id=a.event_id
         WHERE a.id > $1::uuid AND (a.state='SOLD' OR
           (a.state='HELD' AND o.status IN ('PENDING','AWAITING_PAYMENT') AND o.expires_at > clock_timestamp()))
         ORDER BY a.id LIMIT 500`,
        [cursor],
      );
      if (!page.rows.length) break;
      for (const row of page.rows) {
        const slot = `{evt:${row.event_id}}`;
        restored += await redis.rehydrateSeat(
          4,
          `seat:${slot}:${row.seat_id}`,
          `sold:${slot}`,
          `hold:${slot}:${row.user_id}`,
          `hexp:${slot}`,
          row.state,
          row.seat_id,
          `H:${row.user_id}`,
          row.expires_at_ms,
        );
      }
      cursor = page.rows[page.rows.length - 1].id;
    }
    this.logger.info(
      { restored, trace_id: "startup", request_id: "startup" },
      "booking: Redis rehydrate completed",
    );
  }
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
