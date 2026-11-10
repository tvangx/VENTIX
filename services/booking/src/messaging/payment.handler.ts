import { InboxHandler, PermanentError } from "@ticketing/outbox-inbox";
import { confirmPayment, SagaOrder } from "../orders/order-saga";
import { transition } from "../orders/order-state";

export const paymentHandler: InboxHandler = async (exec, message) => {
  if (
    message.type !== "PaymentSucceeded" &&
    message.type !== "PaymentFailed" &&
    message.type !== "RefundCompleted"
  )
    return;
  if (message.type !== "RefundCompleted" && message.data.purpose !== "ORDER") return;
  const id = message.data.order_id;
  if (!id) throw new PermanentError("ORDER payment requires order_id");
  const [order] = await exec.query<SagaOrder>("SELECT * FROM orders WHERE id=$1::uuid FOR UPDATE", [
    id,
  ]);
  if (!order) throw new Error("Payment order not visible yet");
  if (message.type === "PaymentSucceeded") await confirmPayment(exec, order, message);
  // PaymentFailed chỉ ghi nhận bằng Inbox, không hủy order (ADR-0009 D7).
  if (
    message.type === "RefundCompleted" &&
    (order.status === "REFUND_REQUIRED" || order.status === "CONFIRMED")
  )
    await transition(exec, id, order.status, "REFUNDED", order.version);
};
