import type { Kafka, Message } from "kafkajs";
import { sleep } from "./backoff";
import { errorMessage, noopLogger } from "./logger";
import type { Logger } from "./logger";
import { createRelayMetrics } from "./metrics";
import type { OutboxRelayMetrics } from "./metrics";
import type { Database } from "./sql-executor";
import { context, propagation, SpanKind, trace, type Span } from "@opentelemetry/api";
import { extractTraceContext, parseStoredTraceContext } from "./trace-context";

export interface OutboxRelayOptions {
  db: Database;
  /** Chỉ cần `producer()`; test có thể truyền bản bọc để chèn lỗi. */
  kafka: Pick<Kafka, "producer">;
  /** Nghỉ giữa các lượt poll khi hết việc hoặc sau lỗi. Mặc định 200 ms. */
  pollIntervalMs?: number;
  /** Số dòng tối đa mỗi lượt. Mặc định 100. */
  batchSize?: number;
  logger?: Logger;
  metrics?: OutboxRelayMetrics;
}

interface OutboxRow {
  id: string;
  topic: string;
  message_key: string;
  event_type: string;
  payload_text: string;
  age_seconds: number;
  trace_context: unknown;
}

/**
 * Relay Outbox → Kafka (ADR-0005). Mỗi lượt là MỘT transaction:
 * khóa các dòng chưa gửi (`FOR UPDATE SKIP LOCKED`) → gửi Kafka (idempotent, acks=all) → `published_at = now()` → commit.
 *
 * Bảo đảm: không mất (chết trước commit thì dòng vẫn chưa đánh dấu, lượt sau gửi lại).
 * Có thể trùng (chết sau khi Kafka nhận, trước commit) — consumer bắt buộc dùng Inbox.
 *
 * Thứ tự theo key: giữ nguyên khi chỉ một relay hoạt động. Khi chạy nhiều relay, `SKIP LOCKED` có thể để
 * batch sau gửi trước batch trước của cùng key; luồng cần thứ tự chặt chẽ phải chạy một relay cho mỗi DB.
 * Ngoài ra `created_at = now()` là thời điểm bắt đầu transaction của nghiệp vụ.
 */
export class OutboxRelay {
  readonly metrics: OutboxRelayMetrics;
  private readonly db: Database;
  private readonly producer: ReturnType<Kafka["producer"]>;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly logger: Logger;
  private readonly abort = new AbortController();
  private loop: Promise<void> | undefined;
  private connected = false;

  constructor(options: OutboxRelayOptions) {
    this.db = options.db;
    // maxInFlightRequests=1 là điều kiện của kafkajs để idempotent giữ đúng thứ tự.
    this.producer = options.kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
    this.batchSize = options.batchSize ?? 100;
    this.logger = options.logger ?? noopLogger;
    this.metrics = options.metrics ?? createRelayMetrics();
    if (this.batchSize < 1) throw new Error("batchSize must be >= 1");
  }

  /** Kết nối Kafka rồi chạy vòng polling nền. Gọi lại khi đang chạy là không có tác dụng. */
  async start(): Promise<void> {
    if (this.loop) return;
    await this.producer.connect();
    this.connected = true;
    this.loop = this.run();
  }

  /** Dừng nhận lượt mới, chờ lượt đang chạy xong (không bỏ dở giữa publish và commit), rồi đóng producer. */
  async stop(): Promise<void> {
    this.abort.abort();
    await this.loop;
    this.loop = undefined;
    if (this.connected) {
      this.connected = false;
      await this.producer.disconnect();
    }
  }

  /**
   * Một lượt poll. Trả về số dòng đã gửi (0 nếu hết việc). Ném lỗi nếu Kafka/DB lỗi — khi đó transaction
   * rollback và các dòng vẫn chưa gửi. Công khai để test gọi trực tiếp; `start()` dùng nó trong vòng lặp.
   */
  async tick(): Promise<number> {
    const startedAt = Date.now();
    const rows = await this.db.transaction(async (exec) => {
      const selected = await exec.query<OutboxRow>(
        `SELECT id, topic, message_key, event_type, payload::text AS payload_text,
                EXTRACT(EPOCH FROM (clock_timestamp() - created_at))::float8 AS age_seconds,
                trace_context
           FROM outbox_events
          WHERE published_at IS NULL
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [this.batchSize],
      );
      if (selected.length === 0) return selected;

      const byTopic = new Map<string, Message[]>();
      const producerSpans: Span[] = [];
      for (const row of selected) {
        const list = byTopic.get(row.topic) ?? [];
        const headers: Record<string, string> = {
          "message-id": row.id,
          "event-type": row.event_type,
        };
        const parent = extractTraceContext(parseStoredTraceContext(row.trace_context));
        const span = trace.getTracer("ticketing.outbox").startSpan(
          "messaging publish",
          {
            kind: SpanKind.PRODUCER,
            attributes: { "messaging.system": "kafka", "messaging.destination.name": row.topic },
          },
          parent,
        );
        context.with(trace.setSpan(parent, span), () => {
          // Default W3C propagator emits only traceparent/tracestate, never baggage unless explicitly configured.
          const carrier: Record<string, string> = {};
          propagation.inject(context.active(), carrier);
          if (carrier.traceparent) headers.traceparent = carrier.traceparent;
          if (carrier.tracestate) headers.tracestate = carrier.tracestate;
        });
        producerSpans.push(span);
        list.push({ key: row.message_key, value: row.payload_text, headers });
        byTopic.set(row.topic, list);
      }
      try {
        await this.producer.sendBatch({
          acks: -1,
          topicMessages: [...byTopic].map(([topic, messages]) => ({ topic, messages })),
        });
      } finally {
        producerSpans.forEach((span) => span.end());
      }

      await exec.query(
        `UPDATE outbox_events SET published_at = now() WHERE id = ANY($1::uuid[]) RETURNING id`,
        [selected.map((r) => r.id)],
      );
      return selected;
    });

    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    for (const row of rows) {
      this.metrics.lag.observe(Number(row.age_seconds) + elapsedSeconds);
    }
    this.metrics.published.inc(rows.length);
    return rows.length;
  }

  private async run(): Promise<void> {
    while (!this.abort.signal.aborted) {
      let sent = 0;
      try {
        sent = await this.tick();
      } catch (err) {
        this.metrics.errors.inc();
        this.logger.error({ err: errorMessage(err) }, "outbox relay poll failed");
      }
      // Còn việc (đầy batch) thì chạy tiếp ngay; hết việc hoặc lỗi thì nghỉ.
      if (sent < this.batchSize) {
        await sleep(this.pollIntervalMs, this.abort.signal);
      }
    }
  }
}
