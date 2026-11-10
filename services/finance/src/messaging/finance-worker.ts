import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  BeforeApplicationShutdown,
} from "@nestjs/common";
import { Logger } from "@ticketing/common";
import { Topics } from "@ticketing/event-contracts";
import {
  createInboxConsumer,
  InboxConsumer,
  OutboxRelay,
  createRelayMetrics,
} from "@ticketing/outbox-inbox";
import { Counter } from "prom-client";
import { Kafka, Consumer, Producer, logLevel } from "kafkajs";
import { ENV, LOGGER } from "../app.tokens";
import { Env } from "../config/env.schema";
import { FinanceRepository } from "../modules/finance.repository";
import { DlqService } from "../modules/dlq/dlq.service";
import { MetricsService } from "../metrics/metrics";
import { FinanceHandler } from "./finance.handler";
import { SeatPrefetch } from "./seat-prefetch";

@Injectable()
export class FinanceWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private consumer?: InboxConsumer;
  private collector?: Consumer;
  private producer?: Producer;
  private relay?: OutboxRelay;
  private timer?: NodeJS.Timeout;
  private pending?: Promise<void>;
  private readonly handled: Counter<"type" | "outcome">;
  private readonly failures: Counter;
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly repo: FinanceRepository,
    private readonly handler: FinanceHandler,
    private readonly dlq: DlqService,
    private readonly prefetch: SeatPrefetch,
    metrics: MetricsService,
  ) {
    this.handled = new Counter({
      name: "finance_messages_total",
      help: "Finance handler outcomes (before transaction commit)",
      labelNames: ["type", "outcome"],
      registers: [metrics.registry],
    });
    this.failures = new Counter({
      name: "finance_worker_errors_total",
      help: "Finance prefetch/replay failures",
      registers: [metrics.registry],
    });
    this.relay = undefined;
    this.relayMetrics = createRelayMetrics(metrics.registry);
  }
  private readonly relayMetrics;
  async onApplicationBootstrap(): Promise<void> {
    if (this.env.FINANCE_WORKERS_ENABLED !== "true") return;
    const kafka = new Kafka({
      clientId: "finance",
      brokers: this.env.KAFKA_BROKERS.split(","),
      logLevel: logLevel.NOTHING,
    });
    this.consumer = createInboxConsumer({
      kafka,
      db: this.repo.db,
      groupId: "finance-v1",
      consumerName: "finance-v1",
      topics: [
        Topics.EVENT_LIFECYCLE,
        Topics.BOOKING_ORDERS,
        Topics.PAYMENT_EVENTS,
        Topics.AUDIT_EVENTS,
      ],
      logger: this.logger,
      handler: async (e, m) => {
        try {
          await this.handler.handle(e, m);
          this.handled.inc({ type: m.type, outcome: "handled" });
          this.logger.info(
            { request_id: m.message_id, trace_id: m.trace_id ?? m.message_id, type: m.type },
            "Finance message handled in transaction",
          );
        } catch (error) {
          this.handled.inc({ type: m.type, outcome: "failed" });
          this.logger.warn(
            { request_id: m.message_id, trace_id: m.trace_id ?? m.message_id, type: m.type },
            "Finance message failed; Inbox will retry or dead-letter",
          );
          throw error;
        }
      },
    });
    this.collector = kafka.consumer({ groupId: "finance-dlq-v1" });
    this.producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
    this.relay = new OutboxRelay({
      kafka,
      db: this.repo.db,
      logger: this.logger,
      metrics: this.relayMetrics,
    });
    try {
      await this.producer.connect();
      await this.collector.connect();
      await this.collector.subscribe({ topic: /.*\.dlq$/, fromBeginning: true });
      await this.collector.run({
        autoCommit: false,
        eachMessage: async ({ topic, partition, message }) => {
          await this.dlq.collect(topic, partition, message);
          await this.collector!.commitOffsets([
            { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
          ]);
        },
      });
      await this.consumer.start();
      await this.relay.start();
      this.timer = setInterval(() => {
        if (!this.pending)
          this.pending = this.tick()
            .catch(() => {
              this.failures.inc();
              this.logger.error(
                { request_id: "finance-worker", trace_id: "finance-worker" },
                "Finance prefetch/replay failed; will retry",
              );
            })
            .finally(() => {
              this.pending = undefined;
            });
      }, this.env.FINANCE_POLL_MS);
      this.timer.unref();
    } catch (error) {
      await this.beforeApplicationShutdown();
      throw error;
    }
  }
  async tick(): Promise<void> {
    // Replay vẫn chạy nếu event API tạm thời lỗi.
    const results = await Promise.allSettled([
      this.prefetch.tick(),
      this.producer ? this.dlq.relay(this.producer) : Promise.resolve(),
    ]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
  async beforeApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pending;
    await this.consumer?.stop();
    await this.collector?.disconnect();
    await this.relay?.stop();
    await this.producer?.disconnect();
  }
}
