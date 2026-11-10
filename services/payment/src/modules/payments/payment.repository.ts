import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";
import { pgDatabase, SqlExecutor } from "@ticketing/outbox-inbox";
import { uuidv7 } from "uuidv7";
import { Notification, PaymentLink, Provider } from "./payment-adapter";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";

export type PaymentPurpose = "ORDER" | "RESALE";
export interface PaymentRow {
  id: string;
  purpose: PaymentPurpose;
  ref_id: string;
  user_id: string;
  event_id: string;
  provider: "VNPAY" | "MOCK";
  amount_vnd: string;
  status: string;
  request_hash: string;
  redirect_url: string;
  expires_at: Date;
  version: number;
  mock_data: unknown;
}
export interface PayableRow {
  amount_vnd: string;
  user_id: string;
  event_id: string;
  expires_at: Date;
  status: string;
}
@Injectable()
export class PaymentRepository implements OnApplicationShutdown {
  readonly pool: Pool;
  readonly db;
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
  async dueMocks(): Promise<{ mock_data: unknown; trace_id: string }[]> {
    return (
      await this.pool.query<{ mock_data: unknown; trace_id: string }>(
        "SELECT mock_data,trace_id FROM payments WHERE provider='MOCK' AND status='PENDING' AND (mock_data->>'dueAt')::timestamptz<=now() ORDER BY created_at LIMIT 100",
      )
    ).rows;
  }
}

/** Mọi SQL dùng cùng executor transaction của caller. */
export class PaymentTransaction {
  constructor(private readonly exec: SqlExecutor) {}
  async lockKey(key: string): Promise<void> {
    await this.exec.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `payment-key:${key}`,
    ]);
  }
  async previous(key: string): Promise<PaymentRow | undefined> {
    return (
      await this.exec.query<PaymentRow>("SELECT * FROM payments WHERE idempotency_key=$1", [key])
    )[0];
  }
  async payable(order: string, purpose: PaymentPurpose): Promise<PayableRow | undefined> {
    return (
      await this.exec.query<PayableRow>(
        "SELECT * FROM payables WHERE purpose=$2 AND ref_id=$1::uuid FOR UPDATE",
        [order, purpose],
      )
    )[0];
  }
  async now(): Promise<Date> {
    return (await this.exec.query<{ db_now: Date }>("SELECT clock_timestamp() AS db_now"))[0]
      .db_now;
  }
  async hasActive(order: string, purpose: PaymentPurpose): Promise<boolean> {
    return (
      (
        await this.exec.query(
          "SELECT id FROM payments WHERE purpose=$2 AND ref_id=$1::uuid AND status IN ('PENDING','SUCCEEDED')",
          [order, purpose],
        )
      ).length !== 0
    );
  }
  async insert(input: {
    id: string;
    order: string;
    purpose: PaymentPurpose;
    user: string;
    payable: PayableRow;
    provider: Provider;
    amount: number;
    key: string;
    hash: string;
    link: PaymentLink;
    trace: string;
  }): Promise<void> {
    const p = input;
    await this.exec.query(
      "INSERT INTO payments(id,purpose,ref_id,user_id,event_id,provider,amount_vnd,idempotency_key,request_hash,redirect_url,expires_at,mock_data,trace_id) VALUES($1::uuid,$13,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) RETURNING id",
      [
        p.id,
        p.order,
        p.user,
        p.payable.event_id,
        p.provider,
        p.amount,
        p.key,
        p.hash,
        p.link.redirect_url,
        p.payable.expires_at,
        p.link.mock ? JSON.stringify(p.link.mock) : null,
        p.trace,
        p.purpose,
      ],
    );
  }
  async payment(id: string): Promise<PaymentRow | undefined> {
    return (
      await this.exec.query<PaymentRow>("SELECT * FROM payments WHERE id=$1::uuid FOR UPDATE", [id])
    )[0];
  }
  async record(p: PaymentRow, data: Notification, txnId: string): Promise<boolean> {
    return (
      (
        await this.exec.query(
          "INSERT INTO payment_transactions(id,payment_id,provider_txn_id,kind,signature_valid,raw_payload) VALUES($1::uuid,$2::uuid,$3,'PAY',true,$4::jsonb) ON CONFLICT(provider_txn_id) DO NOTHING RETURNING id",
          [
            uuidv7(),
            p.id,
            txnId,
            JSON.stringify({
              response: data.reason,
              succeeded: data.succeeded,
              provider_txn_id: data.providerTxnId,
            }),
          ],
        )
      ).length === 1
    );
  }
  async transition(p: PaymentRow, data: Notification): Promise<void> {
    const changed = await this.exec.query(
      "UPDATE payments SET status=$2,paid_at=$3,updated_at=now(),version=version+1 WHERE id=$1::uuid AND status='PENDING' AND version=$4 RETURNING id",
      [
        p.id,
        data.succeeded ? "SUCCEEDED" : "FAILED",
        data.succeeded ? data.paidAt : null,
        p.version,
      ],
    );
    if (changed.length !== 1) throw new Error("Payment transition conflict");
  }
}
