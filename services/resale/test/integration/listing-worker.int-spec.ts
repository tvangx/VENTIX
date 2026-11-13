import { randomUUID } from "node:crypto";
import { newMessage, parseMessage, Topics } from "@ticketing/event-contracts";
import { startKafka } from "../../../ticket/test/support/kafka";
import { listingStack } from "../support/listing-stack";

async function eventually(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for listing worker effect");
}

describe("S-404 real Kafka Inbox/Outbox and recovery worker", () => {
  let context: Awaited<ReturnType<typeof listingStack>>;
  let broker: Awaited<ReturnType<typeof startKafka>>;
  beforeAll(async () => {
    broker = await startKafka();
    const admin = broker.kafka.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        topics: [
          Topics.TICKET_EVENTS,
          `${Topics.TICKET_EVENTS}.dlq`,
          Topics.RESALE_EVENTS,
          Topics.AUDIT_EVENTS,
        ].map((topic) => ({ topic, numPartitions: 1 })),
        waitForLeaders: true,
      });
    } finally {
      await admin.disconnect();
    }
    context = await listingStack({
      RESALE_WORKERS_ENABLED: "true",
      KAFKA_BROKERS: broker.brokers.join(","),
      RESALE_RECOVERY_ENABLED: "true",
      RESALE_RECOVERY_POLL_MS: 100,
    });
  });
  afterAll(async () => {
    await context?.close();
    await broker?.stop();
  });

  it("relays listing events, deduplicates revocations and dead-letters malformed input", async () => {
    const observer = broker.kafka.consumer({ groupId: `resale-observer-${randomUUID()}` });
    const producer = broker.kafka.producer();
    const seen = new Map<string, ReturnType<typeof parseMessage>>();
    const dead: string[] = [];
    const keys: string[] = [];
    await observer.connect();
    await producer.connect();
    try {
      await observer.subscribe({
        topics: [Topics.RESALE_EVENTS, `${Topics.TICKET_EVENTS}.dlq`],
        fromBeginning: true,
      });
      await observer.run({
        eachMessage: async ({ topic, message }) => {
          if (topic.endsWith(".dlq")) {
            dead.push(message.value!.toString());
            return;
          }
          const parsed = parseMessage(JSON.parse(message.value!.toString()));
          seen.set(parsed.message_id, parsed);
          keys.push(message.key!.toString());
        },
      });
      const current = await context.setup();
      const created = await current.create().expect(201);
      await eventually(async () =>
        [...seen.values()].some(
          (message) =>
            message.type === "ListingCreated" && message.data.listing_id === created.body.id,
        ),
      );
      const revoked = newMessage(
        "TicketRevoked",
        { ticket_id: current.id, reason: "ADMIN" },
        { tenant_id: current.order.tenant_id },
      );
      await producer.send({
        topic: Topics.TICKET_EVENTS,
        acks: -1,
        messages: [revoked, revoked, { ...revoked, message_id: randomUUID() }]
          .map((message) => ({ key: current.id, value: JSON.stringify(message) }))
          .concat([{ key: randomUUID(), value: "{broken" }]),
      });
      await eventually(
        async () =>
          [...seen.values()].some(
            (message) =>
              message.type === "ListingCancelled" && message.data.listing_id === created.body.id,
          ) && dead.length === 1,
      );
      expect(
        [...seen.values()].filter((message) => message.type === "ListingCancelled"),
      ).toHaveLength(1);
      expect(keys.every((key) => key === created.body.id)).toBe(true);
      expect(dead).toEqual(["{broken"]);
      expect(
        (
          await context.resale.repo.pool.query(
            "SELECT id FROM resale_ticket_invalidations WHERE id=$1",
            [current.id],
          )
        ).rowCount,
      ).toBe(1);
      await eventually(
        async () =>
          (
            await context.resale.repo.pool.query(
              "SELECT id FROM outbox_events WHERE message_key=$1 AND published_at IS NOT NULL",
              [created.body.id],
            )
          ).rowCount === 2,
      );
    } finally {
      await observer.disconnect();
      await producer.disconnect();
    }
  });

  it("automatically recovers an uncertain freeze after the upstream recovers", async () => {
    const current = await context.setup();
    const key = randomUUID();
    context.upstream.mode = "drop-freeze";
    try {
      await current.create(120, key).expect(503);
    } finally {
      context.upstream.mode = "ok";
    }
    await context.resale.repo.pool.query(
      "UPDATE listing_operations SET next_attempt_at=clock_timestamp() WHERE request_key=$1",
      [key],
    );
    await eventually(
      async () =>
        (
          await context.resale.repo.pool.query(
            "SELECT state FROM listing_operations WHERE request_key=$1",
            [key],
          )
        ).rows[0].state === "COMPLETED",
    );
    const created = await current.create(120, key).expect(201);
    expect(created.body.status).toBe("ACTIVE");
    expect(await current.status()).toBe("FROZEN");
    const metrics = await context.resale.app
      .get((await import("../../src/metrics/metrics")).MetricsService)
      .registry.metrics();
    expect(metrics).toContain('resale_recovery_attempts_total{outcome="completed"}');
  });
});
