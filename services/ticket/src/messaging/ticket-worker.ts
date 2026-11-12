import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Logger } from "@ticketing/common";
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
import { TicketRepository } from "../modules/tickets/ticket.repository";
import { TicketHandler } from "./ticket.handler";

@Injectable()
export class TicketWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private consumer?: InboxConsumer;
  private relay?: OutboxRelay;
  private readonly handled: Counter<"outcome">;
  private readonly relayMetrics;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly repo: TicketRepository,
    private readonly handler: TicketHandler,
    metrics: MetricsService,
  ) {
    this.handled = new Counter({
      name: "ticket_issuance_attempts_total",
      help: "Ticket issuance handler attempts before transaction commit",
      labelNames: ["outcome"],
      registers: [metrics.registry],
    });
    this.relayMetrics = createRelayMetrics(metrics.registry);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.TICKET_WORKERS_ENABLED !== "true") return;
    const kafka = new Kafka({
      clientId: "ticket",
      brokers: this.env.KAFKA_BROKERS.split(",").map((broker) => broker.trim()),
      logLevel: logLevel.NOTHING,
    });
    this.consumer = createInboxConsumer({
      kafka,
      db: this.repo.db,
      groupId: "ticket-issuance-v1",
      consumerName: "ticket-issuance-v1",
      topics: [Topics.BOOKING_ORDERS],
      logger: this.logger,
      handler: async (executor, message) => {
        if (message.type !== "OrderConfirmed") return;
        const context = {
          request_id: message.message_id,
          trace_id: message.trace_id ?? message.message_id,
          type: message.type,
        };
        try {
          await this.handler.handle(executor, message);
          this.handled.inc({ outcome: "handled" });
          this.logger.info(context, "Ticket issuance handled in transaction");
        } catch (error) {
          this.handled.inc({ outcome: "failed" });
          this.logger.warn(context, "Ticket issuance failed; Inbox will retry or dead-letter");
          throw error;
        }
      },
    });
    this.relay = new OutboxRelay({
      kafka,
      db: this.repo.db,
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

  async beforeApplicationShutdown(): Promise<void> {
    const results = await Promise.allSettled([this.consumer?.stop(), this.relay?.stop()]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}
