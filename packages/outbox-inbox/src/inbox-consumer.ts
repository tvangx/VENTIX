import { parseMessage } from "@ticketing/event-contracts";
import type { Kafka, Producer } from "kafkajs";
import { backoffDelayMs, sleep as defaultSleep } from "./backoff";
import { errorMessage, noopLogger } from "./logger";
import type { Logger } from "./logger";
import type { ParsedMessage } from "./outbox-service";
import type { Database, SqlExecutor } from "./sql-executor";

/** Handler nghiệp vụ. Mọi ghi DB phải đi qua `exec` để nằm cùng transaction với dòng Inbox. */
export type InboxHandler = (exec: SqlExecutor, message: ParsedMessage) => Promise<void>;

/** Handler ném lỗi này khi chắc chắn thử lại cũng vô ích (dữ liệu sai nghiệp vụ) ⇒ vào DLQ ngay, không retry. */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

/** Bản ghi thô lấy từ Kafka. */
export interface InboxRecord {
  topic: string;
  partition: number;
  offset: string;
  key: Buffer | null;
  value: Buffer | null;
}

export interface DeadLetter {
  record: InboxRecord;
  error: string;
  attempts: number;
}

export type InboxOutcome = "processed" | "duplicate" | "dead-lettered";

export interface InboxProcessorOptions {
  consumerName: string;
  db: Database;
  handler: InboxHandler;
  /** Tổng số lần thử handler (kể cả lần đầu). Mặc định 5. */
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  deadLetter: (letter: DeadLetter) => Promise<void>;
  logger?: Logger;
  signal?: AbortSignal;
  /** Chỉ để test: thay đồng hồ và nguồn ngẫu nhiên. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

/** Logic xử lý một message, tách khỏi kafkajs để test không cần broker. */
export class InboxProcessor {
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly logger: Logger;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: InboxProcessorOptions) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseBackoffMs = options.baseBackoffMs ?? 200;
    this.maxBackoffMs = options.maxBackoffMs ?? 10_000;
    this.logger = options.logger ?? noopLogger;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    if (this.maxAttempts < 1) throw new Error("maxAttempts must be >= 1");
  }

  /**
   * Trả về kết quả khi message đã được xử lý xong theo một trong ba cách (caller commit offset).
   * Ném lỗi khi KHÔNG được commit offset: gửi DLQ thất bại hoặc đang shutdown giữa lúc retry.
   */
  async process(record: InboxRecord): Promise<InboxOutcome> {
    let message: ParsedMessage;
    try {
      const text = record.value?.toString("utf8");
      if (!text) throw new Error("Empty message value");
      message = parseMessage(JSON.parse(text) as unknown);
    } catch (err) {
      // Sai JSON/schema: thử lại vẫn sai, nên vào DLQ ngay.
      await this.options.deadLetter({ record, error: errorMessage(err), attempts: 1 });
      this.logger.warn(
        { topic: record.topic, partition: record.partition, offset: record.offset },
        "inbox: invalid message sent to DLQ",
      );
      return "dead-lettered";
    }

    for (let attempt = 1; ; attempt++) {
      try {
        const handled = await this.options.db.transaction(async (exec) => {
          const inserted = await exec.query<{ message_id: string }>(
            `INSERT INTO processed_events (message_id, consumer) VALUES ($1::uuid, $2)
             ON CONFLICT DO NOTHING RETURNING message_id`,
            [message.message_id, this.options.consumerName],
          );
          if (inserted.length === 0) return false; // đã xử lý trước đó
          await this.options.handler(exec, message);
          return true;
        });
        return handled ? "processed" : "duplicate";
      } catch (err) {
        const permanent = err instanceof PermanentError;
        if (permanent || attempt >= this.maxAttempts) {
          await this.options.deadLetter({ record, error: errorMessage(err), attempts: attempt });
          this.logger.error(
            { message_id: message.message_id, type: message.type, attempts: attempt, permanent },
            "inbox: handler failed, sent to DLQ",
          );
          return "dead-lettered";
        }
        this.logger.warn(
          { message_id: message.message_id, type: message.type, attempt, err: errorMessage(err) },
          "inbox: handler failed, will retry",
        );
        await this.sleep(
          backoffDelayMs(attempt, this.baseBackoffMs, this.maxBackoffMs, this.random),
          this.options.signal,
        );
        if (this.options.signal?.aborted) {
          throw new Error("Inbox consumer is shutting down; message will be redelivered");
        }
      }
    }
  }
}

export interface InboxConsumerOptions {
  kafka: Pick<Kafka, "consumer" | "producer">;
  groupId: string;
  /** Tên ghi vào `processed_events.consumer`. Đổi tên = xử lý lại từ đầu, nên phải ổn định. */
  consumerName: string;
  topics: string[];
  db: Database;
  handler: InboxHandler;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Nhóm mới có đọc từ đầu topic không. Mặc định true (không bỏ lỡ sự kiện cũ). */
  fromBeginning?: boolean;
  logger?: Logger;
}

export interface InboxConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Consumer có Inbox: parse → (1 transaction: ghi `processed_events` + handler) → commit offset.
 * Offset chỉ commit sau khi message đã xử lý xong hoặc đã vào DLQ. Xử lý tuần tự trong từng partition.
 */
export function createInboxConsumer(options: InboxConsumerOptions): InboxConsumer {
  const abort = new AbortController();
  const consumer = options.kafka.consumer({ groupId: options.groupId });
  const dlqProducer: Producer = options.kafka.producer({
    idempotent: true,
    maxInFlightRequests: 1,
  });
  let running = false;

  const processor = new InboxProcessor({
    consumerName: options.consumerName,
    db: options.db,
    handler: options.handler,
    maxAttempts: options.maxAttempts,
    baseBackoffMs: options.baseBackoffMs,
    maxBackoffMs: options.maxBackoffMs,
    logger: options.logger,
    signal: abort.signal,
    deadLetter: async ({ record, error, attempts }) => {
      await dlqProducer.send({
        topic: `${record.topic}.dlq`,
        acks: -1,
        messages: [
          {
            key: record.key,
            value: record.value,
            headers: {
              "x-error": error,
              "x-attempts": String(attempts),
              "x-original-topic": record.topic,
              "x-original-partition": String(record.partition),
              "x-original-offset": record.offset,
              "x-consumer": options.consumerName,
            },
          },
        ],
      });
    },
  });

  return {
    async start() {
      if (running) return;
      running = true;
      await dlqProducer.connect();
      await consumer.connect();
      for (const topic of options.topics) {
        await consumer.subscribe({ topic, fromBeginning: options.fromBeginning ?? true });
      }
      await consumer.run({
        autoCommit: false,
        eachMessage: async ({ topic, partition, message }) => {
          await processor.process({
            topic,
            partition,
            offset: message.offset,
            key: message.key,
            value: message.value,
          });
          await consumer.commitOffsets([
            { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
          ]);
        },
      });
    },
    async stop() {
      if (!running) return;
      running = false;
      abort.abort();
      await consumer.stop();
      await consumer.disconnect();
      await dlqProducer.disconnect();
    },
  };
}
