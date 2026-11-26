import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { newMessage } from "@ticketing/event-contracts";
import { OutboxService } from "@ticketing/outbox-inbox";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { PaymentRepository } from "../payments/payment.repository";
import { RefundInput, RefundResult } from "../payments/payment-adapter";
import { SYSTEM_ACTOR } from "./refund.handler";

export interface RefundClaim {
  id: string;
  payment_id: string;
  batch_id: string | null;
  amount_vnd: string;
  attempts: number;
  version: number;
  claim_token: string;
  sent_at: Date;
  trace_id: string;
  ref_id: string;
  provider: "MOCK" | "VNPAY";
  redirect_url: string;
  provider_txn_id: string;
  approved_by: string | null;
  reconcile: boolean;
}
const DISPATCH_ID = "00000000-0000-4000-8000-000000000002";
@Injectable()
export class RefundRepository {
  constructor(
    readonly payments: PaymentRepository,
    @Inject(ENV) readonly env: Env,
  ) {}
  async claim(): Promise<RefundClaim | undefined> {
    return this.payments.db.transaction(async (exec) => {
      await exec.query("SELECT id FROM refund_dispatch WHERE id=$1::uuid FOR UPDATE", [
        DISPATCH_ID,
      ]);
      // Claim hết hạn vẫn giữ sent_at: lần sau chỉ được đối soát.
      await exec.query(`UPDATE refunds SET status='PENDING',claim_token=NULL,lease_until=NULL,version=version+1,updated_at=now()
        WHERE status='PROCESSING' AND lease_until<=clock_timestamp() RETURNING id`);
      const [quota] = await exec.query<{ allowed: boolean }>(
        `SELECT next_at<=clock_timestamp() AND
        (SELECT count(*) FROM refunds WHERE status='PROCESSING')<$2 AS allowed FROM refund_dispatch WHERE id=$1::uuid`,
        [DISPATCH_ID, this.env.REFUND_CONCURRENCY],
      );
      if (!quota?.allowed) return;
      const [row] = await exec.query<
        Omit<RefundClaim, "sent_at" | "reconcile"> & { sent_at: Date | null }
      >(
        `SELECT r.*,p.ref_id,p.provider,p.redirect_url,
        COALESCE((SELECT raw_payload->>'provider_txn_id' FROM payment_transactions t WHERE t.payment_id=p.id AND kind='PAY' LIMIT 1),'') AS provider_txn_id
        FROM refunds r JOIN payments p ON p.id=r.payment_id
        WHERE r.status='PENDING' AND (r.next_attempt_at IS NULL OR r.next_attempt_at<=clock_timestamp())
        AND (p.provider='MOCK' OR $1) ORDER BY r.created_at,r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
        [this.env.VNPAY_REFUND_ENABLED],
      );
      if (!row) return;
      const token = randomUUID();
      const [claimed] = await exec.query<RefundClaim>(
        `UPDATE refunds SET status='PROCESSING',sent_at=COALESCE(sent_at,clock_timestamp()),
        claim_token=$2::uuid,lease_until=clock_timestamp()+($3*interval '1 millisecond'),attempts=attempts+1,
        version=version+1,updated_at=now() WHERE id=$1::uuid AND status='PENDING' AND version=$4 RETURNING *`,
        [row.id, token, this.env.REFUND_LEASE_MS, row.version],
      );
      if (!claimed) return;
      await exec.query(
        "UPDATE refund_dispatch SET next_at=clock_timestamp()+($2*interval '1 millisecond'),version=version+1,updated_at=now() WHERE id=$1::uuid RETURNING id",
        [DISPATCH_ID, 1000 / this.env.REFUND_RATE_PER_SEC],
      );
      return { ...row, ...claimed, reconcile: row.sent_at !== null };
    });
  }
  input(row: RefundClaim): RefundInput {
    // CreateDate chính xác đã được lưu trong redirect_url từ T-302.
    const url = new URL(row.redirect_url);
    const date =
      row.provider === "VNPAY" ? (url.searchParams.get("vnp_CreateDate") ?? "") : "20260101000000";
    return {
      refundId: row.id,
      paymentId: row.payment_id,
      amountVnd: Number(row.amount_vnd),
      transactionDate: date,
      providerTxnId: row.provider_txn_id,
      sentAt: row.sent_at,
      actorId: row.approved_by ?? SYSTEM_ACTOR,
    };
  }
  async finish(
    row: RefundClaim,
    result: RefundResult,
    random: () => number = Math.random,
  ): Promise<string | undefined> {
    return this.payments.db.transaction(async (exec) => {
      // Batch có thể gắn refund trong lúc HTTP đang chạy; claim token vẫn là fence.
      const [current] = await exec.query<{ version: number; batch_id: string | null }>(
        "SELECT version,batch_id FROM refunds WHERE id=$1::uuid AND status='PROCESSING' AND claim_token=$2::uuid FOR UPDATE",
        [row.id, row.claim_token],
      );
      if (!current) return;
      const retry =
        (result.status === "NOT_PERFORMED" || (result.status === "UNKNOWN" && !row.reconcile)) &&
        row.attempts < this.env.REFUND_MAX_ATTEMPTS;
      const status =
        result.status === "SUCCEEDED" ? "SUCCEEDED" : retry ? "PENDING" : "NEEDS_MANUAL";
      const delay =
        Math.min(
          this.env.REFUND_BACKOFF_MAX_MS,
          this.env.REFUND_BACKOFF_MS * 2 ** Math.min(row.attempts - 1, 30),
        ) *
        (0.5 + random() * 0.5);
      const changed = await exec.query(
        `UPDATE refunds SET status=$4::varchar,claim_token=NULL,lease_until=NULL,
        sent_at=CASE WHEN $5 THEN NULL ELSE sent_at END,
        provider_refund_id=$6,last_error=$7,next_attempt_at=CASE WHEN $4::varchar='PENDING' THEN clock_timestamp()+($8*interval '1 millisecond') ELSE NULL END,
        version=version+1,updated_at=now() WHERE id=$1::uuid AND status='PROCESSING' AND claim_token=$2::uuid AND version=$3 RETURNING id`,
        [
          row.id,
          row.claim_token,
          current.version,
          status,
          result.status === "NOT_PERFORMED",
          result.status === "SUCCEEDED" ? result.providerRefundId : null,
          result.status === "SUCCEEDED" ? null : result.code,
          delay,
        ],
      );
      if (!changed.length) return;
      if (status === "SUCCEEDED")
        await new OutboxService().add(
          exec,
          newMessage(
            "RefundCompleted",
            {
              refund_id: row.id,
              payment_id: row.payment_id,
              order_id: row.ref_id,
              amount_vnd: Number(row.amount_vnd),
              ...(current.batch_id ? { batch_id: current.batch_id } : {}),
            },
            { trace_id: row.trace_id },
          ),
          row.ref_id,
        );
      return status;
    });
  }
}
