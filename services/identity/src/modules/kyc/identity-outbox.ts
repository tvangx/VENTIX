import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { Logger } from "@ticketing/common";
import { createRelayMetrics, OutboxRelay, pgDatabase } from "@ticketing/outbox-inbox";
import { Kafka, logLevel } from "kafkajs";
import { Pool } from "pg";
import { ENV, LOGGER } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { MetricsService } from "../../metrics/metrics";

@Injectable()
export class IdentityOutbox
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  private pool?: Pool;
  private relay?: OutboxRelay;
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly metrics: MetricsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.IDENTITY_OUTBOX_ENABLED !== "true") return;
    this.pool = new Pool({
      connectionString: this.env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 3000,
    });
    this.pool.on("error", () => undefined);
    const kafka = new Kafka({
      clientId: "identity-outbox",
      brokers: this.env.KAFKA_BROKERS.split(",").map((broker) => broker.trim()),
      logLevel: logLevel.NOTHING,
    });
    this.relay = new OutboxRelay({
      kafka,
      db: pgDatabase(this.pool),
      logger: this.logger,
      metrics: createRelayMetrics(this.metrics.registry),
    });
    try {
      await this.relay.start();
    } catch (error) {
      await this.relay.stop();
      await this.onApplicationShutdown();
      throw error;
    }
  }
  async beforeApplicationShutdown(): Promise<void> {
    await this.relay?.stop();
  }
  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }
}
