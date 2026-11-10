import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";
import { Database, pgDatabase, SqlExecutor } from "@ticketing/outbox-inbox";
import { randomUUID } from "node:crypto";
import { CheckoutResponseDto } from "./checkout.dto";
import type { PricedItem } from "./checkout.service";
import { ENV } from "../app.tokens";
import { Env } from "../config/env.schema";

@Injectable()
export class CheckoutRepository implements OnApplicationShutdown {
  readonly pool: Pool;
  readonly db: Database;
  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 20,
      connectionTimeoutMillis: 3000,
      query_timeout: 15000,
    });
    this.pool.on("error", () => undefined);
    this.db = pgDatabase(this.pool);
  }
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

export interface Snapshot {
  status: string;
  pricing_ready: boolean;
  seat_map_version: number;
  ticket_classes: unknown;
  sale_window: unknown;
  organizer_id: string;
}
/** Mọi phương thức dùng cùng executor của một transaction checkout. */
export class CheckoutTransaction {
  constructor(readonly exec: SqlExecutor) {}
  async lock(value: string): Promise<void> {
    await this.exec.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [value]);
  }
  async previous(
    key: string,
  ): Promise<{ user_id: string; request_hash: string; response: CheckoutResponseDto } | undefined> {
    return (
      await this.exec.query<{
        user_id: string;
        request_hash: string;
        response: CheckoutResponseDto;
      }>("SELECT user_id,request_hash,response FROM idempotency_keys WHERE key=$1", [key])
    )[0];
  }
  async snapshot(event: string): Promise<Snapshot | undefined> {
    return (
      await this.exec.query<Snapshot>(
        "SELECT * FROM event_snapshots WHERE event_id=$1::uuid FOR SHARE",
        [event],
      )
    )[0];
  }
  prices(
    event: string,
    version: number,
    seats: string[],
  ): Promise<{ seat_id: string; ticket_class_id: string }[]> {
    return this.exec.query(
      "SELECT seat_id,ticket_class_id FROM seat_pricing WHERE event_id=$1::uuid AND seat_map_version=$2 AND seat_id=ANY($3::uuid[]) ORDER BY seat_id",
      [event, version, seats],
    );
  }
  async remember(
    key: string,
    user: string,
    hash: string,
    result: CheckoutResponseDto,
  ): Promise<void> {
    await this.exec.query(
      "INSERT INTO idempotency_keys(key,user_id,request_hash,response) VALUES($1,$2::uuid,$3,$4::jsonb) RETURNING key",
      [key, user, hash, JSON.stringify(result)],
    );
  }
  async insertOrder(
    user: string,
    key: string,
    event: string,
    result: CheckoutResponseDto,
    items: PricedItem[],
  ): Promise<void> {
    const id = result.order_id;
    await this.exec.query(
      "INSERT INTO orders(id,user_id,event_id,status,ticket_amount_vnd,merch_amount_vnd,total_amount_vnd,idempotency_key,expires_at) VALUES($1::uuid,$2::uuid,$3::uuid,'PENDING',$4,$5,$6,$7,$8) RETURNING id",
      [
        id,
        user,
        event,
        result.ticket_amount_vnd,
        result.merch_amount_vnd,
        result.total_amount_vnd,
        key,
        result.expires_at,
      ],
    );
    for (const item of items) {
      await this.exec.query(
        "INSERT INTO order_items(id,order_id,item_type,ref_id,quantity,unit_price_vnd) VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5,$6) RETURNING id",
        [randomUUID(), id, item.item_type, item.ref_id, item.quantity, item.unit_price_vnd],
      );
      if (item.item_type === "TICKET_SEAT")
        await this.exec.query(
          "INSERT INTO seat_allocations(id,order_id,event_id,seat_id,state) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'HELD') RETURNING id",
          [randomUUID(), id, event, item.ref_id],
        );
    }
  }
  async reserveGa(classId: string, quantity: number): Promise<boolean> {
    return (
      (
        await this.exec.query(
          "UPDATE ticket_class_stock SET sold=sold+$2,version=version+1,updated_at=now() WHERE class_id=$1::uuid AND sold+$2<=total RETURNING class_id",
          [classId, quantity],
        )
      ).length === 1
    );
  }
}
