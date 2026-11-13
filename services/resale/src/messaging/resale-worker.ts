import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Logger, ProblemException } from "@ticketing/common";
import { Topics } from "@ticketing/event-contracts";
import {
  createInboxConsumer,
  createRelayMetrics,
  InboxConsumer,
  OutboxRelay,
} from "@ticketing/outbox-inbox";
import { Kafka, logLevel } from "kafkajs";
import { Counter } from "prom-client";
import { ENV, LOGGER } from "../app.tokens";
import { Env } from "../config/env.schema";
import { MetricsService } from "../metrics/metrics";
import { ListingOperationRepository } from "../modules/listings/listing-operation.repository";
import { ListingOperationsService } from "../modules/listings/listing-operations.service";
import { ListingRepository } from "../modules/listings/listing.repository";
import { ListingHandler } from "./listing.handler";

@Injectable()
export class ResaleWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private consumer?: InboxConsumer;
  private relay?: OutboxRelay;
  private timer?: ReturnType<typeof setInterval>;
  private recovery?: Promise<void>;
  private readonly attempts: Counter<"outcome">;
  private readonly relayMetrics;
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly listings: ListingRepository,
    private readonly operations: ListingOperationsService,
    private readonly repo: ListingOperationRepository,
    private readonly handler: ListingHandler,
    metrics: MetricsService,
  ) {
    this.attempts = new Counter({
      name: "resale_recovery_attempts_total",
      help: "Listing recovery drive outcomes",
      labelNames: ["outcome"],
      registers: [metrics.registry],
    });
    this.relayMetrics = createRelayMetrics(metrics.registry);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.RESALE_RECOVERY_ENABLED === "true") {
      this.timer = setInterval(() => {
        void this.recoverOnce().catch(() =>
          this.logger.warn(
            { request_id: "resale-recovery", trace_id: "resale-recovery" },
            "Listing recovery poll failed",
          ),
        );
      }, this.env.RESALE_RECOVERY_POLL_MS);
      this.timer.unref();
    }
    if (this.env.RESALE_WORKERS_ENABLED !== "true") return;
    const kafka = new Kafka({
      clientId: "resale",
      brokers: this.env.KAFKA_BROKERS.split(",").map((value) => value.trim()),
      logLevel: logLevel.NOTHING,
    });
    this.consumer = createInboxConsumer({
      kafka,
      db: this.listings.db,
      groupId: "resale-listings-v1",
      consumerName: "resale-listings-v1",
      topics: [Topics.TICKET_EVENTS],
      logger: this.logger,
      handler: async (executor, message) => {
        await this.handler.handle(executor, message);
        this.logger.info(
          {
            request_id: message.message_id,
            trace_id: message.trace_id ?? message.message_id,
            type: message.type,
          },
          "Resale ticket message handled in transaction",
        );
      },
    });
    this.relay = new OutboxRelay({
      kafka,
      db: this.listings.db,
      logger: this.logger,
      metrics: this.relayMetrics,
    });
    try {
      await this.consumer.start();
      await this.relay.start();
    } catch (error) {
      await this.beforeApplicationShutdown();
      throw error;
    }
  }

  recoverOnce(): Promise<void> {
    if (!this.recovery)
      this.recovery = this.recoverBatch().finally(() => {
        this.recovery = undefined;
      });
    return this.recovery;
  }
  private async recoverBatch(): Promise<void> {
    for (const id of await this.repo.due()) {
      const operation = await this.repo.peek(id);
      try {
        await this.operations.drive(id);
        this.attempts.inc({ outcome: "completed" });
      } catch (error) {
        const outcome =
          error instanceof ProblemException && error.getStatus() < 500 ? "failed" : "retry";
        this.attempts.inc({ outcome });
        this.logger.warn(
          { request_id: id, trace_id: operation.trace_id ?? id, outcome },
          "Listing recovery drive ended without a successful response",
        );
      }
    }
  }
  async beforeApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const results = await Promise.allSettled([
      this.recovery,
      this.consumer?.stop(),
      this.relay?.stop(),
    ]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}
