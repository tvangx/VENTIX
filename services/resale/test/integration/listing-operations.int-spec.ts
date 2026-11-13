import { randomUUID } from "node:crypto";
import request from "supertest";
import { newMessage } from "@ticketing/event-contracts";
import { ResaleWorker } from "../../src/messaging/resale-worker";
import { listingStack } from "../support/listing-stack";

describe("S-404 real Ticket/Resale listing operations", () => {
  let context: Awaited<ReturnType<typeof listingStack>>;
  beforeAll(async () => {
    context = await listingStack();
  });
  afterAll(async () => {
    await context?.close();
  });
  const count = async (type: string, id: string) =>
    (
      await context.resale.repo.pool.query(
        "SELECT id FROM outbox_events WHERE event_type=$1 AND message_key=$2",
        [type, id],
      )
    ).rowCount;
  async function recover() {
    await context.resale.repo.pool.query(
      "UPDATE listing_operations SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE state IN ('PENDING','FROZEN','RELEASING')",
    );
    await context.resale.app.get(ResaleWorker).recoverOnce();
  }

  it("creates from the server price, replays and cancels exactly once", async () => {
    const current = await context.setup();
    const key = randomUUID();
    const created = await current.create(120, key).expect(201);
    expect(created.body).toMatchObject({
      ticket_id: current.id,
      original_price_vnd: "100",
      ask_price_vnd: "120",
      max_percent: 120,
      status: "ACTIVE",
    });
    expect(await current.status()).toBe("FROZEN");
    expect((await current.create(120, key).expect(201)).body).toEqual(created.body);
    await current.create(119, key).expect(409);
    await current.create().expect(409);
    expect(await count("ListingCreated", created.body.id)).toBe(1);
    const cancelKey = randomUUID();
    const cancelled = await current.cancel(created.body.id, cancelKey).expect(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    expect(await current.status()).toBe("ACTIVE");
    expect((await current.cancel(created.body.id, cancelKey).expect(200)).body).toEqual(
      cancelled.body,
    );
    expect(await count("ListingCancelled", created.body.id)).toBe(1);
    // The original create receipt stays stable after later state changes.
    expect((await current.create(120, key).expect(201)).body).toEqual(created.body);
    await current.create().expect(201);
  });

  it("validates ownership, JWT, input and request keys before listing", async () => {
    const current = await context.setup();
    await request(context.resale.app.getHttpServer())
      .post("/v1/listings")
      .send({ ticket_id: current.id, ask_price_vnd: 100 })
      .expect(401);
    await request(context.resale.app.getHttpServer())
      .post("/v1/listings")
      .auth(current.token, { type: "bearer" })
      .send({ ticket_id: current.id, ask_price_vnd: 100 })
      .expect(400);
    await current.create(100, randomUUID(), { original_price_vnd: 999999 }).expect(400);
    await current.create(-1).expect(400);
    await current.create(1.5).expect(400);
    const stranger = await context.ticket.token(randomUUID());
    await request(context.resale.app.getHttpServer())
      .post("/v1/listings")
      .auth(stranger, { type: "bearer" })
      .set("Idempotency-Key", randomUUID())
      .send({ ticket_id: current.id, ask_price_vnd: 100 })
      .expect(404);
    expect(await current.status()).toBe("ACTIVE");
    const created = await current.create().expect(201);
    await request(context.resale.app.getHttpServer())
      .post(`/v1/listings/${created.body.id}/cancel`)
      .auth(stranger, { type: "bearer" })
      .set("Idempotency-Key", randomUUID())
      .expect(404);
  });

  it("compensates an over-cap freeze and honors the stricter event rule", async () => {
    const current = await context.setup();
    const key = randomUUID();
    await current.create(121, key).expect(422);
    expect(await current.status()).toBe("ACTIVE");
    await current.create(121, key).expect(422);
    expect(
      (
        await context.resale.repo.pool.query(
          "SELECT state FROM listing_operations WHERE request_key=$1",
          [key],
        )
      ).rows[0].state,
    ).toBe("FAILED");
    await context.resale.repo.pool.query(
      "INSERT INTO price_cap_rules (event_id,max_percent) VALUES ($1,110)",
      [current.order.data.event_id],
    );
    await current.create(111).expect(422);
    expect(await current.status()).toBe("ACTIVE");
    expect((await current.create(110).expect(201)).body.max_percent).toBe(110);
  });

  it("recovers a lost freeze response using a durable intent and stable binding", async () => {
    const current = await context.setup();
    const key = randomUUID();
    context.upstream.mode = "drop-freeze";
    try {
      await current.create(120, key).expect(503);
    } finally {
      context.upstream.mode = "ok";
    }
    expect(await current.status()).toBe("FROZEN");
    expect(
      (
        await context.resale.repo.pool.query(
          "SELECT state FROM listing_operations WHERE request_key=$1",
          [key],
        )
      ).rows[0].state,
    ).toBe("PENDING");
    await recover();
    const result = await current.create(120, key).expect(201);
    expect(await count("ListingCreated", result.body.id)).toBe(1);
    expect(
      (
        await context.ticket.repo.pool.query(
          "SELECT id FROM ticket_freezes WHERE ticket_id=$1 AND status='FROZEN'",
          [current.id],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("rolls back a failed listing/outbox commit and resumes from FROZEN", async () => {
    const current = await context.setup();
    const key = randomUUID();
    await context.resale.admin.query(
      "ALTER TABLE outbox_events ADD CONSTRAINT synthetic_listing_failure CHECK (event_type<>'ListingCreated') NOT VALID",
    );
    try {
      await current.create(120, key).expect(503);
    } finally {
      await context.resale.admin.query(
        "ALTER TABLE outbox_events DROP CONSTRAINT synthetic_listing_failure",
      );
    }
    expect(await current.status()).toBe("FROZEN");
    expect(
      (
        await context.resale.repo.pool.query("SELECT id FROM listings WHERE ticket_id=$1", [
          current.id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await context.resale.repo.pool.query(
          "SELECT state FROM listing_operations WHERE request_key=$1",
          [key],
        )
      ).rows[0].state,
    ).toBe("FROZEN");
    await recover();
    const created = await current.create(120, key).expect(201);
    expect(await count("ListingCreated", created.body.id)).toBe(1);
  });

  it("closes a listing before release and recovers a lost unfreeze response", async () => {
    const current = await context.setup();
    const created = await current.create().expect(201);
    const key = randomUUID();
    context.upstream.mode = "drop-unfreeze";
    try {
      await current.cancel(created.body.id, key).expect(503);
    } finally {
      context.upstream.mode = "ok";
    }
    expect(await current.status()).toBe("ACTIVE");
    expect(
      (
        await context.resale.repo.pool.query("SELECT status FROM listings WHERE id=$1", [
          created.body.id,
        ])
      ).rows[0].status,
    ).toBe("CANCELLED");
    await current.create().expect(409);
    await recover();
    await current.cancel(created.body.id, key).expect(200);
    expect(await count("ListingCancelled", created.body.id)).toBe(1);
    await current.create().expect(201);
  });

  it("keeps the ticket frozen when the local cancellation transaction fails", async () => {
    const current = await context.setup();
    const created = await current.create().expect(201);
    await context.resale.admin.query(
      "ALTER TABLE outbox_events ADD CONSTRAINT synthetic_cancel_failure CHECK (event_type<>'ListingCancelled') NOT VALID",
    );
    try {
      await current.cancel(created.body.id).expect(500);
    } finally {
      await context.resale.admin.query(
        "ALTER TABLE outbox_events DROP CONSTRAINT synthetic_cancel_failure",
      );
    }
    expect(await current.status()).toBe("FROZEN");
    expect(
      (
        await context.resale.repo.pool.query("SELECT status FROM listings WHERE id=$1", [
          created.body.id,
        ])
      ).rows[0].status,
    ).toBe("ACTIVE");
    await current.cancel(created.body.id).expect(200);
  });

  it("revalidates a frozen intent against a terminal ticket before activation", async () => {
    const current = await context.setup();
    const key = randomUUID();
    context.upstream.mode = "drop-freeze";
    try {
      await current.create(120, key).expect(503);
    } finally {
      context.upstream.mode = "ok";
    }
    await context.ticket.repo.pool.query(
      "UPDATE tickets SET status='REVOKED',version=version+1 WHERE id=$1",
      [current.id],
    );
    await recover();
    await current.create(120, key).expect(409);
    expect(await current.status()).toBe("REVOKED");
    expect(
      (
        await context.resale.repo.pool.query("SELECT id FROM listings WHERE ticket_id=$1", [
          current.id,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("stores Inbox tombstones before create and cancels active listings once", async () => {
    const current = await context.setup();
    const message = newMessage(
      "TicketRevoked",
      { ticket_id: current.id, reason: "ADMIN" },
      { tenant_id: current.order.tenant_id },
    );
    await context.deliver(message);
    await context.deliver(message);
    await current.create().expect(409);
    const active = await context.setup();
    const created = await active.create().expect(201);
    const revoked = newMessage(
      "TicketRevoked",
      { ticket_id: active.id, reason: "REFUNDED" },
      { tenant_id: active.order.tenant_id },
    );
    await context.deliver(revoked);
    await context.deliver(revoked);
    await context.deliver(
      newMessage("TicketRevoked", revoked.data, { tenant_id: active.order.tenant_id }),
    );
    expect(await count("ListingCancelled", created.body.id)).toBe(1);
    expect(
      (
        await context.resale.repo.pool.query("SELECT status FROM listings WHERE id=$1", [
          created.body.id,
        ])
      ).rows[0].status,
    ).toBe("CANCELLED");
    const foreign = await context.setup();
    await foreign.create().expect(201);
    await context.deliver(
      newMessage(
        "TicketRevoked",
        { ticket_id: foreign.id, reason: "ADMIN" },
        { tenant_id: randomUUID() },
      ),
    );
    expect(context.dead).toHaveLength(1);
    expect(
      (
        await context.resale.repo.pool.query("SELECT status FROM listings WHERE ticket_id=$1", [
          foreign.id,
        ])
      ).rows[0].status,
    ).toBe("ACTIVE");
  });

  it("ignores transfer invalidation and searches ACTIVE listings with price/cursor filters", async () => {
    const current = await context.setup();
    await context.deliver(
      newMessage("TicketRevoked", { ticket_id: current.id, reason: "TRANSFERRED" }),
    );
    const created = await current.create(110).expect(201);
    const query = (suffix: string) =>
      request(context.resale.app.getHttpServer())
        .get(`/v1/listings?event_id=${current.order.data.event_id}${suffix}`)
        .auth(current.token, { type: "bearer" });
    const page = await query("&min_price_vnd=110&max_price_vnd=110&limit=1").expect(200);
    expect(page.body.items).toEqual([created.body]);
    expect((await query("&min_price_vnd=111").expect(200)).body.items).toHaveLength(0);
    expect((await query(`&cursor=${created.body.id}`).expect(200)).body.items).toHaveLength(0);
    await query("&min_price_vnd=111&max_price_vnd=110").expect(400);
    await current.cancel(created.body.id).expect(200);
    expect((await query("").expect(200)).body.items).toHaveLength(0);
  });
});
