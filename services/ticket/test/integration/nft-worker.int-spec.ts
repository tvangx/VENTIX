import { randomUUID } from "node:crypto";
import { Topics } from "@ticketing/event-contracts";
import { fixture, confirmedOrder } from "../support/ticket";
import { startKafka } from "../support/kafka";

async function eventually(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for durable NFT mint");
}

describe("S-502 Kafka issuance to mock mint", () => {
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
          `${Topics.TICKET_EVENTS}.dlq`,
          `${Topics.BOOKING_ORDERS}.dlq`,
        ].map((topic) => ({ topic, numPartitions: 1 })),
        waitForLeaders: true,
      });
    } finally {
      await admin.disconnect();
    }
    context = await fixture({
      TICKET_WORKERS_ENABLED: "true",
      NFT_WORKER_ENABLED: "true",
      NFT_POLL_MS: 20,
      KAFKA_BROKERS: broker.brokers.join(","),
    });
  });
  afterAll(async () => {
    await context?.close();
    await broker?.stop();
  });

  it("mints each issued ticket once and dead-letters invalid NFT input", async () => {
    const producer = broker.kafka.producer();
    const observer = broker.kafka.consumer({ groupId: `nft-observer-${randomUUID()}` });
    let dead = 0;
    await observer.connect();
    await observer.subscribe({ topic: `${Topics.TICKET_EVENTS}.dlq`, fromBeginning: true });
    await observer.run({
      eachMessage: async () => {
        dead++;
      },
    });
    await producer.connect();
    const order = confirmedOrder();
    try {
      await producer.send({
        topic: Topics.BOOKING_ORDERS,
        messages: [order, order].map((message) => ({
          key: order.data.order_id,
          value: JSON.stringify(message),
        })),
      });
      await producer.send({
        topic: Topics.TICKET_EVENTS,
        messages: [{ key: randomUUID(), value: "{broken" }],
      });
      await eventually(
        async () =>
          (await context.repo.pool.query("SELECT id FROM nft_mints WHERE status='MINTED'"))
            .rowCount === 4 && dead === 1,
      );
      const issued = await context.repo.pool.query(
        "SELECT payload FROM outbox_events WHERE event_type='TicketIssued'",
      );
      await producer.send({
        topic: Topics.TICKET_EVENTS,
        messages: issued.rows.map((row) => ({
          key: row.payload.data.ticket_id,
          value: JSON.stringify({ ...row.payload, message_id: randomUUID() }),
        })),
      });
      await eventually(
        async () =>
          (
            await context.repo.pool.query(
              "SELECT * FROM processed_events WHERE consumer='ticket-nft-v1'",
            )
          ).rowCount === 8,
      );
      expect(
        (await context.repo.pool.query("SELECT attempts,provider,tx_hash FROM nft_mints")).rows,
      ).toEqual(
        Array.from({ length: 4 }, () => ({ attempts: 1, provider: "MOCK", tx_hash: null })),
      );
      expect(
        (await context.repo.pool.query("SELECT id FROM tickets WHERE status='ACTIVE'")).rowCount,
      ).toBe(4);
      expect((await context.repo.pool.query("SELECT * FROM ticket_secrets")).rowCount).toBe(4);
    } finally {
      await producer.disconnect();
      await observer.disconnect();
    }
  });
});
