import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Logger } from "@ticketing/common";
import { createRelayMetrics, OutboxRelay, prismaDatabase } from "@ticketing/outbox-inbox";
import { Kafka, logLevel } from "kafkajs";
import { ENV, LOGGER } from "../app.tokens";
import type { Env } from "../config/env.schema";
import { PrismaService } from "../db/prisma.service";
import { MetricsService } from "../metrics/metrics";

@Injectable()
export class EventOutboxWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private relay?: OutboxRelay;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly db: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async onApplicationBootstrap() {
    if (!this.env.EVENT_OUTBOX_ENABLED) return;
    const kafka = new Kafka({
      clientId: "event",
      brokers: this.env.KAFKA_BROKERS,
      connectionTimeout: 2000,
      requestTimeout: 10000,
      retry: { retries: 4 },
      logLevel: logLevel.NOTHING,
    });
    this.relay = new OutboxRelay({
      kafka,
      db: prismaDatabase(this.db),
      logger: this.logger,
      metrics: createRelayMetrics(this.metrics.registry),
    });
    await this.relay.start();
  }

  async beforeApplicationShutdown() {
    await this.relay?.stop();
  }
}
