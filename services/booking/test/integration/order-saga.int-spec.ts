import { randomUUID } from "node:crypto";
import { newMessage, parseMessage } from "@ticketing/event-contracts";
import { InboxProcessor, OutboxService } from "@ticketing/outbox-inbox";
import { paymentHandler } from "../../src/messaging/payment.handler";
import { sweepExpiredOrders, drainSagaWork } from "../../src/orders/order-saga";
import { stockHandler } from "../../src/messaging/stock.handler";
import { CheckoutFixture, checkoutFixture } from "../support/checkout";
import { pollUntil } from "../support/booking-redis";

describe("T-303 order saga", () => {
  let f: CheckoutFixture;
  beforeAll(async () => {
    f = await checkoutFixture();
  });
  afterAll(async () => {
    await f?.close();
  });
  const inbox = () =>
    new InboxProcessor({
      consumerName: "test-payment-saga",
      db: f.repository.db,
      handler: paymentHandler,
      maxAttempts: 1,
      deadLetter: async () => {
        throw new Error("Unexpected DLQ");
      },
    });
  const record = (message: unknown) => ({
    topic: "payment.events",
    partition: 0,
    offset: "0",
    key: null,
    value: Buffer.from(JSON.stringify(message)),
  });
  async function order(merch = false) {
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    const sku = randomUUID();
    const input = {
      ...s.input,
      ga_items: [{ ticket_class_id: s.ga, quantity: 2 }],
      merch_items: merch ? [{ sku_id: sku, quantity: 1 }] : [],
    };
    const result = await f.service.checkout(s.user, randomUUID(), input, "saga-test");
    const success = newMessage("PaymentSucceeded", {
      payment_id: randomUUID(),
      purpose: "ORDER",
      order_id: result.order_id,
      amount_vnd: result.total_amount_vnd,
      provider: "MOCK",
      provider_txn_id: randomUUID(),
      paid_at: new Date().toISOString(),
    });
    return { ...s, sku, result, success };
  }
  const status = async (id: string) =>
    (await f.db.pool.query("SELECT status FROM orders WHERE id=$1", [id])).rows[0].status;
  const events = async (id: string, type: string) =>
    (
      await f.db.pool.query(
        "SELECT payload FROM outbox_events WHERE message_key=$1 AND event_type=$2",
        [id, type],
      )
    ).rows;
  const drain = () => drainSagaWork(f.repository.db, f.client);

  it("confirms once with full items/totals, sells seats, handles duplicate IDs and reordered failures", async () => {
    const s = await order();
    const p = inbox();
    const failure = newMessage("PaymentFailed", {
      payment_id: randomUUID(),
      purpose: "ORDER",
      order_id: s.result.order_id,
      reason: "OTP",
    });
    await p.process(record(failure));
    expect(await status(s.result.order_id)).toBe("AWAITING_PAYMENT");
    expect(await p.process(record(s.success))).toBe("processed");
    expect(await p.process(record(s.success))).toBe("duplicate");
    await p.process(record({ ...s.success, message_id: randomUUID() }));
    await p.process(record({ ...failure, message_id: randomUUID() }));
    expect(await status(s.result.order_id)).toBe("CONFIRMED");
    const emitted = await events(s.result.order_id, "OrderConfirmed");
    expect(emitted).toHaveLength(1);
    expect(parseMessage(emitted[0].payload)).toMatchObject({
      data: {
        payment_id: s.success.data.payment_id,
        ticket_amount_vnd: 200000,
        merch_amount_vnd: 0,
        total_amount_vnd: 200000,
        items: expect.arrayContaining([
          expect.objectContaining({ order_item_id: expect.any(String), ref_id: s.seat }),
        ]),
      },
    });
    await drain();
    const r = await f.client.connected();
    expect(await r.get(`seat:{evt:${s.event}}:${s.seat}`)).toBe("S");
    expect(await r.pttl(`seat:{evt:${s.event}}:${s.seat}`)).toBe(-1);
    expect(await r.sismember(`sold:{evt:${s.event}}`, s.seat)).toBe(1);
    expect(await r.zscore(`hexp:{evt:${s.event}}`, s.seat)).toBeNull();
    expect(await r.sismember(`hold:{evt:${s.event}}:${s.user}`, s.seat)).toBe(0);
    expect(await r.exists(`checkout:{evt:${s.event}}:${s.seat}`)).toBe(0);
  });

  it("expires with grace, releases GA once, and late success requires refund without resurrecting seats", async () => {
    const s = await order();
    await f.db.pool.query("UPDATE orders SET expires_at=now()-interval '10 seconds' WHERE id=$1", [
      s.result.order_id,
    ]);
    await f.repository.db.transaction((e) => sweepExpiredOrders(e, 30));
    expect(await status(s.result.order_id)).toBe("AWAITING_PAYMENT");
    await f.db.pool.query("UPDATE orders SET expires_at=now()-interval '60 seconds' WHERE id=$1", [
      s.result.order_id,
    ]);
    await f.repository.db.transaction((e) => sweepExpiredOrders(e, 30));
    await f.repository.db.transaction((e) => sweepExpiredOrders(e, 30));
    expect(await status(s.result.order_id)).toBe("EXPIRED");
    expect(await events(s.result.order_id, "OrderExpired")).toHaveLength(1);
    await inbox().process(record(s.success));
    await inbox().process(record({ ...s.success, message_id: randomUUID() }));
    expect(await status(s.result.order_id)).toBe("REFUND_REQUIRED");
    expect(await events(s.result.order_id, "OrderConfirmed")).toHaveLength(0);
    expect((await events(s.result.order_id, "OrderCancelled"))[0].payload.data.reason).toBe(
      "LATE_PAYMENT",
    );
    expect(
      (await f.db.pool.query("SELECT sold FROM ticket_class_stock WHERE class_id=$1", [s.ga]))
        .rows[0].sold,
    ).toBe(0);
    const refund = newMessage("RefundCompleted", {
      refund_id: randomUUID(),
      payment_id: s.success.data.payment_id,
      order_id: s.result.order_id,
      amount_vnd: s.result.total_amount_vnd,
    });
    await inbox().process(record(refund));
    await inbox().process(record({ ...refund, message_id: randomUUID() }));
    expect(await status(s.result.order_id)).toBe("REFUNDED");
  });

  it("persists early success across handler restart until StockReserved, then confirms", async () => {
    const s = await order(true);
    await inbox().process(record(s.success));
    await drain();
    expect(await status(s.result.order_id)).toBe("PENDING");
    const stock = parseMessage(
      newMessage("StockReserved", {
        order_id: s.result.order_id,
        reservations: [{ sku_id: s.sku, quantity: 1 }],
      }),
    );
    await f.repository.db.transaction((e) => stockHandler()(e, stock));
    await drain();
    expect(await status(s.result.order_id)).toBe("CONFIRMED");
    expect(
      (await events(s.result.order_id, "OrderConfirmed"))[0].payload.data.merch_amount_vnd,
    ).toBe(25000);
  });

  it("early success followed by expiry or rejection becomes REFUND_REQUIRED", async () => {
    for (const rejected of [false, true]) {
      const s = await order(true);
      await inbox().process(record(s.success));
      if (rejected) {
        const stock = parseMessage(
          newMessage("StockRejected", {
            order_id: s.result.order_id,
            sku_id: s.sku,
            reason: "no stock",
          }),
        );
        await f.repository.db.transaction((e) => stockHandler()(e, stock));
      } else {
        await f.db.pool.query(
          "UPDATE orders SET expires_at=now()-interval '60 seconds' WHERE id=$1",
          [s.result.order_id],
        );
        await f.repository.db.transaction((e) => sweepExpiredOrders(e, 30));
      }
      await drain();
      expect(await status(s.result.order_id)).toBe("REFUND_REQUIRED");
      expect(
        (await events(s.result.order_id, "OrderCancelled")).some(
          (e) => e.payload.data.reason === "LATE_PAYMENT",
        ),
      ).toBe(true);
    }
  });

  it("outbox failure rolls back status, allocations, work and Inbox; retry succeeds", async () => {
    const s = await order();
    const fail = jest
      .spyOn(OutboxService.prototype, "add")
      .mockRejectedValueOnce(new Error("outbox failed"));
    try {
      await expect(inbox().process(record(s.success))).rejects.toThrow("Unexpected DLQ");
    } finally {
      fail.mockRestore();
    }
    expect(await status(s.result.order_id)).toBe("AWAITING_PAYMENT");
    expect(
      (
        await f.db.pool.query("SELECT state FROM seat_allocations WHERE order_id=$1", [
          s.result.order_id,
        ])
      ).rows[0].state,
    ).toBe("HELD");
    expect(await inbox().process(record(s.success))).toBe("processed");
  });

  it("Redis failure leaves committed SOLD and durable work; restart/retry repairs projection", async () => {
    const s = await order();
    await inbox().process(record(s.success));
    const fail = jest
      .spyOn(f.client, "connected")
      .mockRejectedValueOnce(new Error("Redis unavailable"));
    try {
      await expect(drain()).rejects.toThrow("Redis unavailable");
    } finally {
      fail.mockRestore();
    }
    expect(await status(s.result.order_id)).toBe("CONFIRMED");
    await drain();
    expect(await f.cache.redis.get(`seat:{evt:${s.event}}:${s.seat}`)).toBe("S");
  });

  it("replays Lua after a DB failure following Redis success without publishing SOLD twice", async () => {
    const s = await order();
    await inbox().process(record(s.success));
    const subscriber = f.cache.redis.duplicate();
    const deltas: string[] = [];
    subscriber.on("message", (_channel: string, delta: string) => deltas.push(delta));
    await subscriber.subscribe(`delta:{evt:${s.event}}`);
    const original = f.repository.db.transaction.bind(f.repository.db);
    const failure = jest.spyOn(f.repository.db, "transaction").mockImplementation((fn) =>
      original((exec) =>
        fn({
          query: async <T>(sql: string, params?: unknown[]) => {
            if (sql.startsWith("DELETE FROM order_saga_work"))
              throw new Error("DB failure after Lua");
            return exec.query<T>(sql, params);
          },
        }),
      ),
    );
    try {
      await expect(drain()).rejects.toThrow("DB failure after Lua");
      failure.mockRestore();
      await pollUntil(async () => deltas.includes(`S:${s.seat}`));
      await drain();
      await subscriber.ping();
      expect(deltas.filter((delta) => delta === `S:${s.seat}`)).toHaveLength(1);
      expect(
        (
          await f.db.pool.query("SELECT * FROM order_saga_work WHERE order_id=$1", [
            s.result.order_id,
          ])
        ).rows,
      ).toHaveLength(0);
    } finally {
      failure.mockRestore();
      await subscriber.quit();
    }
  });

  it("delayed cancellation cleanup preserves a newer order using the same user, seat and deadline", async () => {
    const s = await order(true);
    const rejected = parseMessage(
      newMessage("StockRejected", {
        order_id: s.result.order_id,
        sku_id: s.sku,
        reason: "no stock",
      }),
    );
    await f.repository.db.transaction((e) => stockHandler()(e, rejected));
    // Không dọn Redis: checkout mới tái dùng hold/marker cũ, cùng deadline.
    const next = await f.service.checkout(s.user, randomUUID(), s.input, "new-order");
    expect(next.expires_at).toBe(s.result.expires_at);
    await drain();
    expect(await f.cache.redis.get(`seat:{evt:${s.event}}:${s.seat}`)).toBe(`H:${s.user}`);
    await inbox().process(
      record(
        newMessage("PaymentSucceeded", {
          ...s.success.data,
          order_id: next.order_id,
          amount_vnd: next.total_amount_vnd,
        }),
      ),
    );
    await drain();
    expect(await f.cache.redis.get(`seat:{evt:${s.event}}:${s.seat}`)).toBe("S");
  });

  it("Lua validates every key before writing and fences release against a newer marker", async () => {
    const s = await order();
    const r = await f.client.connected();
    const slot = `{evt:${s.event}}`;
    const other = randomUUID();
    const keys = [
      `hold:${slot}:${s.user}`,
      `sold:${slot}`,
      `hexp:${slot}`,
      `delta:${slot}`,
      `seat:${slot}:${s.seat}`,
      `seat:${slot}:${other}`,
    ];
    await r.sadd(keys[5], "wrong-type");
    await expect(
      r.sagaSeats(
        6,
        ...keys,
        "SELL",
        `H:${s.user}`,
        Date.parse(s.result.expires_at),
        s.seat,
        other,
      ),
    ).rejects.toThrow();
    expect(await r.get(keys[4])).toBe(`H:${s.user}`);
    expect(await r.scard(keys[1])).toBe(0);
    await r.set(
      `checkout:${slot}:${s.seat}`,
      `H:${s.user}:${Date.parse(s.result.expires_at) + 1}`,
      "EX",
      60,
    );
    expect(
      await r.sagaSeats(
        5,
        ...keys.slice(0, 5),
        "RELEASE",
        `H:${s.user}`,
        Date.parse(s.result.expires_at),
        s.seat,
      ),
    ).toBe(0);
    expect(await r.get(keys[4])).toBe(`H:${s.user}`);
  });

  it("refunds a confirmed order without repeating a transition; ignores RESALE and rejects amount mismatch", async () => {
    const s = await order();
    const p = inbox();
    await expect(
      p.process(record({ ...s.success, data: { ...s.success.data, amount_vnd: 1 } })),
    ).rejects.toThrow("Unexpected DLQ");
    expect(await status(s.result.order_id)).toBe("AWAITING_PAYMENT");
    await p.process(
      record(
        newMessage("PaymentSucceeded", {
          ...s.success.data,
          purpose: "RESALE",
          order_id: undefined,
          resale_order_id: randomUUID(),
        }),
      ),
    );
    expect(await status(s.result.order_id)).toBe("AWAITING_PAYMENT");
    await p.process(record(s.success));
    await p.process(
      record(
        newMessage("RefundCompleted", {
          refund_id: randomUUID(),
          payment_id: s.success.data.payment_id,
          order_id: s.result.order_id,
          amount_vnd: s.result.total_amount_vnd,
        }),
      ),
    );
    await p.process(record({ ...s.success, message_id: randomUUID() }));
    expect(await status(s.result.order_id)).toBe("REFUNDED");
    expect(await events(s.result.order_id, "OrderConfirmed")).toHaveLength(1);
  });
});
