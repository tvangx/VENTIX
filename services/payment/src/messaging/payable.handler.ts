import { InboxHandler, PermanentError } from "@ticketing/outbox-inbox";
import { uuidv7 } from "uuidv7";
import { lockRefundEvent } from "../modules/refunds/refund.handler";

export const payableHandler: InboxHandler = async (exec, message) => {
  if (message.type !== "OrderAwaitingPayment" && message.type !== "ResaleOrderAwaitingPayment")
    return;
  const d = message.data;
  const [purpose, refId, userId] =
    message.type === "OrderAwaitingPayment"
      ? ["ORDER", message.data.order_id, message.data.user_id]
      : ["RESALE", message.data.resale_order_id, message.data.buyer_id];
  if (!Number.isSafeInteger(d.amount_vnd)) throw new PermanentError("Unsafe payable amount");
  await lockRefundEvent(exec, d.event_id);
  // OrderAwaitingPayment là snapshot bất biến; replay không hồi sinh payable đã đóng.
  await exec.query(
    "INSERT INTO payables(id,purpose,ref_id,user_id,event_id,amount_vnd,expires_at,status) VALUES($1::uuid,$7::varchar,$2::uuid,$3::uuid,$4::uuid,$5,$6,CASE WHEN $7::varchar='ORDER' AND EXISTS(SELECT 1 FROM refund_events WHERE id=$4::uuid AND cancelled=true) THEN 'CANCELLED' ELSE 'READY' END) ON CONFLICT(purpose,ref_id) DO NOTHING RETURNING id",
    [uuidv7(), refId, userId, d.event_id, d.amount_vnd, d.expires_at, purpose],
  );
};
