import { randomUUID } from "node:crypto";
import request from "supertest";
import { OutboxService } from "@ticketing/outbox-inbox";
import { MetricsService } from "../../src/metrics/metrics";
import { newMessage } from "@ticketing/event-contracts";
import { createLogger } from "@ticketing/common";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";
import { PaymentService } from "../../src/modules/payments/payment.service";
import { PaymentWorker } from "../../src/messaging/payment-worker";
import { MockAdapter } from "../../src/modules/payments/mock-adapter";
import { fixture, Fixture } from "../support/payment";

describe("payment PostgreSQL + HTTP", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture();
  });
  afterAll(async () => {
    await f?.close();
  });
  it("requires auth/key, rejects client amount and invalid provider, carries request_id", async () => {
    const s = await f.seed();
    const unauthorized = await request(f.app.getHttpServer())
      .post("/v1/payments")
      .send({ order_id: s.order, provider: "MOCK" })
      .expect(401);
    expect(unauthorized.headers["content-type"]).toContain("application/problem+json");
    expect(unauthorized.body.request_id).toBeTruthy();
    expect((await f.post(s.user, s.order)).status).toBe(400);
    for (const body of [
      { order_id: s.order, provider: "MOMO" },
      { order_id: s.order, provider: "MOCK", amount_vnd: 1 },
    ]) {
      await request(f.app.getHttpServer())
        .post("/v1/payments")
        .set("Authorization", `Bearer ${await f.token(s.user)}`)
        .set("Idempotency-Key", randomUUID())
        .send(body)
        .expect(400);
    }
  });
  it("returns ORDER_NOT_READY + Retry-After:1 and checks ownership/expiry", async () => {
    const s = await f.seed();
    const missing = await f.post(s.user, randomUUID(), randomUUID());
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe("ORDER_NOT_READY");
    expect(missing.headers["retry-after"]).toBe("1");
    expect((await f.post(randomUUID(), s.order, randomUUID())).status).toBe(403);
    const expired = await f.seed(-1);
    expect((await f.post(expired.user, expired.order, randomUUID())).body.code).toBe(
      "PAYABLE_EXPIRED",
    );
  });
  it("replays the stored URL and rejects key reuse by user/order/provider", async () => {
    const s = await f.seed(),
      key = randomUUID();
    const a = await f.post(s.user, s.order, key);
    expect(a.status).toBe(201);
    expect((await f.post(s.user, s.order, key)).body).toEqual(a.body);
    expect((await f.post(s.user, s.order, randomUUID())).body.code).toBe("PAYMENT_ALREADY_ACTIVE");
    expect((await f.post(randomUUID(), s.order, key)).body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await f.post(s.user, randomUUID(), key)).body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await f.post(s.user, s.order, key, "VNPAY")).body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const row = await f.row(s.order);
    expect(row).toMatchObject({
      purpose: "ORDER",
      event_id: s.event,
      user_id: s.user,
      amount_vnd: "100000",
    });
    await f.repo.pool.query(
      "UPDATE payables SET expires_at=now()-interval '1 second' WHERE ref_id=$1",
      [s.order],
    );
    expect((await f.post(s.user, s.order, key)).body).toEqual(a.body);
  });
  it("processes Inbox duplicates once and never overwrites payable on replay", async () => {
    const s = await f.seed();
    expect(await f.inbox.process(f.record(s.message))).toBe("duplicate");
    const changed = newMessage("OrderAwaitingPayment", { ...s.message.data, amount_vnd: 1 });
    expect(await f.inbox.process(f.record(changed))).toBe("processed");
    expect(
      (await f.repo.pool.query("SELECT amount_vnd FROM payables WHERE ref_id=$1", [s.order]))
        .rows[0].amount_vnd,
    ).toBe("100000");
    expect(await f.inbox.process(f.record({ type: "UNKNOWN" }))).toBe("dead-lettered");
    expect(f.dead).toHaveLength(1);
  });
  it("mock completes, duplicates write one transaction/outbox and SUCCEEDED blocks another payment", async () => {
    const s = await f.seed();
    await f.post(s.user, s.order, randomUUID());
    await f.worker.tick();
    const p = await f.row(s.order);
    expect(p.status).toBe("SUCCEEDED");
    expect(p.version).toBe(1);
    expect(
      (
        await f.repo.pool.query(
          "SELECT count(*)::int n FROM payment_transactions WHERE payment_id=$1",
          [p.id],
        )
      ).rows[0].n,
    ).toBe(1);
    const events = await f.repo.pool.query("SELECT * FROM outbox_events WHERE message_key=$1", [
      s.order,
    ]);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload).toMatchObject({
      type: "PaymentSucceeded",
      data: { purpose: "ORDER", order_id: s.order, payment_id: p.id, amount_vnd: 100000 },
    });
    expect((await f.post(s.user, s.order, randomUUID())).body.code).toBe("PAYMENT_ALREADY_ACTIVE");
  });
  it("FAILED permits a new attempt with a new key; old key still replays original response", async () => {
    const s = await f.seed(),
      key = randomUUID();
    const first = await f.post(s.user, s.order, key);
    const p = await f.row(s.order);
    const failed = new MockAdapter({
      minDelayMs: 0,
      maxDelayMs: 0,
      successRate: 0,
      outcome: "FAILURE",
      duplicate: true,
    }).createPayment({
      paymentId: p.id,
      amountVnd: 100000,
      expiresAt: p.expires_at,
      createdAt: new Date(),
      ipAddress: "127.0.0.1",
    }).mock;
    await f.repo.pool.query("UPDATE payments SET mock_data=$2 WHERE id=$1", [
      p.id,
      JSON.stringify(failed),
    ]);
    await f.worker.tick();
    expect((await f.row(s.order)).status).toBe("FAILED");
    expect((await f.post(s.user, s.order, key)).body).toEqual(first.body);
    const second = await f.post(s.user, s.order, randomUUID());
    expect(second.status).toBe(201);
    expect(second.body).not.toEqual(first.body);
    await f.worker.tick();
    expect((await f.row(s.order)).status).toBe("SUCCEEDED");
    const events = await f.repo.pool.query(
      "SELECT event_type FROM outbox_events WHERE message_key=$1 ORDER BY created_at",
      [s.order],
    );
    expect(events.rows.map((r) => r.event_type)).toEqual(["PaymentFailed", "PaymentSucceeded"]);
  });
  it("VNPay Return is read-only; IPN handles signature, missing order, amount, duplicate and DB errors", async () => {
    const s = await f.seed();
    const link = await f.post(s.user, s.order, randomUUID(), "VNPAY");
    expect(link.status).toBe(201);
    const p = await f.row(s.order);
    const params = {
      vnp_TmnCode: "TESTCODE",
      vnp_TxnRef: p.id.replace(/-/g, ""),
      vnp_Amount: "10000000",
      vnp_BankCode: "NCB",
      vnp_OrderInfo: "Thanh toan",
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_TransactionNo: "123456789",
      vnp_PayDate: "20261106220000",
    };
    const query = (patch = {}) => {
      const data = { ...params, ...patch };
      return { ...data, vnp_SecureHash: f.service.vnpay.sign(data) };
    };
    const get = (path: string, q: object) =>
      request(f.app.getHttpServer()).get(`/v1/payments/vnpay/${path}`).query(q).expect(200);
    expect((await get("return", query())).body.signature_valid).toBe(true);
    expect((await f.row(s.order)).status).toBe("PENDING");
    expect((await get("ipn", { ...query(), vnp_SecureHash: "bad" })).body.RspCode).toBe("97");
    expect(
      (await get("ipn", query({ vnp_TxnRef: randomUUID().replace(/-/g, "") }))).body.RspCode,
    ).toBe("01");
    expect((await get("ipn", query({ vnp_Amount: "100" }))).body.RspCode).toBe("04");
    const fail = jest
      .spyOn(f.service, "receive")
      .mockRejectedValueOnce(new Error("synthetic database outage"));
    expect((await get("ipn", query())).body.RspCode).toBe("99");
    fail.mockRestore();
    expect((await get("ipn", query())).body.RspCode).toBe("00");
    expect((await get("ipn", query())).body.RspCode).toBe("02");
    expect((await f.row(s.order)).status).toBe("SUCCEEDED");
    const actual = new URL(link.body.redirect_url);
    expect(actual.searchParams.get("vnp_ExpireDate")).toHaveLength(14);
  });
  it("rolls back payment state and transaction when outbox insert fails", async () => {
    const s = await f.seed();
    await f.post(s.user, s.order, randomUUID());
    const p = await f.row(s.order);
    const fail = jest
      .spyOn(OutboxService.prototype, "add")
      .mockRejectedValueOnce(new Error("synthetic outbox insert failure"));
    const n = f.service.mock.verifyIpn(p.mock_data.notification)!;
    await expect(f.service.receive("MOCK", n, "test")).rejects.toThrow("outbox insert failure");
    fail.mockRestore();
    expect((await f.row(s.order)).status).toBe("PENDING");
    expect(
      (await f.repo.pool.query("SELECT * FROM payment_transactions WHERE payment_id=$1", [p.id]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await f.repo.pool.query("SELECT * FROM outbox_events WHERE message_key=$1", [s.order])).rows,
    ).toHaveLength(0);
  });
  it("recovers persisted mock callbacks after service restart", async () => {
    const s = await f.seed();
    await f.post(s.user, s.order, randomUUID());
    const app = await createApp(
      envSchema.parse(f.rawEnv),
      createLogger("restart", { level: "silent" }),
    );
    try {
      await app.init();
      await app.get(PaymentWorker).tick();
      expect((await f.row(s.order)).status).toBe("SUCCEEDED");
    } finally {
      await app.close();
    }
  });
  it("refuses VNPay before DB insert when unconfigured", async () => {
    const s = await f.seed();
    const env = envSchema.parse({ ...f.rawEnv, VNPAY_ENABLED: "false" });
    const svc = new PaymentService(
      f.repo,
      env,
      createLogger("test", { level: "silent" }),
      f.app.get(MetricsService),
    );
    await expect(
      svc.create(s.user, randomUUID(), s.order, "VNPAY", "127.0.0.1", "test"),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(await f.row(s.order)).toBeUndefined();
  });
});
