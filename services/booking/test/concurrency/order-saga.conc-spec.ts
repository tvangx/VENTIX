import { randomUUID } from "node:crypto";
import { newMessage } from "@ticketing/event-contracts";
import { InboxProcessor } from "@ticketing/outbox-inbox";
import { paymentHandler } from "../../src/messaging/payment.handler";
import { sweepExpiredOrders, drainSagaWork } from "../../src/orders/order-saga";
import { CheckoutFixture, checkoutFixture } from "../support/checkout";

describe("T-303 saga concurrency", () => {
  let f: CheckoutFixture;
  beforeAll(async () => {
    f = await checkoutFixture();
  });
  afterAll(async () => {
    await f?.close();
  });

  it("two replica sweepers process 120 orders once, at most 100 per transaction", async () => {
    const s = await f.seed(1000);
    const orders = await Promise.all(
      Array.from({ length: 120 }, () =>
        f.service.checkout(
          randomUUID(),
          randomUUID(),
          {
            ...s.input,
            seat_ids: [],
            ga_items: [{ ticket_class_id: s.ga, quantity: 1 }],
          },
          "sweeper-concurrency",
        ),
      ),
    );
    const ids = orders.map((o) => o.order_id);
    await f.db.pool.query(
      "UPDATE orders SET expires_at=now()-interval '60 seconds' WHERE id=ANY($1::uuid[])",
      [ids],
    );
    const counts = await Promise.all(
      [0, 1].map(() => f.repository.db.transaction((e) => sweepExpiredOrders(e, 30))),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBe(120);
    expect(counts.every((n) => n <= 100)).toBe(true);
    expect(
      (
        await f.db.pool.query("SELECT status FROM orders WHERE id=ANY($1::uuid[])", [ids])
      ).rows.every((o) => o.status === "EXPIRED"),
    ).toBe(true);
    const events = (
      await f.db.pool.query(
        "SELECT message_key,count(*)::int n FROM outbox_events WHERE event_type='OrderExpired' AND message_key=ANY($1::text[]) GROUP BY message_key",
        [ids],
      )
    ).rows;
    expect(events).toHaveLength(120);
    expect(events.every((e) => e.n === 1)).toBe(true);
    expect(
      (await f.db.pool.query("SELECT sold FROM ticket_class_stock WHERE class_id=$1", [s.ga]))
        .rows[0].sold,
    ).toBe(0);
  });

  it("skips a row locked by another replica without waiting", async () => {
    const s = await f.seed();
    const result = await f.service.checkout(
      s.user,
      randomUUID(),
      { ...s.input, seat_ids: [], ga_items: [{ ticket_class_id: s.ga, quantity: 1 }] },
      "skip-locked",
    );
    await f.db.pool.query("UPDATE orders SET expires_at=now()-interval '60 seconds' WHERE id=$1", [
      result.order_id,
    ]);
    const lock = await f.db.pool.connect();
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [result.order_id]);
      expect(await f.repository.db.transaction((e) => sweepExpiredOrders(e, 30))).toBe(0);
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
    }
    expect(await f.repository.db.transaction((e) => sweepExpiredOrders(e, 30))).toBe(1);
  });

  it("50 duplicated/re-enveloped successes racing expiry produce one terminal decision", async () => {
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    const result = await f.service.checkout(s.user, randomUUID(), s.input, "payment-race");
    await f.db.pool.query("UPDATE orders SET expires_at=now()-interval '60 seconds' WHERE id=$1", [
      result.order_id,
    ]);
    const message = newMessage("PaymentSucceeded", {
      payment_id: randomUUID(),
      purpose: "ORDER",
      order_id: result.order_id,
      amount_vnd: result.total_amount_vnd,
      provider: "MOCK",
      provider_txn_id: randomUUID(),
      paid_at: new Date().toISOString(),
    });
    const p = new InboxProcessor({
      consumerName: "race",
      db: f.repository.db,
      handler: paymentHandler,
      deadLetter: async () => {
        throw new Error("Unexpected DLQ");
      },
    });
    await Promise.all([
      ...Array.from({ length: 50 }, (_, i) =>
        p.process({
          topic: "payment.events",
          partition: 0,
          offset: String(i),
          key: null,
          value: Buffer.from(
            JSON.stringify(i % 2 ? message : { ...message, message_id: randomUUID() }),
          ),
        }),
      ),
      ...[0, 1].map(() => f.repository.db.transaction((e) => sweepExpiredOrders(e, 30))),
    ]);
    const status = (
      await f.db.pool.query("SELECT status FROM orders WHERE id=$1", [result.order_id])
    ).rows[0].status;
    expect(["CONFIRMED", "REFUND_REQUIRED"]).toContain(status);
    const types = (
      await f.db.pool.query(
        "SELECT event_type FROM outbox_events WHERE message_key=$1 AND event_type IN ('OrderConfirmed','OrderCancelled')",
        [result.order_id],
      )
    ).rows.map((e) => e.event_type);
    expect(types).toEqual([status === "CONFIRMED" ? "OrderConfirmed" : "OrderCancelled"]);
    await Promise.all([
      drainSagaWork(f.repository.db, f.client),
      drainSagaWork(f.repository.db, f.client),
    ]);
    const state = (
      await f.db.pool.query("SELECT state FROM seat_allocations WHERE order_id=$1", [
        result.order_id,
      ])
    ).rows[0].state;
    expect(state).toBe(status === "CONFIRMED" ? "SOLD" : "RELEASED");
  });
});
