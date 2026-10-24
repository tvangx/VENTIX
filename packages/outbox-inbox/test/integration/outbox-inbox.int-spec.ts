import { randomUUID } from "node:crypto";
import { Topics } from "@ticketing/event-contracts";
import type { Kafka } from "kafkajs";
import {
  createInboxConsumer,
  OutboxRelay,
  OutboxService,
  PermanentError,
  pgDatabase,
} from "../../src";
import type { InboxConsumer, InboxHandler } from "../../src";
import { createTopics, startKafka, startPostgres } from "../helpers/containers";
import type { TestKafka, TestPostgres } from "../helpers/containers";
import {
  orderMessage,
  readTopicToEnd,
  waitFor,
  waitForGroupCaughtUp,
} from "../helpers/kafka-utils";

const TOPIC = Topics.BOOKING_ORDERS;
const DLQ = `${TOPIC}.dlq`;

let pg: TestPostgres;
let tk: TestKafka;
let kafka: Kafka;
const outbox = new OutboxService();
const running: Array<{ stop(): Promise<void> }> = [];

const db = () => pgDatabase(pg.pool);
const count = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number((await pg.pool.query(sql, params)).rows[0].n);

/** Kafka giả bọc bản thật: sau khi broker ĐÃ nhận batch, ném lỗi (mô phỏng relay chết trước COMMIT). */
function crashAfterPublish(real: Kafka, state: { crash: boolean }): Pick<Kafka, "producer"> {
  return {
    producer: (config) => {
      const producer = real.producer(config);
      const sendBatch = producer.sendBatch.bind(producer);
      producer.sendBatch = async (batch) => {
        const result = await sendBatch(batch);
        if (state.crash) throw new Error("relay crashed after publish");
        return result;
      };
      return producer;
    },
  };
}

async function errorCount(relay: OutboxRelay): Promise<number> {
  return (await relay.metrics.errors.get()).values[0]?.value ?? 0;
}

function startConsumer(
  groupId: string,
  consumerName: string,
  handler: InboxHandler,
  extra = {},
): InboxConsumer {
  const consumer = createInboxConsumer({
    kafka,
    groupId,
    consumerName,
    topics: [TOPIC],
    db: db(),
    handler,
    baseBackoffMs: 10,
    maxBackoffMs: 50,
    ...extra,
  });
  running.push(consumer);
  return consumer;
}

beforeAll(async () => {
  [pg, tk] = await Promise.all([startPostgres(), startKafka()]);
  kafka = tk.kafka;
  await createTopics(kafka, [
    { topic: TOPIC, numPartitions: 6 },
    { topic: DLQ, numPartitions: 1 },
  ]);
});

afterEach(async () => {
  while (running.length > 0) await running.pop()?.stop();
});

afterAll(async () => {
  await Promise.allSettled([pg?.stop(), tk?.stop()]);
});

describe("1. Ghi nghiệp vụ + outbox cùng transaction", () => {
  it("rollback ⇒ không có đơn và không có sự kiện; commit ⇒ có cả hai và relay gửi đúng 1 lần", async () => {
    const rolledBack = orderMessage();
    await expect(
      db().transaction(async (exec) => {
        await exec.query(
          `INSERT INTO orders_test (id, status) VALUES ($1::uuid, 'NEW') RETURNING id`,
          [rolledBack.data.order_id],
        );
        await outbox.add(exec, rolledBack, rolledBack.data.order_id);
        throw new Error("nghiệp vụ lỗi sau khi đã ghi outbox");
      }),
    ).rejects.toThrow("nghiệp vụ lỗi");

    expect(
      await count(`SELECT count(*) AS n FROM orders_test WHERE id = $1::uuid`, [
        rolledBack.data.order_id,
      ]),
    ).toBe(0);
    expect(
      await count(`SELECT count(*) AS n FROM outbox_events WHERE id = $1::uuid`, [
        rolledBack.message_id,
      ]),
    ).toBe(0);

    const committed = orderMessage();
    await db().transaction(async (exec) => {
      await exec.query(
        `INSERT INTO orders_test (id, status) VALUES ($1::uuid, 'NEW') RETURNING id`,
        [committed.data.order_id],
      );
      await outbox.add(exec, committed, committed.data.order_id);
    });
    expect(
      await count(`SELECT count(*) AS n FROM outbox_events WHERE id = $1::uuid`, [
        committed.message_id,
      ]),
    ).toBe(1);

    const relay = new OutboxRelay({ db: db(), kafka, pollIntervalMs: 20 });
    running.push(relay);
    await relay.start();
    await waitFor("committed row published", async () =>
      (await count(
        `SELECT count(*) AS n FROM outbox_events WHERE id = $1::uuid AND published_at IS NOT NULL`,
        [committed.message_id],
      )) === 1
        ? true
        : undefined,
    );
    await relay.stop();

    const records = await readTopicToEnd(kafka, TOPIC);
    const ids = records.map((r) => r.headers["message-id"]);
    expect(ids.filter((id) => id === committed.message_id)).toHaveLength(1);
    expect(ids).not.toContain(rolledBack.message_id);
    const sent = records.find((r) => r.headers["message-id"] === committed.message_id);
    expect(sent?.key).toBe(committed.data.order_id);
    expect(JSON.parse(sent?.value ?? "{}")).toMatchObject({
      message_id: committed.message_id,
      type: "OrderAwaitingPayment",
    });
  });
});

describe("2. Relay chết giữa lúc publish rồi chạy lại", () => {
  it("không mất sự kiện; có thể trùng trên Kafka nhưng consumer chỉ xử lý một lần", async () => {
    const messages = Array.from({ length: 5 }, () => orderMessage());
    await db().transaction(async (exec) => {
      for (const m of messages) await outbox.add(exec, m, m.data.order_id);
    });
    const ids = messages.map((m) => m.message_id);

    // Relay 1: broker nhận batch nhưng "chết" trước khi commit published_at.
    const crash = { crash: true };
    const relay1 = new OutboxRelay({
      db: db(),
      kafka: crashAfterPublish(kafka, crash),
      pollIntervalMs: 20,
    });
    await relay1.start();
    await waitFor("relay1 failed after publish", async () =>
      (await errorCount(relay1)) >= 1 ? true : undefined,
    );
    await relay1.stop();
    expect(
      await count(
        `SELECT count(*) AS n FROM outbox_events WHERE id = ANY($1::uuid[]) AND published_at IS NULL`,
        [ids],
      ),
    ).toBe(5); // chưa đánh dấu ⇒ không mất

    // Relay 2 chạy lại bình thường.
    const relay2 = new OutboxRelay({ db: db(), kafka, pollIntervalMs: 20 });
    await relay2.start();
    await waitFor("relay2 published all", async () =>
      (await count(
        `SELECT count(*) AS n FROM outbox_events WHERE id = ANY($1::uuid[]) AND published_at IS NOT NULL`,
        [ids],
      )) === 5
        ? true
        : undefined,
    );
    await relay2.stop();

    const onKafka = (await readTopicToEnd(kafka, TOPIC)).map((r) => r.headers["message-id"]);
    for (const id of ids) expect(onKafka.filter((x) => x === id).length).toBeGreaterThanOrEqual(1);
    expect(onKafka.filter((x) => ids.includes(x)).length).toBeGreaterThan(5); // có trùng thật

    // Consumer có Inbox: mỗi message_id chỉ để lại đúng 1 hiệu ứng.
    const groupId = `g-${randomUUID()}`;
    const consumerName = `c-${randomUUID()}`;
    let handlerCalls = 0;
    const consumer = startConsumer(groupId, consumerName, async (exec, message) => {
      if (!ids.includes(message.message_id)) return;
      handlerCalls++;
      await exec.query(
        `INSERT INTO effects_test (message_id, consumer) VALUES ($1::uuid, $2) RETURNING message_id`,
        [message.message_id, consumerName],
      );
    });
    await consumer.start();
    await waitForGroupCaughtUp(kafka, groupId, TOPIC);

    const perId = await pg.pool.query<{ message_id: string; n: string }>(
      `SELECT message_id, count(*) AS n FROM effects_test WHERE consumer = $1 GROUP BY message_id`,
      [consumerName],
    );
    expect(perId.rows).toHaveLength(5);
    expect(perId.rows.every((r) => Number(r.n) === 1)).toBe(true);
    expect(handlerCalls).toBe(5);
  });
});

describe("4. DLQ và retry", () => {
  it("message sai schema ⇒ vào DLQ ngay với header x-error, x-attempts, x-original-topic", async () => {
    const marker = `bad-${randomUUID()}`;
    const producer = kafka.producer();
    await producer.connect();
    await producer.send({
      topic: TOPIC,
      messages: [
        {
          key: marker,
          value: JSON.stringify({ type: "OrderAwaitingPayment", message_id: "không-phải-uuid" }),
        },
        { key: `${marker}-json`, value: "{không phải json" },
      ],
    });
    await producer.disconnect();

    const groupId = `g-${randomUUID()}`;
    const handler = jest.fn<Promise<void>, Parameters<InboxHandler>>().mockResolvedValue(undefined);
    const consumer = startConsumer(groupId, `c-${randomUUID()}`, async (exec, m) => {
      if (m.type === "OrderAwaitingPayment" && m.data.order_id === marker) await handler(exec, m);
    });
    await consumer.start();
    await waitForGroupCaughtUp(kafka, groupId, TOPIC);

    const dlq = (await readTopicToEnd(kafka, DLQ)).filter((r) => r.key?.startsWith(marker));
    expect(dlq).toHaveLength(2);
    for (const record of dlq) {
      expect(record.headers["x-original-topic"]).toBe(TOPIC);
      expect(record.headers["x-attempts"]).toBe("1");
      expect(record.headers["x-error"]).not.toHaveLength(0);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("handler lỗi tạm thời 2 lần rồi thành công ⇒ xử lý đúng 1 lần, không vào DLQ", async () => {
    const msg = orderMessage();
    await db().transaction((exec) => outbox.add(exec, msg, msg.data.order_id));
    const relay = new OutboxRelay({ db: db(), kafka, pollIntervalMs: 20 });
    running.push(relay);
    await relay.start();
    await waitFor("published", async () =>
      (await count(
        `SELECT count(*) AS n FROM outbox_events WHERE id = $1::uuid AND published_at IS NOT NULL`,
        [msg.message_id],
      )) === 1
        ? true
        : undefined,
    );
    await relay.stop();

    const groupId = `g-${randomUUID()}`;
    const consumerName = `c-${randomUUID()}`;
    let attempts = 0;
    const consumer = startConsumer(groupId, consumerName, async (exec, message) => {
      if (message.message_id !== msg.message_id) return;
      attempts++;
      if (attempts <= 2) throw new Error("lỗi tạm thời");
      await exec.query(
        `INSERT INTO effects_test (message_id, consumer) VALUES ($1::uuid, $2) RETURNING message_id`,
        [message.message_id, consumerName],
      );
    });
    await consumer.start();
    await waitForGroupCaughtUp(kafka, groupId, TOPIC);

    expect(attempts).toBe(3);
    expect(
      await count(`SELECT count(*) AS n FROM effects_test WHERE consumer = $1`, [consumerName]),
    ).toBe(1);
    const dlq = (await readTopicToEnd(kafka, DLQ)).filter((r) => r.value?.includes(msg.message_id));
    expect(dlq).toHaveLength(0);
  });

  it("lỗi mãi mãi ⇒ DLQ sau maxAttempts với x-attempts đúng; PermanentError ⇒ DLQ ngay (x-attempts=1)", async () => {
    const failing = orderMessage();
    const permanent = orderMessage();
    await db().transaction(async (exec) => {
      await outbox.add(exec, failing, failing.data.order_id);
      await outbox.add(exec, permanent, permanent.data.order_id);
    });
    const relay = new OutboxRelay({ db: db(), kafka, pollIntervalMs: 20 });
    running.push(relay);
    await relay.start();
    await waitFor("published", async () =>
      (await count(
        `SELECT count(*) AS n FROM outbox_events WHERE id = ANY($1::uuid[]) AND published_at IS NOT NULL`,
        [[failing.message_id, permanent.message_id]],
      )) === 2
        ? true
        : undefined,
    );
    await relay.stop();

    const groupId = `g-${randomUUID()}`;
    const consumerName = `c-${randomUUID()}`;
    const calls = new Map<string, number>();
    const consumer = startConsumer(
      groupId,
      consumerName,
      async (_exec, message) => {
        if (
          message.message_id !== failing.message_id &&
          message.message_id !== permanent.message_id
        )
          return;
        calls.set(message.message_id, (calls.get(message.message_id) ?? 0) + 1);
        if (message.message_id === permanent.message_id) throw new PermanentError("dữ liệu sai");
        throw new Error("luôn lỗi");
      },
      { maxAttempts: 3 },
    );
    await consumer.start();
    await waitForGroupCaughtUp(kafka, groupId, TOPIC);

    const dlq = await readTopicToEnd(kafka, DLQ);
    const failingLetter = dlq.find((r) => r.value?.includes(failing.message_id));
    const permanentLetter = dlq.find((r) => r.value?.includes(permanent.message_id));
    expect(failingLetter?.headers["x-attempts"]).toBe("3");
    expect(failingLetter?.headers["x-error"]).toContain("luôn lỗi");
    expect(failingLetter?.headers["x-original-topic"]).toBe(TOPIC);
    expect(permanentLetter?.headers["x-attempts"]).toBe("1");
    expect(calls.get(failing.message_id)).toBe(3);
    expect(calls.get(permanent.message_id)).toBe(1);
    // Đã vào DLQ thì không được đánh dấu là đã xử lý (transaction đã rollback).
    expect(
      await count(
        `SELECT count(*) AS n FROM processed_events WHERE consumer = $1 AND message_id = ANY($2::uuid[])`,
        [consumerName, [failing.message_id, permanent.message_id]],
      ),
    ).toBe(0);
  });
});

describe("5. Thứ tự trong cùng key", () => {
  it("3 key × 50 message qua nhiều batch ⇒ mỗi key đến Kafka đúng thứ tự ghi", async () => {
    const keys = [randomUUID(), randomUUID(), randomUUID()];
    const perKey = 50;
    for (let seq = 1; seq <= perKey; seq++) {
      for (const key of keys) {
        const msg = orderMessage(key, seq);
        await db().transaction((exec) => outbox.add(exec, msg, key));
      }
    }

    const relay = new OutboxRelay({ db: db(), kafka, pollIntervalMs: 10, batchSize: 40 });
    running.push(relay);
    await relay.start();
    await waitFor("all 150 published", async () =>
      (await count(
        `SELECT count(*) AS n FROM outbox_events WHERE message_key = ANY($1::text[]) AND published_at IS NOT NULL`,
        [keys],
      )) ===
      keys.length * perKey
        ? true
        : undefined,
    );
    await relay.stop();

    const records = await readTopicToEnd(kafka, TOPIC);
    for (const key of keys) {
      const seqs = records
        .filter((r) => r.key === key)
        .map(
          (r) => (JSON.parse(r.value ?? "{}") as { data: { amount_vnd: number } }).data.amount_vnd,
        );
      expect(seqs).toEqual(Array.from({ length: perKey }, (_, i) => i + 1));
      expect(new Set(records.filter((r) => r.key === key).map((r) => r.partition)).size).toBe(1);
    }
  });
});
