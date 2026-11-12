import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";
import { pgDatabase, SqlExecutor } from "@ticketing/outbox-inbox";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { ListingSearchQuery, ListingView } from "./listing.dto";

@Injectable()
export class ListingRepository implements OnApplicationShutdown {
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
  async lockTicket(executor: SqlExecutor, ticketId: string): Promise<void> {
    await executor.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))", [
      `resale-ticket:${ticketId.toLowerCase()}`,
    ]);
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
  async search(query: ListingSearchQuery): Promise<ListingView[]> {
    return (
      await this.pool.query<ListingView>(
        `SELECT id,ticket_id,event_id,original_price_vnd::text,ask_price_vnd::text,max_percent,status,version
      FROM listings l WHERE status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM resale_ticket_invalidations i WHERE i.id=l.ticket_id)
      AND ($1::uuid IS NULL OR event_id=$1::uuid) AND ($2::bigint IS NULL OR ask_price_vnd>=$2::bigint)
      AND ($3::bigint IS NULL OR ask_price_vnd<=$3::bigint) AND ($4::uuid IS NULL OR id>$4::uuid) ORDER BY id LIMIT $5`,
        [
          query.event_id ?? null,
          query.min_price_vnd ?? null,
          query.max_price_vnd ?? null,
          query.cursor ?? null,
          query.limit + 1,
        ],
      )
    ).rows;
  }
}
