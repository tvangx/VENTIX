import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createLogger } from "@ticketing/common";
import { newMessage } from "@ticketing/event-contracts";
import { envSchema } from "../../src/config/env.schema";
import { EventLifecycleService } from "../../src/messaging/event-lifecycle.service";
import { BookingDb, startBookingDb } from "../support/booking-db";
import { BookingKafka, startBookingKafka } from "../support/booking-kafka";
import { pollUntil } from "../support/booking-redis";
import { lifecycleData, lifecycleMessage } from "../support/lifecycle";

describe("production event lifecycle consumer (real Kafka + PostgreSQL)", () => {
  let db: BookingDb;
  let broker: BookingKafka;
  let consumer: EventLifecycleService;
  beforeAll(async () => {
    db = await startBookingDb();
    broker = await startBookingKafka();
    consumer = new EventLifecycleService(
      envSchema.parse({
        DATABASE_URL: db.pool.options.connectionString,
        KAFKA_BROKERS: broker.brokers.join(","),
        AUTH_ISSUER: "test",
        AUTH_AUDIENCE: "test",
        AUTH_JWKS_URI: "http://localhost/jwks",
      }),
      createLogger("test", { level: "silent" }),
    );
    await consumer.start();
  });
  afterAll(async () => {
    await consumer?.stop();
    await consumer?.onApplicationShutdown();
    await broker?.close();
    await db?.close();
  });
  it("new then old then duplicate: highest snapshot wins, one Inbox row and one stock effect per message", async () => {
    const data = lifecycleData();
    const newer = lifecycleMessage(
      {
        ...data,
        event_version: 10,
        seat_map_version: 3,
        ticket_classes: [{ ...data.ticket_classes[0], capacity: 30 }],
      },
      "EventUpdated",
    );
    const old = lifecycleMessage(data);
    const cancelled = newMessage(
      "EventCancelled",
      {
        event_id: data.event_id,
        organizer_id: data.organizer_id,
        event_version: 11,
        reason: "Synthetic cancellation",
      },
      { version: 2 },
    );
    const producer = broker.kafka.producer();
    await producer.connect();
    try {
      await producer.send({
        topic: "event.lifecycle",
        acks: -1,
        messages: [newer, old, newer].map((message) => ({
          key: data.event_id,
          value: JSON.stringify(message),
        })),
      });
      await pollUntil(
        async () =>
          (
            await db.pool.query("SELECT * FROM processed_events WHERE message_id=ANY($1::uuid[])", [
              [newer.message_id, old.message_id],
            ])
          ).rowCount === 2,
        20000,
      );
      expect(
        (
          await db.pool.query(
            "SELECT event_version,seat_map_version FROM event_snapshots WHERE event_id=$1",
            [data.event_id],
          )
        ).rows[0],
      ).toEqual({ event_version: 10, seat_map_version: 3 });
      expect(
        (
          await db.pool.query("SELECT total,version FROM ticket_class_stock WHERE class_id=$1", [
            data.ticket_classes[0].id,
          ])
        ).rows[0],
      ).toEqual({ total: 30, version: 0 });
      await producer.send({
        topic: "event.lifecycle",
        messages: [
          { key: data.event_id, value: JSON.stringify(cancelled) },
          {
            key: data.event_id,
            value: JSON.stringify(lifecycleMessage({ ...data, event_version: 9 })),
          },
        ],
      });
      await pollUntil(
        async () =>
          (
            await db.pool.query("SELECT status FROM event_snapshots WHERE event_id=$1", [
              data.event_id,
            ])
          ).rows[0]?.status === "CANCELLED",
        10000,
      );
      expect(
        (
          await db.pool.query("SELECT event_version FROM event_snapshots WHERE event_id=$1", [
            data.event_id,
          ])
        ).rows[0].event_version,
      ).toBe(11);
    } finally {
      await producer.disconnect();
    }
  });
  it("routes unsupported v1 to DLQ without committing an Inbox row", async () => {
    const legacy = newMessage("EventCancelled", {
      event_id: randomUUID(),
      organizer_id: randomUUID(),
      reason: "Synthetic legacy",
    });
    const dlqConsumer = broker.kafka.consumer({ groupId: `dlq-test-${randomUUID()}` });
    let received = false;
    await dlqConsumer.connect();
    await dlqConsumer.subscribe({ topic: "event.lifecycle.dlq", fromBeginning: true });
    await dlqConsumer.run({
      eachMessage: async ({ message }) => {
        if (message.value?.toString() === JSON.stringify(legacy)) received = true;
      },
    });
    const producer = broker.kafka.producer();
    await producer.connect();
    try {
      await producer.send({
        topic: "event.lifecycle",
        messages: [{ key: legacy.data.event_id, value: JSON.stringify(legacy) }],
      });
      await pollUntil(async () => received, 20000);
      expect(
        (
          await db.pool.query("SELECT * FROM processed_events WHERE message_id=$1", [
            legacy.message_id,
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      await producer.disconnect();
      await dlqConsumer.disconnect();
    }
  });
});
