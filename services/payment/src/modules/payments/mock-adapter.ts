import { randomInt } from "node:crypto";
import { z } from "zod";
import { CreatePayment, IPaymentAdapter, Notification, PaymentLink } from "./payment-adapter";

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
    },
    private readonly random: () => number = () => randomInt(1000000) / 1000000,
  ) {}
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
  async refund(): Promise<never> {
    throw new Error("Refund not implemented; T-401");
  }
}
