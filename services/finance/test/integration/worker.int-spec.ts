import { randomUUID } from "node:crypto";
import { newMessage, Topics } from "@ticketing/event-contracts";
import { DlqService } from "../../src/modules/dlq/dlq.service";
import { fixture } from "../support/finance";
import { startKafka } from "../support/kafka";

async function eventually(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for committed effect");
}

describe("Finance worker với PostgreSQL + Kafka thật", () => {
  let f: Awaited<ReturnType<typeof fixture>>, broker: Awaited<ReturnType<typeof startKafka>>;
  beforeAll(async () => {
    broker = await startKafka();
    const admin = broker.kafka.admin();
    await admin.connect();
    const topics = [
      Topics.EVENT_LIFECYCLE,
      Topics.BOOKING_ORDERS,
      Topics.PAYMENT_EVENTS,
      Topics.AUDIT_EVENTS,
    ];
    await admin.createTopics({
      topics: topics.flatMap((topic) => [
        { topic, numPartitions: 3 },
        { topic: `${topic}.dlq`, numPartitions: 1 },
      ]),
      waitForLeaders: true,
    });
    await admin.disconnect();
    f = await fixture(false, {
      FINANCE_WORKERS_ENABLED: "true",
      KAFKA_BROKERS: broker.brokers.join(","),
      INTERNAL_API_KEY: "synthetic-internal-key",
      FINANCE_POLL_MS: 100,
    });
  });
  afterAll(async () => {
    await f?.close();
    await broker?.stop();
  });
  it("consume order, cảnh báo refund qua Outbox, collect DLQ và replay cùng message_id", async () => {
    const s = await f.seed();
    const producer = broker.kafka.producer();
    await producer.connect();
    try {
      await producer.send({
        topic: Topics.BOOKING_ORDERS,
        messages: [{ key: s.order.data.order_id, value: JSON.stringify(s.order) }],
      });
      await eventually(
        async () =>
          (
            await f.repo.pool.query("SELECT * FROM finance_orders WHERE id=$1", [
              s.order.data.order_id,
            ])
          ).rowCount === 1,
      );
      await producer.send({
        topic: Topics.PAYMENT_EVENTS,
        messages: [{ key: s.order.data.order_id, value: JSON.stringify(s.refund(219)) }],
      });
      await eventually(
        async () =>
          (
            await f.repo.pool.query(
              "SELECT * FROM audit_logs WHERE action='REFUND_AMOUNT_MISMATCH'",
            )
          ).rowCount === 1,
      );
      await producer.send({
        topic: Topics.AUDIT_EVENTS,
        messages: [{ key: "invalid", value: "{broken" }],
      });
      await eventually(
        async () =>
          (await f.repo.pool.query("SELECT * FROM dead_letters WHERE message_id IS NULL"))
            .rowCount === 1,
      );
      const audit = newMessage("AuditRecorded", {
        actor_id: null,
        action: "KAFKA_REPLAY",
        resource_type: "test",
        resource_id: randomUUID(),
      });
      const raw = JSON.stringify(audit);
      await producer.send({
        topic: `${Topics.AUDIT_EVENTS}.dlq`,
        messages: [
          { key: audit.data.resource_id, value: raw, headers: { "x-error": "Synthetic" } },
        ],
      });
      await eventually(
        async () =>
          (
            await f.repo.pool.query("SELECT * FROM dead_letters WHERE message_id=$1", [
              audit.message_id,
            ])
          ).rowCount === 1,
      );
      const { rows } = await f.repo.pool.query("SELECT id FROM dead_letters WHERE message_id=$1", [
        audit.message_id,
      ]);
      await f.app.get(DlqService).replay(rows[0].id);
      await eventually(
        async () =>
          (
            await f.repo.pool.query("SELECT * FROM audit_logs WHERE message_id=$1", [
              audit.message_id,
            ])
          ).rowCount === 1,
      );
      await producer.send({
        topic: Topics.AUDIT_EVENTS,
        messages: [{ key: audit.data.resource_id, value: raw }],
      });
      expect(await f.audit.verify()).toEqual({ ok: true, checked: 2 });
      expect(
        (
          await f.repo.pool.query("SELECT * FROM audit_logs WHERE message_id=$1", [
            audit.message_id,
          ])
        ).rowCount,
      ).toBe(1);
    } finally {
      await producer.disconnect();
    }
  });
});
