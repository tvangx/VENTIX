import { randomUUID } from "node:crypto";
import { newMessage } from "@ticketing/event-contracts";
import type { Kafka } from "kafkajs";

/** `OrderAwaitingPayment` hợp lệ; `seq` đặt vào `amount_vnd` để test thứ tự. Key Kafka của topic này là `order_id`. */
export function orderMessage(orderId: string = randomUUID(), seq = 1) {
  return newMessage("OrderAwaitingPayment", {
    order_id: orderId,
    user_id: randomUUID(),
    event_id: randomUUID(),
    amount_vnd: seq,
    expires_at: new Date(Date.now() + 900_000).toISOString(),
  });
}

export async function waitFor<T>(
  description: string,
  fn: () => Promise<T | undefined | false>,
  timeoutMs = 60_000,
  intervalMs = 100,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${description}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface ReceivedRecord {
  partition: number;
  offset: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
}

/** Đọc TOÀN BỘ nội dung hiện có của topic (từ đầu đến high-watermark lúc gọi). Kết quả xác định, không chờ ngẫu nhiên. */
export async function readTopicToEnd(
  kafka: Kafka,
  topic: string,
  timeoutMs = 60_000,
): Promise<ReceivedRecord[]> {
  const admin = kafka.admin();
  await admin.connect();
  const offsets = await admin.fetchTopicOffsets(topic);
  await admin.disconnect();

  const lastOffset = new Map<number, number>();
  for (const o of offsets) {
    if (Number(o.high) > Number(o.low)) lastOffset.set(o.partition, Number(o.high) - 1);
  }
  if (lastOffset.size === 0) return [];

  const consumer = kafka.consumer({ groupId: `reader-${randomUUID()}` });
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });
  const records: ReceivedRecord[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out reading ${topic}`)), timeoutMs);
      consumer
        .run({
          eachMessage: async ({ partition, message }) => {
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(message.headers ?? {})) headers[k] = String(v);
            records.push({
              partition,
              offset: message.offset,
              key: message.key?.toString() ?? null,
              value: message.value?.toString() ?? null,
              headers,
            });
            const last = lastOffset.get(partition);
            if (last !== undefined && Number(message.offset) >= last) {
              lastOffset.delete(partition);
              if (lastOffset.size === 0) {
                clearTimeout(timer);
                resolve();
              }
            }
          },
        })
        .catch(reject);
    });
  } finally {
    await consumer.disconnect();
  }
  return records;
}

/** Chờ đến khi nhóm consumer đã commit tới cuối mọi partition của topic (đã xử lý hết những gì đang có). */
export async function waitForGroupCaughtUp(
  kafka: Kafka,
  groupId: string,
  topic: string,
): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    await waitFor(`group ${groupId} caught up on ${topic}`, async () => {
      const high = await admin.fetchTopicOffsets(topic);
      const committed = await admin.fetchOffsets({ groupId, topics: [topic] });
      const byPartition = new Map(
        committed[0]?.partitions.map((p) => [p.partition, Number(p.offset)]),
      );
      return high.every(
        (h) => Number(h.high) === 0 || (byPartition.get(h.partition) ?? -1) >= Number(h.high),
      )
        ? true
        : undefined;
    });
  } finally {
    await admin.disconnect();
  }
}
