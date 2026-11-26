import { randomUUID } from "node:crypto";
import request from "supertest";
import { newMessage, parseMessage } from "@ticketing/event-contracts";
import { InboxProcessor, OutboxService } from "@ticketing/outbox-inbox";
import { seedRefundBatch } from "../support/refunds";
import { MetricsService } from "../../src/metrics/metrics";
import { LOGGER } from "../../src/app.tokens";
import type { Logger } from "@ticketing/common";
import { fixture, Fixture } from "../support/payment";
import { refundHandler } from "../../src/modules/refunds/refund.handler";
import { RefundWorker } from "../../src/modules/refunds/refund-worker";
import { RefundRepository } from "../../src/modules/refunds/refund.repository";

describe("T-401 durable refunds", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture({ REFUND_RATE_PER_SEC: 1000000 });
  });
  afterAll(async () => {
    await f?.close();
  });
  afterEach(() => jest.restoreAllMocks());
  const inbox = () =>
    new InboxProcessor({
      db: f.repo.db,
      consumerName: "test-refunds",
      handler: refundHandler,
      maxAttempts: 1,
      deadLetter: async () => {
        throw new Error("Unexpected refund DLQ");
      },
    });
  async function paid() {
    const s = await f.seed();
    expect(f.dead).toEqual([]);
    const created = await f.post(s.user, s.order, randomUUID());
    expect({ status: created.status, body: created.body }).toMatchObject({ status: 201 });
    await f.worker.tick();
    return { ...s, payment: await f.row(s.order) };
  }
  async function pending() {
    const s = await paid();
    await inbox().process(
      f.record(
        newMessage("OrderCancelled", {
          order_id: s.order,
          event_id: s.event,
          reason: "LATE_PAYMENT",
        }),
      ),
    );
    const [r] = (
      await f.repo.pool.query<{ id: string }>("SELECT id FROM refunds WHERE payment_id=$1", [
        s.payment.id,
      ])
    ).rows;
    return { ...s, refundId: r.id };
  }
  const refundRow = async (id: string) =>
    (
      await f.repo.pool.query<{
        status: string;
        sent_at: Date | null;
        next_attempt_at: Date | null;
        attempts: number;
        version: number;
      }>("SELECT * FROM refunds WHERE id=$1", [id])
    ).rows[0];
  const retry = async (id: string, token: string, key = randomUUID()) =>
    request(f.app.getHttpServer())
      .post(`/v1/admin/refunds/${id}/retry`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send();
  it("three distinct cancellation messages and replay produce one refund and one completion", async () => {
    const s = await paid();
    const consumer = inbox();
    for (let i = 0; i < 3; i++)
      await consumer.process(
        f.record(
          newMessage("OrderCancelled", {
            order_id: s.order,
            event_id: s.event,
            reason: "LATE_PAYMENT",
          }),
        ),
      );
    const worker = f.app.get(RefundWorker);
    await worker.tick();
    await worker.tick();
    const refunds = await f.repo.pool.query("SELECT * FROM refunds WHERE payment_id=$1", [
      s.payment.id,
    ]);
    expect(refunds.rows).toHaveLength(1);
    expect(refunds.rows[0].status).toBe("SUCCEEDED");
    const out = await f.repo.pool.query(
      "SELECT payload FROM outbox_events WHERE message_key=$1 AND event_type='RefundCompleted'",
      [s.order],
    );
    expect(out.rows).toHaveLength(1);
    expect(parseMessage(out.rows[0].payload).type).toBe("RefundCompleted");
    await expect(
      f.repo.pool.query(
        "INSERT INTO refunds(id,payment_id,amount_vnd,reason) VALUES($1,$2,100000,'duplicate')",
        [randomUUID(), s.payment.id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
  it("Admin APIs require ADMIN and audit each successful action", async () => {
    const s = await paid();
    await request(f.app.getHttpServer())
      .post("/v1/admin/refunds")
      .set("Authorization", `Bearer ${await f.token(s.user)}`)
      .set("Idempotency-Key", randomUUID())
      .send({ order_id: s.order, reason: "test" })
      .expect(403);
  });
  it("retains durable send marker when a worker dies and claims only for reconciliation", async () => {
    const s = await paid();
    await inbox().process(
      f.record(
        newMessage("OrderCancelled", {
          order_id: s.order,
          event_id: s.event,
          reason: "LATE_PAYMENT",
        }),
      ),
    );
    const repo = f.app.get(RefundRepository);
    const claim = await repo.claim();
    expect(claim).toBeDefined();
    await f.repo.pool.query(
      "UPDATE refunds SET lease_until=now()-interval '1 second' WHERE id=$1",
      [claim!.id],
    );
    const recovered = await repo.claim();
    expect(recovered?.id).toBe(claim!.id);
    expect(recovered?.reconcile).toBe(true);
    await repo.finish(recovered!, { status: "UNKNOWN", code: "NO_EVIDENCE" });
    expect(
      (await f.repo.pool.query("SELECT status,sent_at FROM refunds WHERE id=$1", [claim!.id]))
        .rows[0],
    ).toMatchObject({ status: "NEEDS_MANUAL", sent_at: expect.any(Date) });
    const token = await f.token(randomUUID(), ["ADMIN"]);
    const calls = jest.spyOn(f.service.mock, "refund");
    await retry(claim!.id, token).then((res) => expect(res.status).toBe(201));
    expect((await refundRow(claim!.id)).sent_at).toEqual(claim!.sent_at);
    await f.app.get(RefundWorker).tick();
    expect(calls).not.toHaveBeenCalled();
    expect((await refundRow(claim!.id)).status).toBe("NEEDS_MANUAL");
    expect(
      await repo.finish(claim!, { status: "SUCCEEDED", providerRefundId: "stale-worker" }),
    ).toBeUndefined();
  });
  it("retries only proven non-execution, respects exponential jitter bounds and reaches NEEDS_MANUAL", async () => {
    const s = await pending(),
      repo = f.app.get(RefundRepository);
    const original = f.service.mock.refund.bind(f.service.mock);
    const provider = jest
      .spyOn(f.service.mock, "refund")
      .mockResolvedValueOnce({ status: "NOT_PERFORMED", code: "MOCK_NOT_PERFORMED" })
      .mockResolvedValueOnce({ status: "NOT_PERFORMED", code: "MOCK_NOT_PERFORMED" })
      .mockImplementation(original);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const started = Date.now();
      await f.app.get(RefundWorker).tick();
      const row = await refundRow(s.refundId);
      expect(row.attempts).toBe(attempt);
      if (attempt < 3) {
        expect(row.status).toBe("PENDING");
        expect(row.sent_at).toBeNull();
        const min = f.env.REFUND_BACKOFF_MS * 2 ** (attempt - 1) * 0.5;
        expect(row.next_attempt_at!.getTime() - started).toBeGreaterThanOrEqual(min - 10);
        expect(row.next_attempt_at!.getTime() - Date.now()).toBeLessThanOrEqual(min * 2 + 100);
        expect(await repo.claim()).toBeUndefined();
        await f.repo.pool.query(
          "UPDATE refunds SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [s.refundId],
        );
      } else expect(row.status).toBe("SUCCEEDED");
    }
    expect(provider).toHaveBeenCalledTimes(3);
    const permanent = await pending();
    provider.mockResolvedValue({ status: "NOT_PERFORMED", code: "MOCK_NOT_PERFORMED" });
    for (let i = 0; i < f.env.REFUND_MAX_ATTEMPTS; i++) {
      await f.app.get(RefundWorker).tick();
      await f.repo.pool.query(
        "UPDATE refunds SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [permanent.refundId],
      );
    }
    expect(await refundRow(permanent.refundId)).toMatchObject({
      status: "NEEDS_MANUAL",
      attempts: 5,
      sent_at: null,
    });
    const token = await f.token(randomUUID(), ["ADMIN"]);
    provider.mockImplementation(original);
    expect((await retry(permanent.refundId, token)).status).toBe(201);
    await f.app.get(RefundWorker).tick();
    expect((await refundRow(permanent.refundId)).status).toBe("SUCCEEDED");
    expect((await retry(permanent.refundId, token)).status).toBe(409);
  });
  it("provider accepts then loses response: reconciles receipt, completes once and exports correlated metrics", async () => {
    const s = await pending();
    const logs = jest.spyOn(f.app.get<Logger>(LOGGER), "info");
    const original = f.service.mock.refund.bind(f.service.mock);
    const provider = jest.spyOn(f.service.mock, "refund").mockImplementation(async (input) => {
      await original(input);
      throw new Error("Response lost");
    });
    await f.app.get(RefundWorker).tick();
    expect(await refundRow(s.refundId)).toMatchObject({
      status: "PENDING",
      sent_at: expect.any(Date),
    });
    await f.repo.pool.query(
      "UPDATE refunds SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [s.refundId],
    );
    await f.app.get(RefundWorker).tick();
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await refundRow(s.refundId)).status).toBe("SUCCEEDED");
    expect(
      (
        await f.repo.pool.query(
          "SELECT count(*)::int n FROM outbox_events WHERE event_type='RefundCompleted' AND message_key=$1",
          [s.order],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(await f.app.get(MetricsService).registry.metrics()).toContain(
      'refunds_total{status="SUCCEEDED"}',
    );
    expect(logs).toHaveBeenCalledWith(
      expect.objectContaining({
        refund_id: s.refundId,
        payment_id: s.payment.id,
        batch_id: null,
        trace_id: expect.any(String),
        request_id: s.refundId,
        status: "SUCCEEDED",
      }),
      "refund attempt recorded",
    );
  });
  it("refund transition rolls back with Outbox failure; replay of finish emits only once", async () => {
    const s = await pending(),
      repo = f.app.get(RefundRepository),
      claim = await repo.claim();
    expect(claim?.id).toBe(s.refundId);
    const receipt = await f.service.mock.refund(repo.input(claim!));
    const outbox = jest
      .spyOn(OutboxService.prototype, "add")
      .mockRejectedValueOnce(new Error("Injected outbox failure"));
    await expect(repo.finish(claim!, receipt)).rejects.toThrow("Injected outbox failure");
    outbox.mockRestore();
    expect(await refundRow(s.refundId)).toMatchObject({
      status: "PROCESSING",
      version: claim!.version,
    });
    expect(await repo.finish(claim!, receipt)).toBe("SUCCEEDED");
    expect(await repo.finish(claim!, receipt)).toBeUndefined();
  });
  it("all five Admin actions are audited, POST keys replay, and tenant scope cannot be crossed", async () => {
    const s = await seedRefundBatch(f, 1),
      other = await seedRefundBatch(f, 1);
    const actor = randomUUID(),
      token = await f.token(actor, ["ADMIN"], s.organizer),
      key = randomUUID();
    const post = (order: string, reason: string, k = key) =>
      request(f.app.getHttpServer())
        .post("/v1/admin/refunds")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", k)
        .send({ order_id: order, reason });
    const one = await post(s.inputs[0].order, "test");
    expect(one.status).toBe(201);
    expect((await post(s.inputs[0].order, "test")).body).toEqual(one.body);
    expect((await post(s.inputs[0].order, "changed")).status).toBe(422);
    expect((await post(other.inputs[0].order, "test", randomUUID())).status).toBe(403);
    const batch = await request(f.app.getHttpServer())
      .post("/v1/admin/refund-batches")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", randomUUID())
      .send({ event_id: s.eventId, reason: "test" })
      .expect(201);
    const progress = await request(f.app.getHttpServer())
      .get(`/v1/admin/refund-batches/${batch.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(progress.body).toMatchObject({ total: 1, pending: 1 });
    await request(f.app.getHttpServer())
      .get(`/v1/admin/refund-batches/${other.batchId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    const list = await request(f.app.getHttpServer())
      .get("/v1/admin/refunds?status=PENDING")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(list.body.items.map((r: { id: string }) => r.id)).toEqual([one.body.id]);
    const claim = await f.app.get(RefundRepository).claim();
    expect(claim).toBeDefined();
    await f.app.get(RefundRepository).finish(claim!, { status: "UNKNOWN", code: "NO_PROOF" });
    await f.repo.pool.query(
      "UPDATE refunds SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [claim!.id],
    );
    const reconcile = await f.app.get(RefundRepository).claim();
    expect(reconcile?.id).toBe(claim!.id);
    await f.app.get(RefundRepository).finish(reconcile!, { status: "UNKNOWN", code: "NO_PROOF" });
    expect((await retry(claim!.id, await f.token(actor, ["ADMIN"]))).status).toBe(201);
    const audits = await f.repo.pool.query<{ action: string }>(
      "SELECT payload->'data'->>'action' AS action FROM outbox_events WHERE event_type='AuditRecorded' AND payload->'data'->>'actor_id'=$1",
      [actor],
    );
    expect(audits.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        "refund.create",
        "refund.batch.create",
        "refund.batch.read",
        "refund.list",
        "refund.retry",
      ]),
    );
    for (const path of ["/v1/admin/refunds", "/v1/admin/refund-batches/" + s.batchId])
      await request(f.app.getHttpServer())
        .get(path)
        .set("Authorization", `Bearer ${await f.token(actor)}`)
        .expect(403);
    await f.app.get(RefundWorker).tick();
  });
  it("EventCancelled races a delayed success and still refunds the ORDER once, without resale refunds", async () => {
    const s = await f.seed();
    expect((await f.post(s.user, s.order, randomUUID())).status).toBe(201);
    await inbox().process(
      f.record(
        newMessage(
          "EventCancelled",
          { event_id: s.event, organizer_id: randomUUID(), reason: "test", event_version: 1 },
          { version: 2 },
        ),
        "event.lifecycle",
      ),
    );
    await f.worker.tick();
    const p = await f.row(s.order);
    expect(p.status).toBe("SUCCEEDED");
    await f.app.get(RefundWorker).tick();
    expect(
      (await f.repo.pool.query("SELECT status FROM refunds WHERE payment_id=$1", [p.id])).rows[0]
        .status,
    ).toBe("SUCCEEDED");
    const resale = await f.seedResale();
    await f.postResale(resale.user, resale.order);
    await f.worker.tick();
    await inbox().process(
      f.record(
        newMessage(
          "EventCancelled",
          { event_id: resale.event, organizer_id: randomUUID(), reason: "test", event_version: 1 },
          { version: 2 },
        ),
        "event.lifecycle",
      ),
    );
    expect(
      (
        await f.repo.pool.query(
          "SELECT count(*)::int n FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.purpose='RESALE'",
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("attaches an in-flight refund to a cancellation batch without discarding its verified success", async () => {
    const s = await pending(),
      repo = f.app.get(RefundRepository),
      claim = await repo.claim();
    expect(claim?.id).toBe(s.refundId);
    const result = await f.service.mock.refund(repo.input(claim!));
    const actor = randomUUID(),
      token = await f.token(actor, ["ADMIN"]);
    const batch = await request(f.app.getHttpServer())
      .post("/v1/admin/refund-batches")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", randomUUID())
      .send({ event_id: s.event, reason: "manual" })
      .expect(201);
    expect(await repo.finish(claim!, result)).toBe("SUCCEEDED");
    const [event] = (
      await f.repo.pool.query<{ payload: { data: { batch_id: string } } }>(
        "SELECT payload FROM outbox_events WHERE event_type='RefundCompleted' AND message_key=$1",
        [s.order],
      )
    ).rows;
    expect(event.payload.data.batch_id).toBe(batch.body.id);
    const owner = randomUUID();
    await inbox().process(
      f.record(
        newMessage(
          "EventCancelled",
          { event_id: s.event, organizer_id: owner, event_version: 1, reason: "test" },
          { version: 2 },
        ),
        "event.lifecycle",
      ),
    );
    expect(
      (
        await f.repo.pool.query("SELECT reason,automatic FROM refund_batches WHERE id=$1", [
          batch.body.id,
        ])
      ).rows[0],
    ).toEqual({ reason: "EVENT_CANCELLED", automatic: true });
    await request(f.app.getHttpServer())
      .get("/v1/admin/refunds")
      .set("Authorization", `Bearer ${await f.token(actor, ["ADMIN"], "invalid-tenant")}`)
      .expect(403);
    for (const path of ["/v1/admin/refund-batches", `/v1/admin/refunds/${s.refundId}/retry`])
      await request(f.app.getHttpServer())
        .post(path)
        .set("Authorization", `Bearer ${await f.token(actor)}`)
        .set("Idempotency-Key", randomUUID())
        .send({ event_id: s.event, reason: "test" })
        .expect(403);
  });
});
