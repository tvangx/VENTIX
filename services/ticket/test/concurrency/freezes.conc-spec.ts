import { randomUUID } from "node:crypto";
import request from "supertest";
import { confirmedOrder, fixture } from "../support/ticket";

describe("S-404 freeze concurrency", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  const key = "synthetic_s404_internal_key";
  beforeAll(async () => {
    context = await fixture({ INTERNAL_API_KEY: key });
  });
  afterAll(async () => {
    await context?.close();
  });

  it("allows one of 50 listing references to freeze a ticket", async () => {
    const order = confirmedOrder();
    await context.deliver(order);
    const id = (
      await context.repo.pool.query(
        "SELECT id FROM tickets WHERE order_id=$1 ORDER BY id LIMIT 1",
        [order.data.order_id],
      )
    ).rows[0].id as string;
    const results = await Promise.all(
      Array.from({ length: 50 }, () => {
        const listing_id = randomUUID();
        return request(context.app.getHttpServer())
          .post(`/v1/internal/tickets/${id}/freeze`)
          .set("X-Internal-Key", key)
          .set("Idempotency-Key", listing_id)
          .send({ listing_id, seller_id: order.data.user_id });
      }),
    );
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(49);
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM ticket_freezes WHERE ticket_id=$1 AND status='FROZEN'",
          [id],
        )
      ).rowCount,
    ).toBe(1);
  });
});
