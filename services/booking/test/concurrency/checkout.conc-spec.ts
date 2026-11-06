import { randomUUID } from "node:crypto";
import { CheckoutFixture, checkoutFixture } from "../support/checkout";
import { transition } from "../../src/orders/order-state";
import { fromPgClient } from "@ticketing/outbox-inbox";

describe("checkout deterministic contention", () => {
  let f: CheckoutFixture;
  beforeAll(async () => {
    f = await checkoutFixture();
  });
  afterAll(async () => {
    await f?.close();
  });
  it.each([20, 50])(
    "%i parallel HTTP requests with one key create exactly one order",
    async (count) => {
      const s = await f.seed();
      await f.hold(s.user, s.event, [s.seat]);
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: count }, () => f.post(s.user, s.input, key)),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.order_id)).size).toBe(1);
      expect(
        (await f.db.pool.query("SELECT count(*)::int n FROM orders WHERE event_id=$1", [s.event]))
          .rows[0].n,
      ).toBe(1);
    },
  );
  it("two users validating the same seat across Redis loss: one DB winner, loser hold released", async () => {
    const s = await f.seed();
    const other = randomUUID();
    await f.hold(s.user, s.event, [s.seat]);
    const redis = await f.client.connected();
    const original = redis.checkoutHold.bind(redis);
    let first!: () => void;
    let second!: () => void;
    const verified = new Promise<void>((resolve) => {
      first = resolve;
    });
    const both = new Promise<void>((resolve) => {
      second = resolve;
    });
    const spy = jest.spyOn(redis, "checkoutHold").mockImplementation(async (n, ...args) => {
      const expiry = await original(n, ...args);
      if (args[n] === `H:${s.user}`) {
        first();
        await both;
      } else second();
      return expiry;
    });
    const a = f.post(s.user, s.input, randomUUID());
    // supertest request starts on awaiting .then; f.post's async return assimilates it.
    await verified;
    await redis.del(`seat:{evt:${s.event}}:${s.seat}`);
    await f.hold(other, s.event, [s.seat]);
    const b = f.post(other, s.input, randomUUID());
    const results = await Promise.all([a, b]);
    spy.mockRestore();
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results[0].status === 409 ? s.user : other;
    expect(results.find((r) => r.status === 409)?.body.code).toBe("SEAT_UNAVAILABLE");
    expect(await redis.get(`seat:{evt:${s.event}}:${s.seat}`)).not.toBe(`H:${loser}`);
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int n FROM seat_allocations WHERE event_id=$1 AND state='HELD'",
          [s.event],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("50 users compete for final GA ticket without oversell", async () => {
    const s = await f.seed(1);
    const input = { ...s.input, seat_ids: [], ga_items: [{ ticket_class_id: s.ga, quantity: 1 }] };
    const results = await Promise.all(
      Array.from({ length: 50 }, () => f.post(randomUUID(), input, randomUUID())),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 409 && r.body.code === "TICKET_UNAVAILABLE"),
    ).toHaveLength(49);
    expect(
      (await f.db.pool.query("SELECT sold,total FROM ticket_class_stock WHERE class_id=$1", [s.ga]))
        .rows[0],
    ).toEqual({ sold: 1, total: 1 });
  });
  it("50 competing same-version transitions have one winner", async () => {
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    const result = await f.post(s.user, s.input, randomUUID());
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
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
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(49);
  });
});
