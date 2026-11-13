import { Logger } from "@ticketing/common";
import { Env } from "../../config/env.schema";
import { IInvoiceAdapter } from "./invoice-adapter";
import { InvoiceRepository } from "./invoice.repository";

export class InvoiceRunner {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly adapter: IInvoiceAdapter,
    private readonly env: Env,
    private readonly logger: Logger,
    private readonly observe: (outcome: "issued" | "retry" | "failed" | "stale") => void = () =>
      undefined,
  ) {}

  async runOne(): Promise<boolean> {
    const job = await this.repo.claim(this.env);
    if (!job) return false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const context = {
      service: "finance",
      request_id: job.id,
      trace_id: job.id,
      invoice_id: job.id,
    };
    try {
      const result = await Promise.race([
        this.adapter.issue(job, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Invoice provider timeout"));
          }, this.env.INVOICE_TIMEOUT_MS);
        }),
      ]);
      const completed = await this.repo.complete(job, result.invoice_no, this.env);
      this.observe(completed ? "issued" : "stale");
      this.logger.info(
        { ...context, outcome: completed ? "issued" : "stale" },
        "Mock invoice attempt finished",
      );
    } catch {
      const saved = await this.repo.fail(job, this.env);
      const outcome = saved
        ? job.retry_count >= this.env.INVOICE_MAX_ATTEMPTS
          ? "failed"
          : "retry"
        : "stale";
      this.observe(outcome);
      // Không log lỗi provider thô: adapter thật có thể chứa PII/credential trong lỗi.
      this.logger.warn({ ...context, outcome }, "Mock invoice attempt unsuccessful");
    } finally {
      if (timer) clearTimeout(timer);
    }
    return true;
  }
}
