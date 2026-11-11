import { randomUUID } from "node:crypto";
import { confirmedOrder, fixture } from "../support/ticket";

describe("S-301 concurrent issuance", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture();
  });
  afterAll(async () => {
    await context?.close();
  });

  it("50 duplicate deliveries produce exactly one set of tickets and outbox messages", async () => {
    const order = confirmedOrder();
    const outcomes = await Promise.all(Array.from({ length: 50 }, () => context.deliver(order)));
    expect(outcomes.filter((outcome) => outcome === "processed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "duplicate")).toHaveLength(49);
    const replays = await Promise.all(
      Array.from({ length: 50 }, () => context.deliver({ ...order, message_id: randomUUID() })),
    );
    expect(replays.every((outcome) => outcome === "processed")).toBe(true);
    expect(
      (
        await context.repo.pool.query("SELECT * FROM tickets WHERE order_id=$1", [
          order.data.order_id,
        ])
      ).rowCount,
    ).toBe(4);
    expect(
      (
        await context.repo.pool.query(
          "SELECT * FROM outbox_events WHERE payload->'data'->>'order_id'=$1",
          [order.data.order_id],
        )
      ).rowCount,
    ).toBe(4);
    expect(context.dead).toHaveLength(0);
  });

  it("50 orders competing for the same seat cannot issue two active tickets", async () => {
    const first = confirmedOrder();
    const orders = Array.from({ length: 50 }, () => {
      const order = confirmedOrder();
      order.data.event_id = first.data.event_id;
      order.data.items[0].ref_id = first.data.items[0].ref_id;
      return order;
    });
    const outcomes = await Promise.all(orders.map(context.deliver));
    expect(outcomes.filter((outcome) => outcome === "processed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "dead-lettered")).toHaveLength(49);
    expect(
      (
        await context.repo.pool.query("SELECT * FROM tickets WHERE event_id=$1", [
          first.data.event_id,
        ])
      ).rowCount,
    ).toBe(4);
  });
});
