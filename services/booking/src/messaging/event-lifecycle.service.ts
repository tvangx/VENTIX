import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Logger } from "@ticketing/common";
import { Topics } from "@ticketing/event-contracts";
import { createInboxConsumer, InboxConsumer, pgDatabase } from "@ticketing/outbox-inbox";
import { Kafka, logLevel } from "kafkajs";
import { Pool } from "pg";
import { ENV, LOGGER } from "../app.tokens";
import { Env } from "../config/env.schema";
import { handleEventLifecycle } from "./event-lifecycle.handler";

@Injectable()
export class EventLifecycleService implements OnApplicationShutdown {
  private readonly pool: Pool;
  private consumer?: InboxConsumer;
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 2000,
      query_timeout: 10000,
    });
    this.pool.on("error", () => undefined);
  }
  async start(): Promise<void> {
    const kafka = new Kafka({
      clientId: "booking-event-lifecycle",
      brokers: this.env.KAFKA_BROKERS,
      logLevel: logLevel.NOTHING,
    });
    this.consumer = createInboxConsumer({
      kafka,
      groupId: this.env.EVENT_CONSUMER_GROUP_ID,
      consumerName: "booking-event-lifecycle",
      topics: [Topics.EVENT_LIFECYCLE],
      db: pgDatabase(this.pool),
      logger: this.logger,
      handler: async (exec, message) => {
        await handleEventLifecycle(exec, message);
        this.logger.info(
          {
            message_id: message.message_id,
            type: message.type,
            trace_id: message.trace_id,
            request_id: message.message_id,
          },
          "booking: lifecycle applied or stale",
        );
      },
    });
    await this.consumer.start();
  }
  async stop(): Promise<void> {
    await this.consumer?.stop();
  }
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
