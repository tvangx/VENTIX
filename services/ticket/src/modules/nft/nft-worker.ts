import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Logger } from "@ticketing/common";
import { Topics } from "@ticketing/event-contracts";
import { createInboxConsumer, InboxConsumer } from "@ticketing/outbox-inbox";
import { Kafka, logLevel } from "kafkajs";
import { Counter } from "prom-client";
import { ENV, LOGGER } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { MetricsService } from "../../metrics/metrics";
import { TicketRepository } from "../tickets/ticket.repository";
import { MockMinter } from "./minter";
import { NftHandler } from "./nft.handler";
import { NftRepository } from "./nft.repository";
import { NftRunner } from "./nft-runner";

@Injectable()
export class NftWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private consumer?: InboxConsumer;
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Promise<void>;
  private stopped = false;
  private readonly runner: NftRunner;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly tickets: TicketRepository,
    private readonly handler: NftHandler,
    repo: NftRepository,
    metrics: MetricsService,
  ) {
    const outcomes = new Counter({
      name: "ticket_nft_attempts_total",
      help: "Persisted NFT mint attempt outcomes",
      labelNames: ["outcome"],
      registers: [metrics.registry],
    });
    this.runner = new NftRunner(
      repo,
      new MockMinter(),
      {
        maxAttempts: env.NFT_MAX_ATTEMPTS,
        leaseMs: env.NFT_LEASE_MS,
        timeoutMs: env.NFT_TIMEOUT_MS,
        retryBaseMs: env.NFT_RETRY_BASE_MS,
        retryMaxMs: env.NFT_RETRY_MAX_MS,
      },
      (job, outcome) => {
        outcomes.inc({ outcome });
        this.logger.info(
          {
            request_id: job.source_message_id,
            trace_id: job.trace_id,
            outcome,
            attempt: job.attempts,
          },
          "NFT mint attempt finished",
        );
      },
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NFT_WORKER_ENABLED !== "true") return;
    const kafka = new Kafka({
      clientId: "ticket-nft",
      brokers: this.env.KAFKA_BROKERS.split(",").map((broker) => broker.trim()),
      logLevel: logLevel.NOTHING,
    });
    this.consumer = createInboxConsumer({
      kafka,
      db: this.tickets.db,
      groupId: "ticket-nft-v1",
      consumerName: "ticket-nft-v1",
      topics: [Topics.TICKET_EVENTS],
      logger: this.logger,
      handler: (executor, message) => this.handler.handle(executor, message),
    });
    try {
      await this.consumer.start();
    } catch (error) {
      await this.consumer.stop();
      throw error;
    }
    this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.active = this.tick();
    }, delay);
  }

  private async tick(): Promise<void> {
    let delay = this.env.NFT_POLL_MS;
    try {
      if ((await this.runner.runOnce()) !== "IDLE") delay = 0;
    } catch {
      this.logger.warn(
        { request_id: "nft-worker", trace_id: "nft-worker" },
        "NFT queue unavailable; retrying on next poll",
      );
    } finally {
      this.schedule(delay);
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    const results = await Promise.allSettled([this.consumer?.stop(), this.active]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}
