import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import { ENV } from "../app.tokens";
import type { Env } from "../config/env.schema";

export interface HoldEventSnapshot {
  status: string;
  pricing_ready: boolean;
  sale_window: unknown;
}

@Injectable()
export class EventSnapshotRepository implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 2000,
      query_timeout: 3000,
    });
    this.pool.on("error", () => undefined);
  }

  async find(eventId: string): Promise<HoldEventSnapshot | undefined> {
    const result = await this.pool.query<HoldEventSnapshot>(
      "SELECT status, pricing_ready, sale_window FROM event_snapshots WHERE event_id = $1",
      [eventId],
    );
    return result.rows[0];
  }

  async eventIdsAfter(cursor: string): Promise<string[]> {
    const result = await this.pool.query<{ event_id: string }>(
      "SELECT event_id FROM event_snapshots WHERE event_id > $1::uuid ORDER BY event_id LIMIT 100",
      [cursor],
    );
    return result.rows.map((row) => row.event_id);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
