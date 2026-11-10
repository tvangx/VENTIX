import { randomUUID } from "node:crypto";
import { newMessage, parseMessage } from "@ticketing/event-contracts";
import { InboxProcessor, fromPgClient } from "@ticketing/outbox-inbox";
import { drainSagaWork } from "../../src/orders/order-saga";
import { stockHandler } from "../../src/messaging/stock.handler";
import { transition } from "../../src/orders/order-state";
import { CheckoutFixture, checkoutFixture } from "../support/checkout";

describe("checkout HTTP + PostgreSQL + Redis", () => {
  let f: CheckoutFixture;
  beforeAll(async () => {
    f = await checkoutFixture();
  });
  afterAll(async () => {
    await f?.close();
  });
  it("requires Idempotency-Key, validates input, rejects voucher and client prices", async () => {
    const s = await f.seed();
    expect((await f.post(s.user, s.input)).status).toBe(400);
    expect(
      (await f.post(s.user, { ...s.input, voucher_code: "SALE" }, randomUUID())).body.code,
    ).toBe("VOUCHER_NOT_SUPPORTED");
    expect(
      (await f.post(s.user, { ...s.input, price_vnd: 1 } as typeof s.input, randomUUID())).status,
    ).toBe(400);
    expect(
      (
        await f.post(
          s.user,
          { ...s.input, ga_items: [{ ticket_class_id: s.ga, quantity: 0 }] },
          randomUUID(),
        )
      ).status,
    ).toBe(400);
    expect(
      (await f.post(s.user, { ...s.input, seat_ids: [s.seat, s.seat] }, randomUUID())).status,
    ).toBe(400);
    expect((await f.post(s.user, { ...s.input, seat_ids: [] }, randomUUID())).status).toBe(400);
  });
  it("creates ticket-only order, replays original response and isolates key ownership/hash", async () => {
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    const key = randomUUID();
    const a = await f.post(s.user, s.input, key);
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      status: "AWAITING_PAYMENT",
      ticket_amount_vnd: 100000,
      merch_amount_vnd: 0,
      total_amount_vnd: 100000,
    });
    expect((await f.post(s.user, s.input, key)).body).toEqual(a.body);
    expect((await f.post(randomUUID(), s.input, key)).body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(
      (
        await f.post(
          s.user,
          { ...s.input, ga_items: [{ ticket_class_id: s.ga, quantity: 1 }] },
          key,
        )
      ).body.code,
    ).toBe("IDEMPOTENCY_KEY_REUSED");
    const events = await f.db.pool.query(
      "SELECT event_type FROM outbox_events WHERE message_key=$1 ORDER BY event_type",
      [a.body.order_id],
    );
    expect(events.rows.map((r) => r.event_type)).toEqual(["OrderAwaitingPayment", "OrderCreated"]);
    expect(f.calls()).toBe(0);
  });
  it("20 parallel HTTP checkouts with one key create one order and one pair of events", async () => {
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => f.post(s.user, s.input, key)),
    );
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
    expect(new Set(results.map((r) => r.body.order_id)).size).toBe(1);
    expect(
      (
        await f.db.pool.query("SELECT count(*)::int AS n FROM orders WHERE idempotency_key=$1", [
          key,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await f.db.pool.query("SELECT count(*)::int AS n FROM outbox_events WHERE message_key=$1", [
          results[0].body.order_id,
        ])
      ).rows[0].n,
    ).toBe(2);
  });
  it("checks sale status/readiness and hold ownership", async () => {
    const s = await f.seed();
    expect((await f.post(s.user, s.input, randomUUID())).body.code).toBe("HOLD_NOT_FOUND");
    await f.db.pool.query("UPDATE event_snapshots SET pricing_ready=false WHERE event_id=$1", [
      s.event,
    ]);
    const notReady = await f.post(s.user, s.input, randomUUID());
    expect(notReady.status).toBe(503);
    expect(notReady.headers["retry-after"]).toBe("1");
    await f.db.pool.query("UPDATE event_snapshots SET status='CANCELLED' WHERE event_id=$1", [
      s.event,
    ]);
    expect((await f.post(s.user, s.input, randomUUID())).status).toBe(409);
  });
  it("fails closed with admission enabled without calling merch", async () => {
    const s = await f.seed(100, true);
    expect(f.env.ADMISSION_REQUIRED).toBe(true);
    const before = f.calls();
    const result = await f.post(s.user, s.input, randomUUID());
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("ADMISSION_REQUIRED");
    expect(f.calls()).toBe(before);
  });
  it("does not partially extend a multi-seat hold when a seat is missing", async () => {
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    const redis = await f.client.connected();
    const key = `seat:{evt:${s.event}}:${s.seat}`;
    const before = await redis.pttl(key);
    const missing = randomUUID();
    expect(
      await redis.checkoutHold(
        3,
        `hold:{evt:${s.event}}:${s.user}`,
        key,
        `seat:{evt:${s.event}}:${missing}`,
        `H:${s.user}`,
        Date.now() + 900000,
        s.seat,
        missing,
      ),
    ).toBe(0);
    expect(await redis.pttl(key)).toBeLessThanOrEqual(before);
    expect(await redis.exists(`checkout:{evt:${s.event}}:${s.seat}`)).toBe(0);
  });
  it("Lua rejects invalid metadata before writing", async () => {
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    const redis = await f.client.connected();
    await redis.set(`hexp:{evt:${s.event}}`, "invalid");
    await expect(
      redis.checkoutHold(
        2,
        `hold:{evt:${s.event}}:${s.user}`,
        `seat:{evt:${s.event}}:${s.seat}`,
        `H:${s.user}`,
        Date.now() + 900000,
        s.seat,
      ),
    ).rejects.toThrow();
    expect(await redis.exists(`checkout:{evt:${s.event}}:${s.seat}`)).toBe(0);
  });
  it("rolls back business, stock and existing outbox inserts on transaction failure", async () => {
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    // Inject failure after OrderCreated was inserted, at the second outbox insert.
    const original = f.repository.db.transaction.bind(f.repository.db);
    const spy = jest.spyOn(f.repository.db, "transaction").mockImplementation((fn) =>
      original(async (exec) =>
        fn({
          query: async <T>(sql: string, params?: unknown[]) => {
            if (sql.includes("INSERT INTO outbox_events") && params?.[3] === "OrderAwaitingPayment")
              throw new Error("Synthetic failure after first outbox insert");
            return exec.query<T>(sql, params);
          },
        }),
      ),
    );
    const response = await f.post(s.user, s.input, randomUUID());
    spy.mockRestore();
    expect(response.status).toBe(500);
    expect(
      (await f.db.pool.query("SELECT count(*)::int AS n FROM orders WHERE event_id=$1", [s.event]))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int AS n FROM outbox_events WHERE payload->'data'->>'event_id'=$1",
          [s.event],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await f.db.pool.query("SELECT sold FROM ticket_class_stock WHERE class_id=$1", [s.seated]))
        .rows[0].sold,
    ).toBe(0);
  });
  it("extends held seats only once even when checkout retries after rollback", async () => {
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    const redis = await f.client.connected();
    const args = [
      2,
      `hold:{evt:${s.event}}:${s.user}`,
      `seat:{evt:${s.event}}:${s.seat}`,
      `H:${s.user}`,
      Date.now() + 900000,
      s.seat,
    ] as const;
    const first = await redis.checkoutHold(...args);
    const second = await redis.checkoutHold(
      2,
      args[1],
      args[2],
      args[3],
      Date.now() + 950000,
      s.seat,
    );
    expect(second).toBe(first);
    expect(await redis.pttl(args[2])).toBeGreaterThan(890000);
  });
  it("merch order prices come from quote; StockReserved advances once through Inbox", async () => {
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    const sku = randomUUID();
    const result = await f.post(
      s.user,
      {
        ...s.input,
        ga_items: [{ ticket_class_id: s.ga, quantity: 2 }],
        merch_items: [{ sku_id: sku, quantity: 3 }],
      },
      randomUUID(),
    );
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      status: "PENDING",
      ticket_amount_vnd: 200000,
      merch_amount_vnd: 75000,
      total_amount_vnd: 275000,
    });
    const processor = new InboxProcessor({
      consumerName: "test-stock",
      db: f.repository.db,
      handler: stockHandler(),
      deadLetter: async () => {
        throw new Error("Unexpected DLQ");
      },
    });
    const msg = newMessage("StockReserved", {
      order_id: result.body.order_id,
      reservations: [{ sku_id: sku, quantity: 3 }],
    });
    const record = {
      topic: "merch.stock",
      partition: 0,
      offset: "0",
      key: null,
      value: Buffer.from(JSON.stringify(msg)),
    };
    expect(await processor.process(record)).toBe("processed");
    expect(await processor.process(record)).toBe("duplicate");
    const row = (
      await f.db.pool.query("SELECT status,version FROM orders WHERE id=$1", [result.body.order_id])
    ).rows[0];
    expect(row).toEqual({ status: "AWAITING_PAYMENT", version: 1 });
    expect(
      (
        await f.db.pool.query("SELECT item_type FROM order_items WHERE order_id=$1", [
          result.body.order_id,
        ])
      ).rows.every((i) => i.item_type !== "COMBO"),
    ).toBe(true);
  });
  it("StockRejected cancels once and releases seats, GA and class stock", async () => {
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    const sku = randomUUID();
    const result = await f.post(
      s.user,
      {
        ...s.input,
        ga_items: [{ ticket_class_id: s.ga, quantity: 2 }],
        merch_items: [{ sku_id: sku, quantity: 1 }],
      },
      randomUUID(),
    );
    const msg = parseMessage(
      newMessage("StockRejected", {
        order_id: result.body.order_id,
        sku_id: sku,
        reason: "out of stock",
      }),
    );
    const handler = stockHandler();
    await f.repository.db.transaction((exec) => handler(exec, msg));
    await f.repository.db.transaction((exec) => handler(exec, msg));
    expect(
      (await f.db.pool.query("SELECT status FROM orders WHERE id=$1", [result.body.order_id]))
        .rows[0].status,
    ).toBe("CANCELLED");
    await drainSagaWork(f.repository.db, f.client);
    expect(await f.cache.redis.get(`seat:{evt:${s.event}}:${s.seat}`)).toBeNull();
    expect(
      (
        await f.db.pool.query(
          "SELECT sold FROM ticket_class_stock WHERE class_id=ANY($1::uuid[])",
          [[s.ga, s.seated]],
        )
      ).rows.map((r) => r.sold),
    ).toEqual([0, 0]);
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int n FROM outbox_events WHERE message_key=$1 AND event_type='OrderCancelled'",
          [result.body.order_id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("invalid state order and concurrent same-version transitions are rejected", async () => {
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    const result = await f.post(s.user, s.input, randomUUID());
    await expect(
      transition(fromPgClient(f.db.pool), result.body.order_id, "AWAITING_PAYMENT", "REFUNDED", 1),
    ).rejects.toThrow();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        transition(
          fromPgClient(f.db.pool),
          result.body.order_id,
          "AWAITING_PAYMENT",
          "CANCELLED",
          1,
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("merch timeout/open breaker never affects ticket-only checkout", async () => {
    f.mode("timeout");
    for (let i = 0; i < 8; i++) {
      const s = await f.seed();
      const result = await f.post(
        s.user,
        { ...s.input, seat_ids: [], merch_items: [{ sku_id: randomUUID(), quantity: 1 }] },
        randomUUID(),
      );
      expect(result.status).toBe(503);
      expect(result.body.code).toBe("MERCH_UNAVAILABLE");
    }
    const before = f.calls();
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    expect((await f.post(s.user, s.input, randomUUID())).status).toBe(201);
    expect(f.calls()).toBe(before);
    const another = await f.seed();
    expect(
      (
        await f.post(
          another.user,
          { ...another.input, seat_ids: [], merch_items: [{ sku_id: randomUUID(), quantity: 1 }] },
          randomUUID(),
        )
      ).status,
    ).toBe(503);
    expect(f.calls()).toBe(before);
    f.mode("ok");
  });
});
