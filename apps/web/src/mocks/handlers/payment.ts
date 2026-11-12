import { HttpResponse } from "msw";
import { SERVICE_PREFIX, type PaymentPaths } from "@/lib/api";
import { mockId, state } from "../db";
import { markOrderSeatsSold } from "./booking";
import { authenticate, idempotent, mockService, problem, UUID_RE } from "./typed";

const api = mockService<PaymentPaths>(SERVICE_PREFIX.payment);

/** Trang frontend nhận kết quả VNPay (route sẽ làm ở màn checkout; đổi tại đây nếu khác). */
export const VNPAY_RETURN_PATH = "/payment/vnpay-return";

function paid(paymentId: string): void {
  const payment = state.payments.get(paymentId);
  const order = payment && state.orders.get(payment.orderId);
  if (!order || order.status === "PAID") return;
  order.status = "PAID";
  markOrderSeatsSold(order);
}

export const paymentHandlers = [
  api.get("/v1/whoami", ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    return HttpResponse.json({ userId: auth.grant.userId, roles: auth.roles });
  }),

  api.post("/v1/payments", async ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (!UUID_RE.test(key)) return problem(400, "INVALID_INPUT", "Thiếu Idempotency-Key (UUID)");
    const body = await request.json();
    if (!!body?.order_id === !!body?.resale_order_id) {
      return problem(400, "INVALID_INPUT", "Cần đúng một trong order_id hoặc resale_order_id");
    }
    if (body.resale_order_id) {
      // Resale chưa có OpenAPI (S-405) nên mock chưa có đơn resale nào.
      return problem(409, "ORDER_NOT_READY", "Đơn resale chưa sẵn sàng thanh toán");
    }
    const idem = idempotent<{ redirect_url: string }>(`payment:${auth.grant.userId}`, key, body);
    if (idem.conflict) {
      return problem(422, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key đã dùng cho yêu cầu khác");
    }
    if (idem.replay) return HttpResponse.json(idem.replay, { status: 201 });

    const order = state.orders.get(String(body.order_id));
    if (!order) return problem(409, "ORDER_NOT_READY", "Đơn chưa sẵn sàng thanh toán");
    if (order.user_id !== auth.grant.userId) {
      return problem(403, "PAYMENT_FORBIDDEN", "Không phải đơn của bạn");
    }
    if (order.status !== "AWAITING_PAYMENT" || Date.parse(order.expires_at) <= Date.now()) {
      return problem(409, "PAYABLE_EXPIRED", "Đơn đã thanh toán hoặc hết hạn");
    }
    const paymentId = mockId("50000000");
    state.payments.set(paymentId, { orderId: order.id, amount: order.total_amount_vnd });

    let redirectUrl: string;
    if (body.provider === "MOCK") {
      // Giống MockAdapter của payment-service: thành công ngay, URL không dẫn tới đâu.
      paid(paymentId);
      redirectUrl = `https://mock.invalid/payments/${paymentId}`;
    } else {
      // Giả VNPay redirect người dùng về trang return của frontend với kết quả thành công.
      const query = new URLSearchParams({
        vnp_TmnCode: "MOCKTMN",
        vnp_Amount: String(order.total_amount_vnd * 100),
        vnp_BankCode: "NCB",
        vnp_OrderInfo: `Thanh toan don ${order.id}`,
        vnp_TransactionNo: "14000000",
        vnp_ResponseCode: "00",
        vnp_TransactionStatus: "00",
        vnp_TxnRef: paymentId,
        vnp_SecureHash: "mock",
      });
      redirectUrl = `${new URL(request.url).origin}${VNPAY_RETURN_PATH}?${query}`;
    }
    const response = { redirect_url: redirectUrl };
    idem.save(response);
    return HttpResponse.json(response, { status: 201 });
  }),

  // Bản thật chỉ kiểm chữ ký; trạng thái đơn đổi qua IPN. Mock gộp IPN vào đây cho đủ luồng UI.
  api.get("/v1/payments/vnpay/return", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const succeeded =
      query.get("vnp_ResponseCode") === "00" && query.get("vnp_TransactionStatus") === "00";
    const paymentId = query.get("vnp_TxnRef") ?? "";
    if (succeeded) paid(paymentId);
    return HttpResponse.json({
      signature_valid: state.payments.has(paymentId),
      provider_succeeded: succeeded,
    });
  }),
];
