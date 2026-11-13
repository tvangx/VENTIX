import { randomUUID } from "node:crypto";
import { listingStack } from "../support/listing-stack";

describe("S-404 concurrent listing operations across two services", () => {
  let context: Awaited<ReturnType<typeof listingStack>>;
  beforeAll(async () => {
    context = await listingStack();
  });
  afterAll(async () => {
    await context?.close();
  });

  it("replays 50 concurrent create requests into one listing and one event", async () => {
    const current = await context.setup();
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 50 }, () => current.create(120, key)));
    expect(responses.map((response) => response.status)).toEqual(Array(50).fill(201));
    expect(new Set(responses.map((response) => response.body.id)).size).toBe(1);
    const id = responses[0].body.id;
    expect(
      (
        await context.resale.repo.pool.query("SELECT id FROM listings WHERE ticket_id=$1", [
          current.id,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await context.resale.repo.pool.query(
          "SELECT id FROM outbox_events WHERE event_type='ListingCreated' AND message_key=$1",
          [id],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await context.ticket.repo.pool.query(
          "SELECT id FROM ticket_freezes WHERE ticket_id=$1 AND status='FROZEN'",
          [current.id],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("accepts one of 50 distinct create keys for the same ticket", async () => {
    const current = await context.setup();
    const responses = await Promise.all(Array.from({ length: 50 }, () => current.create()));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(49);
    expect(await current.status()).toBe("FROZEN");
  });

  it("replays 50 cancellation requests without duplicate releases or events", async () => {
    const current = await context.setup();
    const created = await current.create().expect(201);
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 50 }, () => current.cancel(created.body.id, key)),
    );
    expect(responses.map((response) => response.status)).toEqual(Array(50).fill(200));
    expect(responses.every((response) => response.body.status === "CANCELLED")).toBe(true);
    expect(await current.status()).toBe("ACTIVE");
    expect(
      (
        await context.resale.repo.pool.query(
          "SELECT id FROM outbox_events WHERE event_type='ListingCancelled' AND message_key=$1",
          [created.body.id],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await context.ticket.repo.pool.query(
          "SELECT id FROM ticket_freezes WHERE ticket_id=$1 AND status='RELEASED'",
          [current.id],
        )
      ).rowCount,
    ).toBe(1);
  });
});
