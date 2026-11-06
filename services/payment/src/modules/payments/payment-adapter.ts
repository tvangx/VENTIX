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
  refund(): Promise<never>;
}
