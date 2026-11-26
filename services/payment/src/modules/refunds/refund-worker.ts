import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Logger } from "@ticketing/common";
import { ENV, LOGGER } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { MetricsService } from "../../metrics/metrics";
import { PaymentService } from "../payments/payment.service";
import { RefundClaim, RefundRepository } from "./refund.repository";
import { RefundResult } from "../payments/payment-adapter";

@Injectable()
export class RefundWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private running: Promise<void> = Promise.resolve();
  private stopping = false;
  constructor(
    private readonly repo: RefundRepository,
    private readonly payments: PaymentService,
    private readonly metrics: MetricsService,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}
  onApplicationBootstrap(): void {
    if (this.env.PAYMENT_WORKERS_ENABLED) this.schedule();
  }
  private schedule(): void {
    this.running = this.tick()
      .catch(() => {
        this.logger.error(
          { request_id: "refund-worker", trace_id: "refund-worker" },
          "refund worker failed; durable claim will recover",
        );
      })
      .finally(() => {
        if (!this.stopping)
          this.timer = setTimeout(
            () => this.schedule(),
            Math.max(10, Math.min(100, 1000 / this.env.REFUND_RATE_PER_SEC)),
          );
      });
  }
  async tick(): Promise<void> {
    const pending: Promise<void>[] = [];
    let failure: unknown;
    try {
      for (let i = 0; i < this.env.REFUND_CONCURRENCY && !this.stopping; i++) {
        const row = await this.repo.claim();
        if (!row) break;
        pending.push(
          this.process(row).catch((error) => {
            failure ??= error;
          }),
        );
      }
    } finally {
      // Kể cả claim sau lỗi DB, vẫn chờ công việc đã khởi động trước khi shutdown.
      await Promise.all(pending);
    }
    if (failure) throw failure;
  }
  async process(row: RefundClaim): Promise<void> {
    const adapter = row.provider === "MOCK" ? this.payments.mock : this.payments.vnpay;
    let result: RefundResult;
    try {
      const input = this.repo.input(row);
      result = row.reconcile ? await adapter.reconcileRefund(input) : await adapter.refund(input);
    } catch {
      // Lần claim sau chỉ đối soát, qua cùng giới hạn tốc độ/concurrency và backoff.
      result = { status: "UNKNOWN", code: "PROVIDER_RESULT_UNKNOWN" };
    }
    const status = await this.repo.finish(row, result);
    if (!status) return;
    this.metrics.refunds.inc({ status });
    this.logger.info(
      {
        request_id: row.id,
        trace_id: row.trace_id,
        refund_id: row.id,
        payment_id: row.payment_id,
        batch_id: row.batch_id,
        status,
        attempt: row.attempts,
        reconcile: row.reconcile,
      },
      "refund attempt recorded",
    );
  }
  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.timer);
    await this.running;
  }
}
