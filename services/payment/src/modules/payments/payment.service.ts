import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Logger, ProblemException } from "@ticketing/common";
import { newMessage } from "@ticketing/event-contracts";
import { OutboxService } from "@ticketing/outbox-inbox";
import { uuidv7 } from "uuidv7";
import { ENV, LOGGER } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { PaymentPurpose, PaymentRepository, PaymentTransaction } from "./payment.repository";
import { MockAdapter } from "./mock-adapter";
import { VnpayAdapter } from "./vnpay-adapter";
import { MetricsService } from "../../metrics/metrics";
import { Notification, Provider } from "./payment-adapter";

export const IPN_CODES = {
  "00": "Confirm Success",
  "01": "Order not found",
  "02": "Order already confirmed",
  "04": "Invalid amount",
  "97": "Invalid signature",
  "99": "Unknown error",
} as const;
export type IpnCode = keyof typeof IPN_CODES;
@Injectable()
export class PaymentService {
  readonly mock: MockAdapter;
  readonly vnpay: VnpayAdapter;
  constructor(
    @Inject(PaymentRepository) private readonly repo: PaymentRepository,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly metrics: MetricsService,
  ) {
    this.mock = new MockAdapter({
      minDelayMs: env.MOCK_DELAY_MS,
      maxDelayMs: env.MOCK_MAX_DELAY_MS,
      successRate: env.MOCK_SUCCESS_RATE,
      outcome: env.MOCK_OUTCOME,
      duplicate: env.MOCK_DUPLICATE_IPN,
    });
    this.vnpay = new VnpayAdapter({
      tmnCode: env.VNPAY_TMN_CODE,
      secret: env.VNPAY_HASH_SECRET,
      returnUrl: env.VNPAY_RETURN_URL,
      paymentUrl: env.VNPAY_PAYMENT_URL,
    });
  }
  async create(
    user: string,
    key: string,
    orderId: string,
    provider: Provider,
    ip: string,
    traceId: string,
    purpose: PaymentPurpose = "ORDER",
  ): Promise<{ redirect_url: string }> {
    if (!key || key.length > 200 || !/^[\x21-\x7e]+$/.test(key))
      throw new ProblemException(
        "INVALID_IDEMPOTENCY_KEY",
        400,
        "Idempotency-Key is required (1-200 visible ASCII characters)",
      );
    const hash = createHash("sha256")
      // Giữ fingerprint ORDER cũ để replay các payment đã tạo trước T-405.
      .update(
        JSON.stringify({ user, orderId, provider, ...(purpose === "RESALE" ? { purpose } : {}) }),
      )
      .digest("hex");
    return this.repo.db.transaction(async (exec) => {
      const tx = new PaymentTransaction(exec);
      await tx.lockKey(key);
      const old = await tx.previous(key);
      if (old) {
        if (old.request_hash !== hash || old.user_id !== user)
          throw new ProblemException(
            "IDEMPOTENCY_KEY_REUSED",
            422,
            "Key belongs to another request",
          );
        return { redirect_url: old.redirect_url };
      }
      const payable = await tx.payable(orderId, purpose);
      const dbNow = await tx.now();
      if (!payable)
        throw new ProblemException("ORDER_NOT_READY", 409, "Order is not ready for payment");
      if (payable.user_id !== user)
        throw new ProblemException("PAYMENT_FORBIDDEN", 403, "Order belongs to another user");
      if (payable.status !== "READY" || payable.expires_at <= dbNow)
        throw new ProblemException("PAYABLE_EXPIRED", 409, "Payment window has closed");
      if (await tx.hasActive(orderId, purpose))
        throw new ProblemException(
          "PAYMENT_ALREADY_ACTIVE",
          409,
          "A payment is already pending or succeeded",
        );
      if (provider === "VNPAY" && !this.env.VNPAY_ENABLED)
        throw new ProblemException("PROVIDER_UNAVAILABLE", 503, "VNPay is not configured");
      const amountVnd = Number(payable.amount_vnd);
      if (
        !Number.isSafeInteger(amountVnd) ||
        amountVnd <= 0 ||
        (provider === "VNPAY" && amountVnd > 9999999999)
      )
        throw new ProblemException(
          "INVALID_PAYMENT_AMOUNT",
          422,
          "Amount cannot be represented by provider",
        );
      const id = uuidv7();
      const link = (provider === "MOCK" ? this.mock : this.vnpay).createPayment({
        paymentId: id,
        amountVnd,
        createdAt: dbNow,
        expiresAt: payable.expires_at,
        ipAddress: ip,
      });
      await tx.insert({
        id,
        order: orderId,
        purpose,
        user,
        payable,
        provider,
        amount: amountVnd,
        key,
        hash,
        link,
        trace: traceId,
      });
      return { redirect_url: link.redirect_url };
    });
  }
  async receive(provider: Provider, data: Notification, traceId: string): Promise<IpnCode> {
    const code = await this.repo.db.transaction<IpnCode>(async (exec) => {
      const tx = new PaymentTransaction(exec);
      const p = await tx.payment(data.paymentId);
      if (!p || p.provider !== provider) return "01";
      if (BigInt(p.amount_vnd) !== BigInt(data.amountVnd)) return "04";
      if (p.status !== "PENDING") return "02";
      // Failed VNPay payments can use TransactionNo=0. Scope that sentinel to the payment.
      const txnId = `${provider}:${data.providerTxnId === "0" ? `${p.id}:0` : data.providerTxnId}`;
      if (!(await tx.record(p, data, txnId))) return "99";
      await tx.transition(p, data);
      const base = {
        payment_id: p.id,
        purpose: p.purpose,
        ...(p.purpose === "RESALE" ? { resale_order_id: p.ref_id } : { order_id: p.ref_id }),
      };
      const message = data.succeeded
        ? newMessage(
            "PaymentSucceeded",
            {
              ...base,
              amount_vnd: data.amountVnd,
              provider,
              provider_txn_id: data.providerTxnId,
              paid_at: data.paidAt.toISOString(),
            },
            { trace_id: traceId },
          )
        : newMessage("PaymentFailed", { ...base, reason: data.reason }, { trace_id: traceId });
      await new OutboxService().add(exec, message, p.ref_id);
      return "00";
    });
    this.metrics.paymentResults.inc({ provider, code });
    this.logger.info(
      { payment_id: data.paymentId, provider, code, request_id: traceId, trace_id: traceId },
      "payment callback processed",
    );
    return code;
  }
}
