import { randomUUID } from "node:crypto";
import { newMessage } from "@ticketing/event-contracts";
import request from "supertest";
import { confirmedOrder, fixture } from "../support/ticket";

describe("S-303 revocation", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture();
  });
  afterAll(async () => {
    await context?.close();
  });
  const cancellation = (order: ReturnType<typeof confirmedOrder>) =>
    newMessage("OrderCancelled", {
      order_id: order.data.order_id,
      event_id: order.data.event_id,
      reason: "EVENT_CANCELLED",
    });
  const refund = (order: ReturnType<typeof confirmedOrder>) =>
    newMessage("RefundCompleted", {
      refund_id: randomUUID(),
      order_id: order.data.order_id,
      payment_id: order.data.payment_id,
      amount_vnd: order.data.total_amount_vnd,
    });

  it("revokes every ticket and secret atomically, rejects token and deduplicates cancellation", async () => {
    const order = confirmedOrder();
    await context.deliver(order);
    const cancel = cancellation(order);
    expect(await context.deliver(cancel)).toBe("processed");
    expect(await context.deliver(cancel)).toBe("duplicate");
    expect(await context.deliver({ ...cancel, message_id: randomUUID() })).toBe("processed");
    const rows = await context.repo.pool.query("SELECT * FROM tickets WHERE order_id=$1", [
      order.data.order_id,
    ]);
    expect(rows.rows.every((ticket) => ticket.status === "REVOKED" && ticket.version === 2)).toBe(
      true,
    );
    expect(
      (
        await context.repo.pool.query(
          "SELECT * FROM ticket_secrets WHERE ticket_id=ANY($1::uuid[]) AND revoked_at IS NULL",
          [rows.rows.map((ticket) => ticket.id)],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await context.repo.pool.query(
          "SELECT * FROM outbox_events WHERE event_type='TicketRevoked' AND message_key=ANY($1::text[])",
          [rows.rows.map((ticket) => ticket.id)],
        )
      ).rowCount,
    ).toBe(4);
    const token = await context.token(order.data.user_id);
    await request(context.app.getHttpServer())
      .get(`/v1/tickets/${rows.rows[0].id}/token`)
      .auth(token, { type: "bearer" })
      .expect(409);
  });

  it("refund wins over later cancellation and replay cannot reactivate tickets", async () => {
    const order = confirmedOrder();
    await context.deliver(order);
    const message = refund(order);
    await context.deliver(message);
    await context.deliver({ ...message, message_id: randomUUID() });
    await context.deliver(cancellation(order));
    await context.deliver({ ...order, message_id: randomUUID() });
    const tickets = await context.repo.pool.query(
      "SELECT status,version FROM tickets WHERE order_id=$1",
      [order.data.order_id],
    );
    expect(tickets.rows).toHaveLength(4);
    expect(
      tickets.rows.every((ticket) => ticket.status === "REFUNDED" && ticket.version === 2),
    ).toBe(true);
  });

  it("remembers early refund/cancel and never issues tickets for late confirmation", async () => {
    for (const invalidate of [refund, cancellation]) {
      const order = confirmedOrder();
      await context.deliver(invalidate(order));
      expect(await context.deliver(order)).toBe("processed");
      expect(
        (
          await context.repo.pool.query("SELECT * FROM tickets WHERE order_id=$1", [
            order.data.order_id,
          ])
        ).rowCount,
      ).toBe(0);
    }
  });

  it("rejects cancellation event mismatch and rolls back invalidation if Outbox fails", async () => {
    const order = confirmedOrder();
    await context.deliver(order);
    const cancel = cancellation(order);
    expect(
      await context.deliver({ ...cancel, data: { ...cancel.data, event_id: randomUUID() } }),
    ).toBe("dead-lettered");
    await context.admin.query(
      "ALTER TABLE outbox_events ADD CONSTRAINT synthetic_revoke_failure CHECK (event_type <> 'TicketRevoked') NOT VALID",
    );
    try {
      expect(await context.deliver(cancel)).toBe("dead-lettered");
    } finally {
      await context.admin.query(
        "ALTER TABLE outbox_events DROP CONSTRAINT synthetic_revoke_failure",
      );
    }
    expect(
      (
        await context.repo.pool.query(
          "SELECT * FROM ticket_order_invalidations WHERE order_id=$1",
          [order.data.order_id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await context.repo.pool.query(
          "SELECT * FROM tickets WHERE order_id=$1 AND status='ACTIVE'",
          [order.data.order_id],
        )
      ).rowCount,
    ).toBe(4);
    expect(await context.deliver(cancel)).toBe("processed");
  });

  it.each(["USER_CANCELLED", "EXPIRED", "LATE_PAYMENT", "STOCK_REJECTED", "PAYMENT_FAILED"])(
    "emits v2 with original cancellation reason %s and deduplicates replay",
    async (reason) => {
      const order = confirmedOrder();
      await context.deliver(order);
      const cancel = cancellation(order);
      const message = { ...cancel, data: { ...cancel.data, reason } };
      expect(await context.deliver(message)).toBe("processed");
      expect(await context.deliver({ ...message, message_id: randomUUID() })).toBe("processed");
      expect(
        (
          await context.repo.pool.query(
            "SELECT * FROM tickets WHERE order_id=$1 AND status='REVOKED'",
            [order.data.order_id],
          )
        ).rowCount,
      ).toBe(4);
      const events = await context.repo.pool.query(
        "SELECT payload FROM outbox_events WHERE event_type='TicketRevoked' AND message_key IN (SELECT id::text FROM tickets WHERE order_id=$1)",
        [order.data.order_id],
      );
      expect(events.rowCount).toBe(4);
      for (const event of events.rows) {
        expect(event.payload.version).toBe(2);
        expect(event.payload.data.reason).toBe(reason);
      }
    },
  );
});
