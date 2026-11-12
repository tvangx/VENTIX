import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { ListingView } from "./listing.dto";

@Injectable()
export class ListingRepository implements OnApplicationShutdown {
  readonly pool: Pool;
  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
    });
    this.pool.on("error", () => undefined);
  }
  async cap(eventId: string): Promise<number> {
    const result = await this.pool.query<{ max_percent: number }>(
      "SELECT max_percent FROM price_cap_rules WHERE event_id=$1::uuid",
      [eventId],
    );
    return result.rows[0]?.max_percent ?? 120;
  }
  async list(sellerId: string, cursor: string | undefined, limit: number): Promise<ListingView[]> {
    const result = await this.pool.query<ListingView>(
      `SELECT id,ticket_id,event_id,original_price_vnd::text,ask_price_vnd::text,max_percent,status,version
      FROM listings WHERE seller_id=$1::uuid AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3`,
      [sellerId, cursor ?? null, limit],
    );
    return result.rows;
  }
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
