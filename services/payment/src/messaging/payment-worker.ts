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
import { Kafka, logLevel } from "kafkajs";
import { z } from "zod";
import { ENV, LOGGER } from "../app.tokens";
import { Env } from "../config/env.schema";
import { PaymentRepository } from "../modules/payments/payment.repository";
import { PaymentService } from "../modules/payments/payment.service";
import { MetricsService } from "../metrics/metrics";
import { payableHandler } from "./payable.handler";

const mockData = z.object({
  dueAt: z.string().datetime(),
  notification: z.unknown(),
  duplicate: z.boolean(),
});
@Injectable()
export class PaymentWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private consumer?: InboxConsumer;
  private relay?: OutboxRelay;
  private timer?: NodeJS.Timeout;
  private pending?: Promise<void>;
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly repo: PaymentRepository,
    private readonly payments: PaymentService,
    private readonly metrics: MetricsService,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.PAYMENT_WORKERS_ENABLED) return;
    const kafka = new Kafka({
      clientId: "payment",
      brokers: this.env.KAFKA_BROKERS,
      logLevel: logLevel.NOTHING,
    });
    this.consumer = createInboxConsumer({
      kafka,
      groupId: "payment-payables",
      consumerName: "payment-payables",
      topics: [Topics.BOOKING_ORDERS, Topics.RESALE_EVENTS],
      db: this.repo.db,
      logger: this.logger,
      handler: payableHandler,
    });
    try {
      await this.consumer.start();
      this.relay = new OutboxRelay({
        kafka,
        db: this.repo.db,
        logger: this.logger,
        metrics: createRelayMetrics(this.metrics.registry),
      });
      await this.relay.start();
      this.timer = setInterval(() => {
        if (!this.pending)
          this.pending = this.tick()
            .catch(() => {
              this.logger.error(
                { request_id: "mock-worker", trace_id: "mock-worker" },
                "payment: mock callback failed; will retry",
              );
            })
            .finally(() => {
              this.pending = undefined;
            });
      }, 100);
      this.timer.unref();
    } catch (error) {
      await this.consumer.stop();
      await this.relay?.stop();
      throw error;
    }
  }
  async tick(): Promise<void> {
    const rows = await this.repo.dueMocks();
    for (const row of rows) {
      const stored = mockData.parse(row.mock_data);
      const notification = this.payments.mock.verifyIpn(stored.notification);
      if (!notification) throw new Error("Invalid stored mock callback");
      await this.payments.receive("MOCK", notification, row.trace_id);
      if (stored.duplicate) await this.payments.receive("MOCK", notification, row.trace_id);
    }
  }
  async beforeApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pending;
    await this.consumer?.stop();
    await this.relay?.stop();
  }
}
