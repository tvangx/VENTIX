import { setTimeout as delay } from "node:timers/promises";
import { createLogger } from "@ticketing/common";
import { Topics } from "@ticketing/event-contracts";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";
import { PaymentRepository } from "../../src/modules/payments/payment.repository";
import { fixture } from "../support/payment";
import { startKafka } from "../support/kafka";

async function until(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for payment flow");
    await delay(25);
  }
}
describe("payment background flow with real Kafka + PostgreSQL", () => {
  it("consumes OrderAwaitingPayment, automatically completes mock and relays one result", async () => {
    const broker = await startKafka();
    const f = await fixture();
    const admin = broker.kafka.admin();
    const producer = broker.kafka.producer();
    const consumer = broker.kafka.consumer({ groupId: "test-payment-results" });
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      await admin.connect();
      await admin.createTopics({
        waitForLeaders: true,
        topics: [Topics.BOOKING_ORDERS, Topics.PAYMENT_EVENTS, `${Topics.BOOKING_ORDERS}.dlq`].map(
          (topic) => ({ topic, numPartitions: 1 }),
        ),
      });
      app = await createApp(
        envSchema.parse({
          ...f.rawEnv,
          KAFKA_BROKERS: broker.brokers.join(","),
          PAYMENT_WORKERS_ENABLED: "true",
        }),
        createLogger("flow-test", { level: "silent" }),
      );
      await app.init();
      const seen: unknown[] = [];
      await consumer.connect();
      await consumer.subscribe({ topic: Topics.PAYMENT_EVENTS, fromBeginning: true });
      await consumer.run({
        eachMessage: async ({ message }) => {
          seen.push(JSON.parse(message.value!.toString()));
        },
      });
      const s = await f.seed();
      // Một order mới đi qua broker; không có sẵn trong read-model.
      const order = "22222222-2222-4222-8222-222222222222";
      const message = {
        ...s.message,
        message_id: "33333333-3333-4333-8333-333333333333",
        data: { ...s.message.data, order_id: order },
      };
      await producer.connect();
      await producer.send({
        topic: Topics.BOOKING_ORDERS,
        messages: [
          { key: order, value: JSON.stringify(message) },
          { key: order, value: JSON.stringify(message) },
        ],
      });
      const db = app.get(PaymentRepository);
      await until(
        async () =>
          (await db.pool.query("SELECT * FROM payables WHERE ref_id=$1", [order])).rows.length ===
          1,
      );
      expect((await f.post(s.user, order, "automatic-mock-flow")).status).toBe(201);
      await until(async () => (await f.row(order))?.status === "SUCCEEDED");
      await until(async () => seen.length === 1);
      expect(seen[0]).toMatchObject({
        type: "PaymentSucceeded",
        data: { order_id: order, purpose: "ORDER", provider: "MOCK", amount_vnd: 100000 },
      });
      await until(
        async () =>
          (
            await db.pool.query(
              "SELECT * FROM outbox_events WHERE message_key=$1 AND published_at IS NOT NULL",
              [order],
            )
          ).rows.length === 1,
      );
      expect(
        (
          await db.pool.query("SELECT * FROM processed_events WHERE message_id=$1", [
            message.message_id,
          ])
        ).rows,
      ).toHaveLength(1);
    } finally {
      await consumer.disconnect();
      await producer.disconnect();
      await admin.disconnect();
      await app?.close();
      await f.close();
      await broker.stop();
    }
  });
});
