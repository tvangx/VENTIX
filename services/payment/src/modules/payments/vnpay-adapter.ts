import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { CreatePayment, IPaymentAdapter, Notification, PaymentLink } from "./payment-adapter";

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
    private readonly config: { tmnCode: string; secret: string; returnUrl: string },
    private readonly now: () => Date = () => new Date(),
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
      redirect_url: `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?${canonicalQuery(params)}&vnp_SecureHash=${this.sign(params)}`,
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
  async refund(): Promise<never> {
    throw new Error("Refund not implemented; T-401");
  }
}
