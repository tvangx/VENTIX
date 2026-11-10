import { randomUUID } from "node:crypto";
import request from "supertest";
import { newMessage, parseMessage, Topics } from "@ticketing/event-contracts";
import { OutboxService } from "@ticketing/outbox-inbox";
import { fixture, Fixture } from "../support/payment";

describe("resale payments share the payment state machine", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture();
  });
  afterAll(async () => {
    await f?.close();
  });

  it("requires exactly one reference, including when both values are malformed/null", async () => {
    const user = randomUUID();
    for (const refs of [
      {},
      { order_id: randomUUID(), resale_order_id: randomUUID() },
      { order_id: null, resale_order_id: randomUUID() },
      { order_id: "bad", resale_order_id: "bad" },
    ]) {
      const response = await request(f.app.getHttpServer())
        .post("/v1/payments")
        .set("Authorization", `Bearer ${await f.token(user)}`)
        .set("Idempotency-Key", randomUUID())
        .send({ ...refs, provider: "MOCK" });
      expect(response.status).toBe(422);
      expect(response.headers["content-type"]).toContain("application/problem+json");
    }
  });

  it("returns 409 with Retry-After for a missing resale payable, then enforces buyer and expiry", async () => {
    const missing = await f.postResale(randomUUID(), randomUUID());
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe("ORDER_NOT_READY");
    expect(missing.headers["retry-after"]).toBe("1");
    const s = await f.seedResale();
    expect((await f.postResale(randomUUID(), s.order)).status).toBe(403);
    const expired = await f.seedResale(-1);
    expect((await f.postResale(expired.user, expired.order)).body.code).toBe("PAYABLE_EXPIRED");
  });

  it("deduplicates resale snapshots without reopening a closed payable", async () => {
    const s = await f.seedResale();
    expect(await f.inbox.process(f.record(s.message, Topics.RESALE_EVENTS))).toBe("duplicate");
    await f.repo.pool.query(
      "UPDATE payables SET status='CANCELLED' WHERE purpose='RESALE' AND ref_id=$1",
      [s.order],
    );
    const changed = newMessage("ResaleOrderAwaitingPayment", { ...s.message.data, amount_vnd: 1 });
    expect(await f.inbox.process(f.record(changed, Topics.RESALE_EVENTS))).toBe("processed");
    const rows = await f.repo.pool.query(
      "SELECT * FROM payables WHERE purpose='RESALE' AND ref_id=$1",
      [s.order],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      status: "CANCELLED",
      amount_vnd: "125000",
      user_id: s.user,
      event_id: s.event,
    });
    expect((await f.postResale(s.user, s.order)).body.code).toBe("PAYABLE_EXPIRED");
  });

  it("mock completes resale and duplicate IPNs produce one transaction and one PaymentSucceeded", async () => {
    const s = await f.seedResale(),
      key = randomUUID();
    const created = await f.postResale(s.user, s.order, key);
    expect(created.status).toBe(201);
    await f.worker.tick();
    const p = await f.row(s.order);
    expect(p).toMatchObject({
      purpose: "RESALE",
      ref_id: s.order,
      event_id: s.event,
      user_id: s.user,
      status: "SUCCEEDED",
      amount_vnd: "125000",
      version: 1,
    });
    const n = f.service.mock.verifyIpn(p.mock_data.notification)!;
    expect(await f.service.receive("MOCK", n, "resale-duplicate")).toBe("02");
    const txs = await f.repo.pool.query("SELECT * FROM payment_transactions WHERE payment_id=$1", [
      p.id,
    ]);
    expect(txs.rows).toHaveLength(1);
    const events = await f.repo.pool.query(
      "SELECT payload FROM outbox_events WHERE message_key=$1",
      [s.order],
    );
    expect(events.rows).toHaveLength(1);
    expect(parseMessage(events.rows[0].payload)).toMatchObject({
      type: "PaymentSucceeded",
      data: { purpose: "RESALE", resale_order_id: s.order, payment_id: p.id, amount_vnd: 125000 },
    });
    expect(events.rows[0].payload.data).not.toHaveProperty("order_id");
    expect((await f.postResale(s.user, s.order, key)).body).toEqual(created.body);
    expect((await f.postResale(s.user, s.order)).body.code).toBe("PAYMENT_ALREADY_ACTIVE");
  });

  it("failed resale emits PaymentFailed once and permits a new attempt", async () => {
    const s = await f.seedResale();
    await f.postResale(s.user, s.order);
    const p = await f.row(s.order);
    const n = {
      ...f.service.mock.verifyIpn(p.mock_data.notification)!,
      succeeded: false,
      reason: "OTP",
    };
    expect(await f.service.receive("MOCK", n, "resale-failure")).toBe("00");
    expect(await f.service.receive("MOCK", n, "resale-failure")).toBe("02");
    const events = await f.repo.pool.query(
      "SELECT payload FROM outbox_events WHERE message_key=$1",
      [s.order],
    );
    expect(events.rows).toHaveLength(1);
    expect(parseMessage(events.rows[0].payload)).toMatchObject({
      type: "PaymentFailed",
      data: { purpose: "RESALE", resale_order_id: s.order, reason: "OTP" },
    });
    expect(events.rows[0].payload.data).not.toHaveProperty("order_id");
    expect((await f.postResale(s.user, s.order)).status).toBe(201);
  });

  it("isolates ORDER and RESALE sharing a UUID and rejects reusing a key across purposes", async () => {
    const order = await f.seed();
    await f.seedResale(900, order.order, order.user);
    const key = randomUUID();
    expect((await f.post(order.user, order.order, key)).status).toBe(201);
    expect((await f.postResale(order.user, order.order, key)).body.code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );
    expect((await f.postResale(order.user, order.order)).status).toBe(201);
    const rows = await f.repo.pool.query(
      "SELECT purpose,amount_vnd FROM payments WHERE ref_id=$1 ORDER BY purpose",
      [order.order],
    );
    expect(rows.rows).toEqual([
      { purpose: "ORDER", amount_vnd: "100000" },
      { purpose: "RESALE", amount_vnd: "125000" },
    ]);
  });

  it("rolls back resale state and callback record if Outbox insertion fails", async () => {
    const s = await f.seedResale();
    await f.postResale(s.user, s.order);
    const p = await f.row(s.order),
      n = f.service.mock.verifyIpn(p.mock_data.notification)!;
    const fail = jest
      .spyOn(OutboxService.prototype, "add")
      .mockRejectedValueOnce(new Error("resale outbox failure"));
    try {
      await expect(f.service.receive("MOCK", n, "resale-rollback")).rejects.toThrow(
        "resale outbox failure",
      );
    } finally {
      fail.mockRestore();
    }
    expect((await f.row(s.order)).status).toBe("PENDING");
    expect(
      (await f.repo.pool.query("SELECT * FROM payment_transactions WHERE payment_id=$1", [p.id]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await f.repo.pool.query("SELECT * FROM outbox_events WHERE message_key=$1", [s.order])).rows,
    ).toHaveLength(0);
    expect(await f.service.receive("MOCK", n, "resale-rollback")).toBe("00");
  });
});
