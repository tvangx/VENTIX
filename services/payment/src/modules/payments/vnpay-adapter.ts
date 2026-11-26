import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  CreatePayment,
  IPaymentAdapter,
  Notification,
  PaymentLink,
  RefundInput,
  RefundResult,
} from "./payment-adapter";

/** VNPay 2.1.0 Node demo: encodeURIComponent(value).replace(/%20/g, '+'), then encode:false. */
export function canonicalQuery(params: Record<string, string>): string {
  const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, "+");
  return Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key])}`)
    .join("&");
}
export function gmt7(date: Date): string {
  return new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 19).replace(/[-:T]/g, "");
}
function parsePayDate(value: string): Date | null {
  if (!/^\d{14}$/.test(value)) return null;
  const date = new Date(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+07:00`,
  );
  return Number.isFinite(date.getTime()) && gmt7(date) === value ? date : null;
}
const fields = z.record(z.string().max(2048));
export class VnpayAdapter implements IPaymentAdapter {
  constructor(
    private readonly config: {
      tmnCode: string;
      secret: string;
      returnUrl: string;
      paymentUrl?: string;
      refundUrl?: string;
      refundEnabled?: boolean;
      refundIp?: string;
      refundTimeoutMs?: number;
    },
    private readonly now: () => Date = () => new Date(),
    private readonly transport: typeof fetch = fetch,
  ) {}
  sign(params: Record<string, string>): string {
    return createHmac("sha512", this.config.secret)
      .update(canonicalQuery(params), "utf8")
      .digest("hex");
  }
  createPayment(input: CreatePayment): PaymentLink {
    if (
      !Number.isSafeInteger(input.amountVnd) ||
      input.amountVnd <= 0 ||
      input.amountVnd > 9999999999
    )
      throw new Error("VNPay amount must be positive integer VND, at most 12 digits after x100");
    const params = {
      vnp_Version: "2.1.0",
      vnp_Command: "pay",
      vnp_TmnCode: this.config.tmnCode,
      vnp_Amount: String(input.amountVnd * 100),
      vnp_CurrCode: "VND",
      vnp_Locale: "vn",
      vnp_TxnRef: input.paymentId.replace(/-/g, ""),
      vnp_OrderInfo: `Thanh toan ${input.paymentId.replace(/-/g, "")}`,
      vnp_OrderType: "other",
      vnp_ReturnUrl: this.config.returnUrl,
      vnp_IpAddr: input.ipAddress,
      vnp_CreateDate: gmt7(input.createdAt),
      vnp_ExpireDate: gmt7(input.expiresAt),
    };
    return {
      redirect_url: `${this.config.paymentUrl ?? "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"}?${canonicalQuery(params)}&vnp_SecureHash=${this.sign(params)}`,
    };
  }
  verifyIpn(input: unknown): Notification | null {
    const parsed = fields.safeParse(input);
    if (!parsed.success) return null;
    const params = { ...parsed.data };
    const hash = params.vnp_SecureHash;
    delete params.vnp_SecureHash;
    delete params.vnp_SecureHashType;
    if (!hash || !/^[a-f\d]{128}$/i.test(hash) || !this.config.secret) return null;
    if (!timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(this.sign(params), "hex")))
      return null;
    const p = params;
    if (
      p.vnp_TmnCode !== this.config.tmnCode ||
      !/^[A-Za-z0-9]{3,20}$/.test(p.vnp_BankCode ?? "") ||
      !p.vnp_OrderInfo ||
      p.vnp_OrderInfo.length > 255 ||
      !/^[a-f\d]{32}$/i.test(p.vnp_TxnRef ?? "") ||
      !/^\d{1,12}$/.test(p.vnp_Amount ?? "") ||
      !/^\d{1,15}$/.test(p.vnp_TransactionNo ?? "") ||
      !/^\d{2}$/.test(p.vnp_ResponseCode ?? "") ||
      !/^\d{2}$/.test(p.vnp_TransactionStatus ?? "")
    )
      return null;
    const amount = Number(p.vnp_Amount);
    const paidAt = p.vnp_PayDate ? parsePayDate(p.vnp_PayDate) : this.now();
    if (!paidAt || amount % 100 !== 0 || amount <= 0) return null;
    const ref = p.vnp_TxnRef.toLowerCase();
    const paymentId = `${ref.slice(0, 8)}-${ref.slice(8, 12)}-${ref.slice(12, 16)}-${ref.slice(16, 20)}-${ref.slice(20)}`;
    return {
      paymentId,
      amountVnd: amount / 100,
      providerTxnId: p.vnp_TransactionNo,
      succeeded: p.vnp_ResponseCode === "00" && p.vnp_TransactionStatus === "00",
      paidAt,
      reason: `${p.vnp_ResponseCode}/${p.vnp_TransactionStatus}`,
    };
  }
  verifyReturn(input: unknown): Notification | null {
    return this.verifyIpn(input);
  }
  private pipeSign(params: Record<string, string>, order: readonly string[]): string {
    return createHmac("sha512", this.config.secret)
      .update(order.map((k) => params[k] ?? "").join("|"), "utf8")
      .digest("hex");
  }
  private async post(
    params: Record<string, string>,
    order: readonly string[],
    responseOrder: readonly string[],
  ): Promise<Record<string, string> | null> {
    const endpoint = this.config.refundUrl;
    if (
      !this.config.refundEnabled ||
      endpoint !== "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction" ||
      !this.config.secret
    )
      return null;
    try {
      const res = await this.transport(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, vnp_SecureHash: this.pipeSign(params, order) }),
        signal: AbortSignal.timeout(this.config.refundTimeoutMs ?? 10000),
      });
      if (!res.ok) return null;
      const body = await res.text();
      if (body.length > 65536) return null;
      const parsed = fields.safeParse(JSON.parse(body) as unknown);
      if (!parsed.success) return null;
      const p = parsed.data,
        hash = p.vnp_SecureHash;
      if (
        !hash ||
        !/^[a-f\d]{128}$/i.test(hash) ||
        !timingSafeEqual(
          Buffer.from(hash, "hex"),
          Buffer.from(this.pipeSign(p, responseOrder), "hex"),
        )
      )
        return null;
      return p;
    } catch {
      return null;
    }
  }
  private request(input: RefundInput, command: string): Record<string, string> {
    if (
      !Number.isSafeInteger(input.amountVnd) ||
      input.amountVnd <= 0 ||
      input.amountVnd > 9999999999 ||
      !/^\d{14}$/.test(input.transactionDate) ||
      !/^\d{1,15}$/.test(input.providerTxnId)
    )
      throw new Error("INVALID_REFUND_PAYMENT_DATA");
    return {
      vnp_RequestId:
        command === "refund" ? input.refundId.replace(/-/g, "") : randomUUID().replace(/-/g, ""),
      vnp_Version: "2.1.0",
      vnp_Command: command,
      vnp_TmnCode: this.config.tmnCode,
      vnp_TxnRef: input.paymentId.replace(/-/g, ""),
      vnp_Amount: String(input.amountVnd * 100),
      vnp_TransactionNo: input.providerTxnId,
      vnp_TransactionDate: input.transactionDate,
      vnp_CreateDate: gmt7(command === "refund" ? input.sentAt : this.now()),
      vnp_IpAddr: this.config.refundIp ?? "127.0.0.1",
      vnp_OrderInfo: `Refund ${input.refundId.replace(/-/g, "")}`,
    };
  }
  async refund(input: RefundInput): Promise<RefundResult> {
    const params: Record<string, string> = {
      ...this.request(input, "refund"),
      vnp_TransactionType: "02",
      vnp_CreateBy: input.actorId,
    };
    const p = await this.post(params, REFUND_REQUEST_FIELDS, REFUND_RESPONSE_FIELDS);
    if (
      !p ||
      p.vnp_Command !== "refund" ||
      p.vnp_TmnCode !== params.vnp_TmnCode ||
      p.vnp_TxnRef !== params.vnp_TxnRef ||
      p.vnp_Amount !== params.vnp_Amount ||
      p.vnp_OrderInfo !== params.vnp_OrderInfo ||
      p.vnp_TransactionType !== "02"
    )
      return { status: "UNKNOWN", code: "VNPAY_UNVERIFIED_REFUND" };
    if (
      p.vnp_ResponseCode === "00" &&
      p.vnp_TransactionStatus === "00" &&
      /^\d{1,15}$/.test(p.vnp_TransactionNo ?? "")
    )
      return { status: "SUCCEEDED", providerRefundId: p.vnp_TransactionNo };
    // Ngay cả lỗi có chữ ký cũng chưa đủ để cho phép gửi lại lệnh tiền.
    return {
      status: "UNKNOWN",
      code: `VNPAY_REFUND_${/^\d{2}$/.test(p.vnp_ResponseCode) ? p.vnp_ResponseCode : "INVALID"}_${/^\d{2}$/.test(p.vnp_TransactionStatus) ? p.vnp_TransactionStatus : "INVALID"}`,
    };
  }
  async reconcileRefund(input: RefundInput): Promise<RefundResult> {
    const params = this.request(input, "querydr");
    delete params.vnp_Amount;
    const p = await this.post(params, QUERY_REQUEST_FIELDS, QUERY_RESPONSE_FIELDS);
    // Tài liệu chưa bảo đảm tra refund theo RequestId; payment 00 không chứng minh đã hoàn tiền.
    if (
      !p ||
      p.vnp_Command !== "querydr" ||
      p.vnp_TmnCode !== params.vnp_TmnCode ||
      p.vnp_TxnRef !== params.vnp_TxnRef
    )
      return { status: "UNKNOWN", code: "VNPAY_UNVERIFIED_QUERY" };
    return { status: "UNKNOWN", code: "VNPAY_REFUND_REQUIRES_MANUAL_EVIDENCE" };
  }
}

export const REFUND_REQUEST_FIELDS = [
  "vnp_RequestId",
  "vnp_Version",
  "vnp_Command",
  "vnp_TmnCode",
  "vnp_TransactionType",
  "vnp_TxnRef",
  "vnp_Amount",
  "vnp_TransactionNo",
  "vnp_TransactionDate",
  "vnp_CreateBy",
  "vnp_CreateDate",
  "vnp_IpAddr",
  "vnp_OrderInfo",
] as const;
export const REFUND_RESPONSE_FIELDS = [
  "vnp_ResponseId",
  "vnp_Command",
  "vnp_ResponseCode",
  "vnp_Message",
  "vnp_TmnCode",
  "vnp_TxnRef",
  "vnp_Amount",
  "vnp_BankCode",
  "vnp_PayDate",
  "vnp_TransactionNo",
  "vnp_TransactionType",
  "vnp_TransactionStatus",
  "vnp_OrderInfo",
] as const;
export const QUERY_REQUEST_FIELDS = [
  "vnp_RequestId",
  "vnp_Version",
  "vnp_Command",
  "vnp_TmnCode",
  "vnp_TxnRef",
  "vnp_TransactionDate",
  "vnp_CreateDate",
  "vnp_IpAddr",
  "vnp_OrderInfo",
] as const;
export const QUERY_RESPONSE_FIELDS = [
  ...REFUND_RESPONSE_FIELDS,
  "vnp_PromotionCode",
  "vnp_PromotionAmount",
] as const;
