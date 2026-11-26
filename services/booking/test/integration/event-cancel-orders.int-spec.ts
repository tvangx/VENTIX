import { randomUUID } from "node:crypto";
import { newMessage } from "@ticketing/event-contracts";
import { InboxProcessor } from "@ticketing/outbox-inbox";
import { checkoutFixture, CheckoutFixture } from "../support/checkout";
import { handleEventLifecycle } from "../../src/messaging/event-lifecycle.handler";
import { drainSagaWork } from "../../src/orders/order-saga";

describe("T-401 EventCancelled releases unfinished orders", () => {
  let f: CheckoutFixture;
  beforeAll(async () => {
    f = await checkoutFixture();
  });
  afterAll(async () => {
    await f?.close();
  });
  it("replays cancellation already stored by the pre-T-401 lifecycle consumer", async () => {
    const s = await f.seed();
    await f.hold(s.user, s.event, [s.seat]);
    const order = await f.service.checkout(s.user, randomUUID(), s.input, "upgrade-cancel-test");
    const [{ organizer_id: owner }] = (
      await f.db.pool.query<{ organizer_id: string }>(
        "UPDATE event_snapshots SET status='CANCELLED',event_version=3,pricing_ready=false WHERE event_id=$1 RETURNING organizer_id",
        [s.event],
      )
    ).rows;
    const inbox = new InboxProcessor({
      db: f.repository.db,
      consumerName: "booking-event-cancel-orders-t401",
      handler: handleEventLifecycle,
      maxAttempts: 1,
      deadLetter: async (letter) => {
        throw new Error(letter.error);
      },
    });
    const message = newMessage(
      "EventCancelled",
      { event_id: s.event, organizer_id: owner, event_version: 3, reason: "old cancellation" },
      { version: 2 },
    );
    await inbox.process({
      topic: "event.lifecycle",
      partition: 0,
      offset: "0",
      key: null,
      value: Buffer.from(JSON.stringify(message)),
    });
    expect(
      (await f.db.pool.query("SELECT status FROM orders WHERE id=$1", [order.order_id])).rows[0]
        .status,
    ).toBe("CANCELLED");
    await drainSagaWork(f.repository.db, f.client);
    expect(await (await f.client.connected()).get(`seat:{evt:${s.event}}:${s.seat}`)).toBeNull();
  });
  it.each([false, true])(
    "cancels AWAITING_PAYMENT/PENDING (merch=%s) once and releases seats, GA and durable Redis work",
    async (merch) => {
      const s = await f.seed();
      await f.hold(s.user, s.event, [s.seat]);
      const order = await f.service.checkout(
        s.user,
        randomUUID(),
        {
          ...s.input,
          ga_items: [{ ticket_class_id: s.ga, quantity: 2 }],
          merch_items: merch ? [{ sku_id: randomUUID(), quantity: 1 }] : [],
        },
        "cancel-test",
      );
      const [{ organizer_id: owner }] = (
        await f.db.pool.query<{ organizer_id: string }>(
          "SELECT organizer_id FROM event_snapshots WHERE event_id=$1",
          [s.event],
        )
      ).rows;
      const message = newMessage(
        "EventCancelled",
        { event_id: s.event, organizer_id: owner, event_version: 3, reason: "test" },
        { version: 2, tenant_id: owner },
      );
      const inbox = new InboxProcessor({
        db: f.repository.db,
        consumerName: "cancel-orders-test",
        handler: handleEventLifecycle,
        maxAttempts: 1,
        deadLetter: async (letter) => {
          throw new Error(letter.error);
        },
      });
      const record = (value: unknown) => ({
        topic: "event.lifecycle",
        partition: 0,
        offset: "0",
        key: null,
        value: Buffer.from(JSON.stringify(value)),
      });
      expect(await inbox.process(record(message))).toBe("processed");
      expect(await inbox.process(record(message))).toBe("duplicate");
      await inbox.process(record({ ...message, message_id: randomUUID() }));
      expect(
        (await f.db.pool.query("SELECT status FROM orders WHERE id=$1", [order.order_id])).rows[0]
          .status,
      ).toBe("CANCELLED");
      expect(
        (
          await f.db.pool.query("SELECT state FROM seat_allocations WHERE order_id=$1", [
            order.order_id,
          ])
        ).rows[0].state,
      ).toBe("RELEASED");
      expect(
        (await f.db.pool.query("SELECT sold FROM ticket_class_stock WHERE class_id=$1", [s.ga]))
          .rows[0].sold,
      ).toBe(0);
      const events = await f.db.pool.query(
        "SELECT payload FROM outbox_events WHERE message_key=$1 AND event_type='OrderCancelled'",
        [order.order_id],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0].payload.data.reason).toBe("EVENT_CANCELLED");
      await drainSagaWork(f.repository.db, f.client);
      expect(await (await f.client.connected()).get(`seat:{evt:${s.event}}:${s.seat}`)).toBeNull();
      expect(
        (
          await f.db.pool.query("SELECT count(*)::int n FROM order_saga_work WHERE order_id=$1", [
            order.order_id,
          ])
        ).rows[0].n,
      ).toBe(0);
    },
  );
});
