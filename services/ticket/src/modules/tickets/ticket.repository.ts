import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { pgDatabase } from "@ticketing/outbox-inbox";
import { Pool } from "pg";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";

@Injectable()
export class TicketRepository implements OnApplicationShutdown {
  readonly pool: Pool;
  readonly db;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
    });
    this.pool.on("error", () => undefined);
    this.db = pgDatabase(this.pool);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
