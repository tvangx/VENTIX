import { randomUUID } from "node:crypto";
import request from "supertest";
import { newMessage } from "@ticketing/event-contracts";
import { confirmedOrder, fixture } from "../support/ticket";

const internalKey = "synthetic_s404_internal_key";

describe("S-404 idempotent internal ticket freezes", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture({ INTERNAL_API_KEY: internalKey });
  });
  afterAll(async () => {
    await context?.close();
  });
  async function setup() {
    const order = confirmedOrder();
    await context.deliver(order);
    const ids = (
      await context.repo.pool.query<{ id: string }>(
        "SELECT id FROM tickets WHERE order_id=$1 ORDER BY CASE WHEN item_type='TICKET_SEAT' THEN 0 ELSE 1 END,id",
        [order.data.order_id],
      )
    ).rows.map((row) => row.id);
    const body = { listing_id: randomUUID(), seller_id: order.data.user_id };
    const call = (
      release = false,
      input: Record<string, unknown> = body,
      id = ids[0],
      key = body.listing_id,
      auth = internalKey,
    ) =>
      request(context.app.getHttpServer())
        .post(`/v1/internal/tickets/${id}/${release ? "unfreeze" : "freeze"}`)
        .set("X-Internal-Key", auth)
        .set("Idempotency-Key", key)
        .send(input);
    return { order, ids, body, call };
  }

  it("requires the service key, matching owner and stable listing reference", async () => {
    const current = await setup();
    await current
      .call(false, current.body, current.ids[0], current.body.listing_id, "")
      .expect(401);
    await current
      .call(false, current.body, current.ids[0], current.body.listing_id, "wrong")
      .expect(401);
    await current.call(false, { ...current.body, seller_id: randomUUID() }).expect(404);
    await current.call(false, current.body, current.ids[0], randomUUID()).expect(400);
    const first = await current.call().expect(200);
    expect(first.body).toMatchObject({
      ticket_id: current.ids[0],
      event_id: current.order.data.event_id,
      seller_id: current.order.data.user_id,
      listing_id: current.body.listing_id,
      freeze_status: "FROZEN",
      ticket_status: "FROZEN",
      original_price_vnd: "100",
    });
    expect((await current.call().expect(200)).body).toEqual(first.body);
    expect((await current.call(false, current.body, current.ids[1]).expect(409)).body.code).toBe(
      "FREEZE_REFERENCE_REUSED",
    );
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM outbox_events WHERE event_type='AuditRecorded' AND message_key=$1",
          [current.ids[0]],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("releases only its own binding and closes it against delayed freeze requests", async () => {
    const current = await setup();
    await current.call().expect(200);
    const other = { ...current.body, listing_id: randomUUID() };
    const unrelated = await current.call(true, other, current.ids[0], other.listing_id).expect(200);
    expect(unrelated.body).toMatchObject({ freeze_status: "RELEASED", ticket_status: "FROZEN" });
    const released = await current.call(true).expect(200);
    expect(released.body).toMatchObject({ freeze_status: "RELEASED", ticket_status: "ACTIVE" });
    expect((await current.call(true).expect(200)).body).toEqual(released.body);
    expect((await current.call().expect(409)).body.code).toBe("FREEZE_RELEASED");
    expect(
      (await current.call(false, other, current.ids[0], other.listing_id).expect(409)).body.code,
    ).toBe("FREEZE_RELEASED");
    const fresh = { ...current.body, listing_id: randomUUID() };
    await current.call(false, fresh, current.ids[0], fresh.listing_id).expect(200);
    await current.call(true).expect(200);
    expect(
      (await context.repo.pool.query("SELECT status FROM tickets WHERE id=$1", [current.ids[0]]))
        .rows[0].status,
    ).toBe("FROZEN");
  });

  it("creates a release tombstone before an in-flight freeze arrives", async () => {
    const current = await setup();
    expect((await current.call(true).expect(200)).body.ticket_status).toBe("ACTIVE");
    expect((await current.call().expect(409)).body.code).toBe("FREEZE_RELEASED");
  });

  it.each(["REVOKED", "REFUNDED", "CHECKED_IN"])(
    "keeps terminal %s state when releasing a hold",
    async (status) => {
      const current = await setup();
      await current.call().expect(200);
      await context.repo.pool.query("UPDATE tickets SET status=$2,version=version+1 WHERE id=$1", [
        current.ids[0],
        status,
      ]);
      expect((await current.call(true).expect(200)).body).toMatchObject({
        freeze_status: "RELEASED",
        ticket_status: status,
      });
      expect(
        (await context.repo.pool.query("SELECT status FROM tickets WHERE id=$1", [current.ids[0]]))
          .rows[0].status,
      ).toBe(status);
    },
  );

  it("blocks known cancelled events and rolls back binding/state if audit fails", async () => {
    const current = await setup();
    await context.deliver(
      newMessage("EventCancelled", {
        event_id: current.order.data.event_id,
        organizer_id: current.order.tenant_id!,
        reason: "Synthetic cancellation",
      }),
    );
    await current.call().expect(409);
    const available = await setup();
    await context.admin.query(
      "ALTER TABLE outbox_events ADD CONSTRAINT synthetic_freeze_failure CHECK (event_type<>'AuditRecorded') NOT VALID",
    );
    try {
      await available.call().expect(500);
    } finally {
      await context.admin.query(
        "ALTER TABLE outbox_events DROP CONSTRAINT synthetic_freeze_failure",
      );
    }
    expect(
      (
        await context.repo.pool.query("SELECT id FROM ticket_freezes WHERE id=$1", [
          available.body.listing_id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (await context.repo.pool.query("SELECT status FROM tickets WHERE id=$1", [available.ids[0]]))
        .rows[0].status,
    ).toBe("ACTIVE");
    await available.call().expect(200);
    await context.deliver(
      newMessage("EventCancelled", {
        event_id: available.order.data.event_id,
        organizer_id: available.order.tenant_id!,
        reason: "Synthetic cancellation after freeze",
      }),
    );
    expect((await available.call().expect(409)).body.code).toBe("EVENT_CANCELLED");
    expect((await available.call(true).expect(200)).body).toMatchObject({
      freeze_status: "RELEASED",
      ticket_status: "FROZEN",
    });
  });
});
