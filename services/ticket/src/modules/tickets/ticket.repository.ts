import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { pgDatabase, SqlExecutor } from "@ticketing/outbox-inbox";
import { uuidv7 } from "uuidv7";
import { Pool } from "pg";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";
import type { TicketView } from "./ticket.dto";

interface OwnedSecret {
  status: string;
  secret_version: number;
  secret_enc: Buffer | null;
  key_id: string | null;
}

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

  async listOwned(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<TicketView[]> {
    const result = await this.pool.query<TicketView>(
      `SELECT id, order_id, event_id, seat_id, item_type, ref_id, unit_price_vnd::text, status, secret_version
       FROM tickets WHERE owner_user_id=$1::uuid AND ($2::uuid IS NULL OR id>$2::uuid)
       ORDER BY id LIMIT $3`,
      [userId, cursor ?? null, limit],
    );
    return result.rows;
  }

  async ownedSecret(userId: string, ticketId: string): Promise<OwnedSecret | undefined> {
    const result = await this.pool.query<OwnedSecret>(
      `SELECT ticket.status, ticket.secret_version, secret.secret_enc, secret.key_id
       FROM tickets ticket LEFT JOIN ticket_secrets secret
       ON secret.ticket_id=ticket.id AND secret.version=ticket.secret_version AND secret.revoked_at IS NULL
       WHERE ticket.id=$1::uuid AND ticket.owner_user_id=$2::uuid`,
      [ticketId, userId],
    );
    return result.rows[0];
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  async cachedRequest(executor: SqlExecutor, actorId: string, scope: string, requestKey: string) {
    await executor.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))", [
      JSON.stringify([actorId, scope, requestKey]),
    ]);
    const [row] = await executor.query<{ fingerprint: string; response: unknown }>(
      "SELECT fingerprint,response FROM ticket_requests WHERE actor_id=$1::uuid AND scope=$2 AND request_key=$3::uuid",
      [actorId, scope, requestKey],
    );
    return row;
  }

  async rememberRequest(
    executor: SqlExecutor,
    actorId: string,
    scope: string,
    requestKey: string,
    fingerprint: string,
    response: unknown,
  ) {
    await executor.query(
      "INSERT INTO ticket_requests (id,actor_id,scope,request_key,fingerprint,response) VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::jsonb)",
      [uuidv7(), actorId, scope, requestKey, fingerprint, JSON.stringify(response)],
    );
  }
}
