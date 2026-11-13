import { Topics } from "@ticketing/event-contracts";
import { fixture } from "../support/finance";
import { startKafka } from "../support/kafka";

it("paid Kafka order becomes mock invoice and audit via Outbox; worker shuts down", async () => {
  const broker = await startKafka();
  let f: Awaited<ReturnType<typeof fixture>> | undefined;
  const admin = broker.kafka.admin();
  const producer = broker.kafka.producer();
  try {
    await admin.connect();
    await admin.createTopics({
      topics: [
        Topics.EVENT_LIFECYCLE,
        Topics.BOOKING_ORDERS,
        Topics.PAYMENT_EVENTS,
        Topics.AUDIT_EVENTS,
      ].flatMap((topic) => [
        { topic, numPartitions: 1 },
        { topic: `${topic}.dlq`, numPartitions: 1 },
      ]),
      waitForLeaders: true,
    });
    f = await fixture(false, {
      FINANCE_WORKERS_ENABLED: "true",
      INVOICE_WORKER_ENABLED: "true",
      KAFKA_BROKERS: broker.brokers.join(","),
      INTERNAL_API_KEY: "synthetic-internal-key",
      FINANCE_POLL_MS: 100,
      INVOICE_POLL_MS: 100,
    });
    const s = await f.seed();
    await producer.connect();
    await producer.send({
      topic: Topics.BOOKING_ORDERS,
      messages: [{ key: s.order.data.order_id, value: JSON.stringify(s.order) }],
    });
    const deadline = Date.now() + 30000;
    let count = 0;
    while (Date.now() < deadline) {
      count =
        (
          await f.repo.pool.query(
            "SELECT id FROM audit_logs WHERE action='MOCK_INVOICE_ISSUED' AND resource_id=$1",
            [s.order.data.order_id],
          )
        ).rowCount ?? 0;
      if (count === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(count).toBe(1);
    expect(
      (
        await f.repo.pool.query("SELECT status,invoice_no FROM invoices WHERE id=$1", [
          s.order.data.order_id,
        ])
      ).rows[0],
    ).toEqual({ status: "ISSUED", invoice_no: `MOCK-${s.order.data.order_id}` });
    expect(await f.audit.verify()).toEqual({ ok: true, checked: 1 });
  } finally {
    await producer.disconnect();
    await admin.disconnect();
    await f?.close();
    await broker.stop();
  }
});
