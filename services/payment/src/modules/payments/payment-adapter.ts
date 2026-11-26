export type Provider = "VNPAY" | "MOCK";
export interface CreatePayment {
  paymentId: string;
  amountVnd: number;
  expiresAt: Date;
  createdAt: Date;
  ipAddress: string;
}
export interface Notification {
  paymentId: string;
  amountVnd: number;
  providerTxnId: string;
  succeeded: boolean;
  paidAt: Date;
  reason: string;
}
export interface PaymentLink {
  redirect_url: string;
  mock?: { dueAt: string; notification: Notification; duplicate: boolean };
}
export interface IPaymentAdapter {
  createPayment(input: CreatePayment): PaymentLink;
  verifyReturn(input: unknown): Notification | null;
  verifyIpn(input: unknown): Notification | null;
  refund(input: RefundInput): Promise<RefundResult>;
  reconcileRefund(input: RefundInput): Promise<RefundResult>;
}

export interface RefundInput {
  refundId: string;
  paymentId: string;
  amountVnd: number;
  transactionDate: string;
  providerTxnId: string;
  sentAt: Date;
  actorId: string;
}
export type RefundResult =
  | { status: "SUCCEEDED"; providerRefundId: string }
  | { status: "NOT_PERFORMED"; code: string }
  | { status: "UNKNOWN"; code: string };
