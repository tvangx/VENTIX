import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";
import { pgDatabase } from "@ticketing/outbox-inbox";
import { ENV } from "../app.tokens";
import { Env } from "../config/env.schema";

@Injectable()
export class FinanceRepository implements OnApplicationShutdown {
  readonly pool: Pool;
  readonly db;
  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 20,
      connectionTimeoutMillis: 3000,
    });
    this.pool.on("error", () => undefined);
    this.db = pgDatabase(this.pool);
  }
  // Sau BeforeApplicationShutdown của worker: không đóng pool khi consumer/relay còn transaction.
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
