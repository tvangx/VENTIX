import { randomUUID } from "node:crypto";
import { newMessage, parseMessage, Topics } from "@ticketing/event-contracts";
import { confirmedOrder, fixture } from "../support/ticket";
import { startKafka } from "../support/kafka";

async function eventually(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for committed Kafka effect");
}

describe("S-301 real Kafka worker", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  let broker: Awaited<ReturnType<typeof startKafka>>;
  beforeAll(async () => {
    broker = await startKafka();
    const admin = broker.kafka.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        topics: [
          Topics.BOOKING_ORDERS,
          Topics.TICKET_EVENTS,
          Topics.PAYMENT_EVENTS,
          Topics.EVENT_LIFECYCLE,
          `${Topics.EVENT_LIFECYCLE}.dlq`,
          `${Topics.PAYMENT_EVENTS}.dlq`,
          `${Topics.BOOKING_ORDERS}.dlq`,
        ].map((topic) => ({ topic, numPartitions: 1 })),
        waitForLeaders: true,
      });
    } finally {
      await admin.disconnect();
    }
    context = await fixture({
      TICKET_WORKERS_ENABLED: "true",
      KAFKA_BROKERS: broker.brokers.join(","),
    });
  });
  afterAll(async () => {
    await context?.close();
    await broker?.stop();
  });

  it("consumes duplicates, publishes TicketIssued through relay and dead-letters invalid input", async () => {
    const observer = broker.kafka.consumer({ groupId: `ticket-observer-${randomUUID()}` });
    const producer = broker.kafka.producer();
    const issued = new Map<string, ReturnType<typeof parseMessage>>();
    const dead: string[] = [];
    await observer.connect();
    await observer.subscribe({
      topics: [Topics.TICKET_EVENTS, `${Topics.BOOKING_ORDERS}.dlq`],
      fromBeginning: true,
    });
    await observer.run({
      eachMessage: async ({ topic, message }) => {
        if (topic.endsWith(".dlq")) {
          dead.push(message.value?.toString() ?? "");
          return;
        }
        const parsed = parseMessage(JSON.parse(message.value!.toString()));
        expect(message.key?.toString()).toBe(
          parsed.type === "TicketIssued" || parsed.type === "TicketRevoked"
            ? parsed.data.ticket_id
            : "unexpected",
        );
        issued.set(parsed.message_id, parsed);
      },
    });
    await producer.connect();
    const order = confirmedOrder();
    const lifecycle = newMessage("EventUpdated", {
      event_id: order.data.event_id,
      organizer_id: order.tenant_id!,
      event_version: 1,
    });
    const replay = { ...order, message_id: randomUUID() };
    try {
      await producer.send({
        topic: Topics.EVENT_LIFECYCLE,
        acks: -1,
        messages: [{ key: order.data.event_id, value: JSON.stringify(lifecycle) }],
      });
      await eventually(
        async () =>
          (
            await context.repo.pool.query("SELECT id FROM ticket_events WHERE id=$1", [
              order.data.event_id,
            ])
          ).rowCount === 1,
      );
      await producer.send({
        topic: Topics.BOOKING_ORDERS,
        acks: -1,
        messages: [order, order, replay]
          .map((message) => ({ key: order.data.order_id, value: JSON.stringify(message) }))
          .concat([{ key: randomUUID(), value: "{broken" }]),
      });
      await eventually(async () => issued.size === 4 && dead.length === 1);
      await eventually(
        async () =>
          (
            await context.repo.pool.query("SELECT * FROM processed_events WHERE message_id=$1", [
              replay.message_id,
            ])
          ).rowCount === 1,
      );
      await eventually(
        async () =>
          (
            await context.repo.pool.query(
              "SELECT * FROM outbox_events WHERE published_at IS NOT NULL",
            )
          ).rowCount === 4,
      );
      expect(dead).toEqual(["{broken"]);
      expect((await context.repo.pool.query("SELECT * FROM tickets")).rowCount).toBe(4);
      expect([...issued.values()].every((message) => message.type === "TicketIssued")).toBe(true);
      const refund = newMessage("RefundCompleted", {
        refund_id: randomUUID(),
        order_id: order.data.order_id,
        payment_id: order.data.payment_id,
        amount_vnd: order.data.total_amount_vnd,
      });
      await producer.send({
        topic: Topics.PAYMENT_EVENTS,
        acks: -1,
        messages: [{ key: order.data.order_id, value: JSON.stringify(refund) }],
      });
      await eventually(
        async () =>
          (await context.repo.pool.query("SELECT * FROM tickets WHERE status='REFUNDED'"))
            .rowCount === 4,
      );
      await eventually(
        async () =>
          [...issued.values()].filter((message) => message.type === "TicketRevoked").length === 4,
      );
      const cancelledOrder = confirmedOrder();
      await producer.send({
        topic: Topics.BOOKING_ORDERS,
        acks: -1,
        messages: [{ key: cancelledOrder.data.order_id, value: JSON.stringify(cancelledOrder) }],
      });
      await eventually(
        async () =>
          (
            await context.repo.pool.query("SELECT id FROM tickets WHERE order_id=$1", [
              cancelledOrder.data.order_id,
            ])
          ).rowCount === 4,
      );
      const cancel = newMessage("OrderCancelled", {
        order_id: cancelledOrder.data.order_id,
        event_id: cancelledOrder.data.event_id,
        reason: "USER_CANCELLED",
      });
      await producer.send({
        topic: Topics.BOOKING_ORDERS,
        acks: -1,
        messages: [{ key: cancelledOrder.data.order_id, value: JSON.stringify(cancel) }],
      });
      await eventually(
        async () =>
          [...issued.values()].filter(
            (message) =>
              message.type === "TicketRevoked" &&
              message.version === 2 &&
              message.data.reason === "USER_CANCELLED",
          ).length === 4,
      );
    } finally {
      await observer.disconnect();
      await producer.disconnect();
    }
  });
});
