import { InboxHandler, PermanentError } from "@ticketing/outbox-inbox";
import { uuidv7 } from "uuidv7";

export const payableHandler: InboxHandler = async (exec, message) => {
  if (message.type !== "OrderAwaitingPayment" && message.type !== "ResaleOrderAwaitingPayment")
    return;
  const d = message.data;
  const [purpose, refId, userId] =
    message.type === "OrderAwaitingPayment"
      ? ["ORDER", message.data.order_id, message.data.user_id]
      : ["RESALE", message.data.resale_order_id, message.data.buyer_id];
  if (!Number.isSafeInteger(d.amount_vnd)) throw new PermanentError("Unsafe payable amount");
  // OrderAwaitingPayment là snapshot bất biến; replay không hồi sinh payable đã đóng.
  await exec.query(
    "INSERT INTO payables(id,purpose,ref_id,user_id,event_id,amount_vnd,expires_at) VALUES($1::uuid,$7,$2::uuid,$3::uuid,$4::uuid,$5,$6) ON CONFLICT(purpose,ref_id) DO NOTHING RETURNING id",
    [uuidv7(), refId, userId, d.event_id, d.amount_vnd, d.expires_at, purpose],
  );
};
