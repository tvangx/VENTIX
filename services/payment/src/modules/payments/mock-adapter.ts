import { randomInt } from "node:crypto";
import { z } from "zod";
import {
  CreatePayment,
  IPaymentAdapter,
  Notification,
  PaymentLink,
  RefundInput,
  RefundResult,
} from "./payment-adapter";

export interface MockRefundLedger {
  find(input: RefundInput): Promise<boolean>;
  save(input: RefundInput): Promise<void>;
}

const notification = z.object({
  paymentId: z.string().uuid(),
  amountVnd: z.number().int().positive().safe(),
  providerTxnId: z.string().min(1),
  succeeded: z.boolean(),
  paidAt: z.coerce.date(),
  reason: z.string(),
});
export class MockAdapter implements IPaymentAdapter {
  constructor(
    private readonly config: {
      minDelayMs: number;
      maxDelayMs: number;
      successRate: number;
      outcome: "RANDOM" | "SUCCESS" | "FAILURE";
      duplicate: boolean;
      refundFailureRate?: number;
      refundOutcome?: "RANDOM" | "SUCCESS" | "FAILURE" | "LOST_RESPONSE";
    },
    private readonly random: () => number = () => randomInt(1000000) / 1000000,
    private readonly ledger?: MockRefundLedger,
  ) {}
  private readonly receipts = new Map<string, string>();
  createPayment(input: CreatePayment): PaymentLink {
    const delay =
      this.config.minDelayMs +
      Math.floor(this.random() * (this.config.maxDelayMs - this.config.minDelayMs + 1));
    const succeeded =
      this.config.outcome === "SUCCESS" ||
      (this.config.outcome === "RANDOM" && this.random() < this.config.successRate);
    const dueAt = new Date(input.createdAt.getTime() + delay);
    return {
      redirect_url: `https://mock.invalid/payments/${input.paymentId}`,
      mock: {
        dueAt: dueAt.toISOString(),
        duplicate: this.config.duplicate,
        notification: {
          paymentId: input.paymentId,
          amountVnd: input.amountVnd,
          providerTxnId: `mock-${input.paymentId}`,
          succeeded,
          paidAt: dueAt,
          reason: succeeded ? "00" : "MOCK_FAILED",
        },
      },
    };
  }
  // Chỉ được gọi trong process bởi worker; không có endpoint nhận mock IPN từ internet.
  verifyIpn(input: unknown): Notification | null {
    const result = notification.safeParse(input);
    return result.success ? result.data : null;
  }
  verifyReturn(input: unknown): Notification | null {
    return this.verifyIpn(input);
  }
  private fingerprint(input: RefundInput): string {
    return `${input.paymentId}:${input.amountVnd}`;
  }
  async refund(input: RefundInput): Promise<RefundResult> {
    if (
      this.receipts.has(input.refundId) &&
      this.receipts.get(input.refundId) !== this.fingerprint(input)
    )
      throw new Error("MOCK_REFUND_KEY_REUSED");
    const previous = await this.reconcileRefund(input);
    if (previous.status === "SUCCEEDED") return previous;
    const outcome = this.config.refundOutcome ?? "SUCCESS";
    if (
      outcome === "FAILURE" ||
      (outcome === "RANDOM" && this.random() < (this.config.refundFailureRate ?? 0))
    )
      return { status: "NOT_PERFORMED", code: "MOCK_NOT_PERFORMED" };
    if (this.ledger) await this.ledger.save(input);
    else this.receipts.set(input.refundId, this.fingerprint(input));
    if (outcome === "LOST_RESPONSE") throw new Error("MOCK_RESPONSE_LOST");
    return { status: "SUCCEEDED", providerRefundId: `mock-refund-${input.refundId}` };
  }
  async reconcileRefund(input: RefundInput): Promise<RefundResult> {
    const found = this.ledger
      ? await this.ledger.find(input)
      : this.receipts.get(input.refundId) === this.fingerprint(input);
    return found
      ? { status: "SUCCEEDED", providerRefundId: `mock-refund-${input.refundId}` }
      : { status: "UNKNOWN", code: "MOCK_NO_RECEIPT" };
  }
}
