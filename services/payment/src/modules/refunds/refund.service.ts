import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { uuidv7 } from "uuidv7";
import { AuthUser } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { newMessage } from "@ticketing/event-contracts";
import { OutboxService, SqlExecutor } from "@ticketing/outbox-inbox";
import { PaymentRepository } from "../payments/payment.repository";
import { z } from "zod";
import { createBatch, createRefunds, lockRefundEvent } from "./refund.handler";

const columns =
  "r.id,r.payment_id,r.batch_id,r.amount_vnd::text,r.reason,r.status,r.attempts,r.next_attempt_at,r.last_error,r.provider_refund_id,r.created_at,r.updated_at";
type View = Record<string, unknown>;
@Injectable()
export class RefundService {
  constructor(private readonly repo: PaymentRepository) {}
  private admin(user: AuthUser): void {
    if (
      !user.roles.includes("ADMIN") ||
      !z.string().uuid().safeParse(user.userId).success ||
      (user.organizerId !== undefined && !z.string().uuid().safeParse(user.organizerId).success)
    )
      throw new ProblemException("FORBIDDEN", 403, "Valid ADMIN principal and tenant required");
  }
  private async tenant(exec: SqlExecutor, user: AuthUser, eventId: string): Promise<void> {
    this.admin(user);
    if (!user.organizerId) return; // Admin toàn hệ thống; JWT có organizer_id vẫn giới hạn theo tenant.
    const [scope] = await exec.query<{ organizer_id: string }>(
      "SELECT organizer_id FROM refund_events WHERE id=$1::uuid",
      [eventId],
    );
    if (!scope)
      throw new ProblemException("EVENT_NOT_READY", 409, "Lifecycle tenant snapshot not available");
    if (scope.organizer_id !== user.organizerId.toLowerCase())
      throw new ProblemException("FORBIDDEN", 403, "Event belongs to another tenant");
  }
  private async audit(
    exec: SqlExecutor,
    user: AuthUser,
    action: string,
    resource: string,
    trace: string,
  ): Promise<void> {
    await new OutboxService().add(
      exec,
      newMessage(
        "AuditRecorded",
        { actor_id: user.userId, action, resource_type: "refund", resource_id: resource },
        { trace_id: trace, ...(user.organizerId ? { tenant_id: user.organizerId } : {}) },
      ),
      resource,
    );
  }
  private async command(
    user: AuthUser,
    key: string,
    action: string,
    input: unknown,
    trace: string,
    perform: (exec: SqlExecutor) => Promise<View>,
  ): Promise<View> {
    if (!key || key.length > 200 || !/^[\x21-\x7e]+$/.test(key))
      throw new ProblemException(
        "INVALID_IDEMPOTENCY_KEY",
        400,
        "Idempotency-Key required, 1-200 visible ASCII characters",
      );
    const hash = createHash("sha256")
      .update(
        JSON.stringify({ user: user.userId, tenant: user.organizerId ?? null, action, input }),
      )
      .digest("hex");
    return this.repo.db.transaction(async (exec) => {
      await exec.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `refund-request:${key}`,
      ]);
      const [old] = await exec.query<{ request_hash: string; response: View }>(
        "SELECT request_hash,response FROM refund_requests WHERE key=$1",
        [key],
      );
      if (old && old.request_hash !== hash)
        throw new ProblemException("IDEMPOTENCY_KEY_REUSED", 422, "Key belongs to another request");
      this.admin(user);
      const response = old?.response ?? (await perform(exec));
      if (!old)
        await exec.query(
          "INSERT INTO refund_requests(id,key,request_hash,response) VALUES($1::uuid,$2,$3,$4::jsonb) RETURNING id",
          [uuidv7(), key, hash, JSON.stringify(response)],
        );
      await this.audit(exec, user, action, String(response.id), trace);
      return response;
    });
  }
  create(
    user: AuthUser,
    key: string,
    orderId: string,
    reason: string,
    trace: string,
  ): Promise<View> {
    return this.command(user, key, "refund.create", { orderId, reason }, trace, async (exec) => {
      const [payment] = await exec.query<{ event_id: string }>(
        "SELECT event_id FROM payments WHERE ref_id=$1::uuid AND purpose='ORDER' AND status='SUCCEEDED'",
        [orderId],
      );
      if (!payment)
        throw new ProblemException("PAYMENT_NOT_REFUNDABLE", 409, "No succeeded ORDER payment");
      await lockRefundEvent(exec, payment.event_id);
      await this.tenant(exec, user, payment.event_id);
      await createRefunds(exec, payment.event_id, reason, trace, null, orderId, user.userId);
      return (
        await exec.query<View>(
          `SELECT ${columns} FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.purpose='ORDER' AND p.ref_id=$1::uuid`,
          [orderId],
        )
      )[0];
    });
  }
  batch(
    user: AuthUser,
    key: string,
    eventId: string,
    reason: string,
    trace: string,
  ): Promise<View> {
    return this.command(
      user,
      key,
      "refund.batch.create",
      { eventId, reason },
      trace,
      async (exec) => {
        await lockRefundEvent(exec, eventId);
        await this.tenant(exec, user, eventId);
        const id = await createBatch(exec, eventId, reason, user.userId, false);
        await createRefunds(exec, eventId, reason, trace, id, null, user.userId);
        return { id };
      },
    );
  }
  retry(user: AuthUser, key: string, id: string, trace: string): Promise<View> {
    return this.command(user, key, "refund.retry", { id }, trace, async (exec) => {
      const [r] = await exec.query<{ event_id: string; version: number; status: string }>(
        "SELECT p.event_id,r.version,r.status FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE r.id=$1::uuid FOR UPDATE OF r",
        [id],
      );
      if (!r) throw new ProblemException("REFUND_NOT_FOUND", 404, "Refund not found");
      await this.tenant(exec, user, r.event_id);
      if (r.status !== "NEEDS_MANUAL")
        throw new ProblemException("REFUND_NOT_MANUAL", 409, "Only NEEDS_MANUAL can retry");
      const rows = await exec.query<View>(
        `UPDATE refunds r SET status='PENDING',attempts=0,next_attempt_at=NULL,
        version=version+1,updated_at=now() WHERE id=$1::uuid AND status='NEEDS_MANUAL' AND version=$2 RETURNING ${columns}`,
        [id, r.version],
      );
      // Giữ sent_at: retry không cấp quyền gửi lại khi chưa rõ kết quả.
      if (!rows[0]) throw new ProblemException("REFUND_CONFLICT", 409, "Refund changed");
      return rows[0];
    });
  }
  async batchProgress(user: AuthUser, id: string, trace: string): Promise<View> {
    return this.repo.db.transaction(async (exec) => {
      const [batch] = await exec.query<{ event_id: string }>(
        "SELECT event_id FROM refund_batches WHERE id=$1::uuid",
        [id],
      );
      if (!batch) throw new ProblemException("BATCH_NOT_FOUND", 404, "Batch not found");
      await this.tenant(exec, user, batch.event_id);
      const [counts] = await exec.query<View>(
        `SELECT count(*)::int total,count(*) FILTER(WHERE status='SUCCEEDED')::int succeeded,
        count(*) FILTER(WHERE status IN ('PENDING','PROCESSING'))::int pending,count(*) FILTER(WHERE status='NEEDS_MANUAL')::int needs_manual FROM refunds WHERE batch_id=$1::uuid`,
        [id],
      );
      await this.audit(exec, user, "refund.batch.read", id, trace);
      return { id, event_id: batch.event_id, ...counts };
    });
  }
  async list(
    user: AuthUser,
    status: string | undefined,
    cursor: string | undefined,
    trace: string,
  ): Promise<View> {
    return this.repo.db.transaction(async (exec) => {
      this.admin(user);
      const rows = await exec.query<View>(
        `SELECT ${columns} FROM refunds r JOIN payments p ON p.id=r.payment_id
        LEFT JOIN refund_events e ON e.id=p.event_id WHERE ($1::text IS NULL OR r.status=$1)
        AND ($2::uuid IS NULL OR e.organizer_id=$2::uuid) AND ($3::uuid IS NULL OR r.id>$3::uuid) ORDER BY r.id LIMIT 51`,
        [status ?? null, user.organizerId ?? null, cursor ?? null],
      );
      const items = rows.slice(0, 50);
      await this.audit(exec, user, "refund.list", "refunds", trace);
      return { items, next_cursor: rows.length > 50 ? items[49].id : null };
    });
  }
}
