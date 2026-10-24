import { Topics } from "@ticketing/event-contracts";
import type { Kafka } from "kafkajs";
import { OutboxRelay, OutboxService, pgDatabase } from "../../src";
import { createTopics, startKafka, startPostgres } from "../helpers/containers";
import type { TestKafka, TestPostgres } from "../helpers/containers";
import { orderMessage, readTopicToEnd, waitFor } from "../helpers/kafka-utils";

const TOPIC = Topics.BOOKING_ORDERS;
const TOTAL = 300;

let pg: TestPostgres;
let tk: TestKafka;
let kafka: Kafka;

beforeAll(async () => {
  [pg, tk] = await Promise.all([startPostgres(), startKafka()]);
  kafka = tk.kafka;
  await createTopics(kafka, [{ topic: TOPIC, numPartitions: 6 }]);
});

afterAll(async () => {
  await Promise.allSettled([pg?.stop(), tk?.stop()]);
});

describe("3. Hai relay chạy song song", () => {
  it(`${TOTAL} dòng outbox, 3 relay + batchSize nhỏ ⇒ mỗi dòng đúng 1 bản trên Kafka (SKIP LOCKED)`, async () => {
    const db = pgDatabase(pg.pool);
    const outbox = new OutboxService();
    const messages = Array.from({ length: TOTAL }, () => orderMessage());
    // 50 transaction ghi song song (≥ 50 tác vụ) để created_at xen kẽ như thật.
    for (let i = 0; i < TOTAL; i += 50) {
      await Promise.all(
        messages
          .slice(i, i + 50)
          .map((m) => db.transaction((exec) => outbox.add(exec, m, m.data.order_id))),
      );
    }
    const ids = messages.map((m) => m.message_id);

    const relays = Array.from(
      { length: 3 },
      () => new OutboxRelay({ db, kafka, pollIntervalMs: 5, batchSize: 10 }),
    );
    await Promise.all(relays.map((r) => r.start()));
    await waitFor("all rows published", async () =>
      Number(
        (
          await pg.pool.query(
            `SELECT count(*) AS n FROM outbox_events WHERE id = ANY($1::uuid[]) AND published_at IS NOT NULL`,
            [ids],
          )
        ).rows[0].n,
      ) === TOTAL
        ? true
        : undefined,
    );
    await Promise.all(relays.map((r) => r.stop()));

    const published = (
      await Promise.all(
        relays.map(async (r) => (await r.metrics.published.get()).values[0]?.value ?? 0),
      )
    ).reduce((a, b) => a + b, 0);
    const onKafka = (await readTopicToEnd(kafka, TOPIC)).map((r) => r.headers["message-id"]);

    expect(onKafka).toHaveLength(TOTAL); // không thừa
    expect(new Set(onKafka).size).toBe(TOTAL); // không trùng
    expect(new Set(onKafka)).toEqual(new Set(ids)); // không thiếu
    expect(published).toBe(TOTAL); // tổng metric của các relay khớp
  });
});
