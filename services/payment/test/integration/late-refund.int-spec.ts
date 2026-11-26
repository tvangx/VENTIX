import { randomUUID } from "node:crypto";
import { InboxProcessor } from "@ticketing/outbox-inbox";
import { fixture, Fixture } from "../support/payment";
import { refundInbox } from "../support/refunds";
import { RefundWorker } from "../../src/modules/refunds/refund-worker";
import { checkoutFixture, CheckoutFixture } from "../../../booking/test/support/checkout";
import { sweepExpiredOrders, drainSagaWork } from "../../../booking/src/orders/order-saga";
import { paymentHandler } from "../../../booking/src/messaging/payment.handler";

describe("T-401 late payment to actual refund to REFUNDED across separate databases", () => {
  let pay: Fixture, bk: CheckoutFixture;
  beforeAll(async () => {
    pay = await fixture({ REFUND_RATE_PER_SEC: 1000000 });
    bk = await checkoutFixture();
  });
  afterAll(async () => {
    await bk?.close();
    await pay?.close();
  });
  it("consumes real Outbox payloads through Inbox on each side and never resurrects the seat", async () => {
    const s = await bk.seed();
    await bk.hold(s.user, s.event, [s.seat]);
    const order = await bk.service.checkout(s.user, randomUUID(), s.input, "late-refund-test");
    const [payable] = (
      await bk.db.pool.query<{ payload: unknown }>(
        "SELECT payload FROM outbox_events WHERE message_key=$1 AND event_type='OrderAwaitingPayment'",
        [order.order_id],
      )
    ).rows;
    expect(await pay.inbox.process(pay.record(payable.payload))).toBe("processed");
    await pay.service.create(
      s.user,
      randomUUID(),
      order.order_id,
      "MOCK",
      "127.0.0.1",
      "late-refund-test",
    );
    const [{ expires_at: expired }] = (
      await bk.db.pool.query<{ expires_at: Date }>(
        "UPDATE orders SET expires_at=now()-interval '60 seconds' WHERE id=$1 RETURNING expires_at",
        [order.order_id],
      )
    ).rows;
    // Dịch deadline của fixture phải dịch cả fence Redis; không thay quy tắc chống nhả hold mới.
    await (
      await bk.client.connected()
    ).call(
      "SET",
      `checkout:{evt:${s.event}}:${s.seat}`,
      `H:${s.user}:${expired.getTime()}`,
      "XX",
      "KEEPTTL",
    );
    await bk.repository.db.transaction((exec) => sweepExpiredOrders(exec, 0));
    await drainSagaWork(bk.repository.db, bk.client);
    await pay.worker.tick();
    const [success] = (
      await pay.repo.pool.query<{ payload: unknown }>(
        "SELECT payload FROM outbox_events WHERE message_key=$1 AND event_type='PaymentSucceeded'",
        [order.order_id],
      )
    ).rows;
    const inbox = new InboxProcessor({
      db: bk.repository.db,
      consumerName: "late-refund-test",
      handler: paymentHandler,
      maxAttempts: 1,
      deadLetter: async (letter) => {
        throw new Error(letter.error);
      },
    });
    expect(await inbox.process(pay.record(success.payload, "payment.events"))).toBe("processed");
    expect(
      (await bk.db.pool.query("SELECT status FROM orders WHERE id=$1", [order.order_id])).rows[0]
        .status,
    ).toBe("REFUND_REQUIRED");
    const [cancel] = (
      await bk.db.pool.query<{ payload: unknown }>(
        "SELECT payload FROM outbox_events WHERE message_key=$1 AND event_type='OrderCancelled'",
        [order.order_id],
      )
    ).rows;
    await refundInbox(pay).process(pay.record(cancel.payload));
    await pay.app.get(RefundWorker).tick();
    const [completed] = (
      await pay.repo.pool.query<{ payload: unknown }>(
        "SELECT payload FROM outbox_events WHERE message_key=$1 AND event_type='RefundCompleted'",
        [order.order_id],
      )
    ).rows;
    expect(completed).toBeDefined();
    await inbox.process(pay.record(completed.payload, "payment.events"));
    expect(await inbox.process(pay.record(completed.payload, "payment.events"))).toBe("duplicate");
    expect(
      (await bk.db.pool.query("SELECT status FROM orders WHERE id=$1", [order.order_id])).rows[0]
        .status,
    ).toBe("REFUNDED");
    expect(
      (
        await bk.db.pool.query(
          "SELECT count(*)::int n FROM outbox_events WHERE message_key=$1 AND event_type='OrderConfirmed'",
          [order.order_id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(await (await bk.client.connected()).get(`seat:{evt:${s.event}}:${s.seat}`)).toBeNull();
  });
});
