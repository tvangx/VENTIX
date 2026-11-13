import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Logger } from "@ticketing/common";
import { Counter } from "prom-client";
import { ENV, LOGGER } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { MetricsService } from "../../metrics/metrics";
import { MockAdapter } from "./invoice-adapter";
import { InvoiceRepository } from "./invoice.repository";
import { InvoiceRunner } from "./invoice-runner";

@Injectable()
export class InvoiceWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private readonly runner: InvoiceRunner;
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly repo: InvoiceRepository,
    metrics: MetricsService,
  ) {
    const attempts = new Counter({
      name: "finance_invoice_attempts_total",
      help: "Mock invoice attempts",
      labelNames: ["outcome"],
      registers: [metrics.registry],
    });
    this.runner = new InvoiceRunner(repo, new MockAdapter(), env, logger, (outcome) =>
      attempts.inc({ outcome }),
    );
  }
  onApplicationBootstrap(): void {
    if (this.env.INVOICE_WORKER_ENABLED !== "true") return;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), this.env.INVOICE_POLL_MS);
  }
  private schedule(): void {
    if (this.pending) return;
    this.pending = this.tick()
      .catch(() => {
        this.logger.error(
          { service: "finance", request_id: "invoice-worker", trace_id: "invoice-worker" },
          "Invoice worker tick failed",
        );
      })
      .finally(() => {
        this.pending = undefined;
      });
  }
  private async tick(): Promise<void> {
    await this.repo.materialize();
    // Giới hạn mỗi tick để shutdown không phải đợi hết backlog.
    await this.runner.runOne();
  }
  async beforeApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pending;
  }
}
