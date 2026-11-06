import { ProblemException } from "@ticketing/common";
import { SqlExecutor } from "@ticketing/outbox-inbox";

export const transitions = {
  PENDING: ["AWAITING_PAYMENT", "CANCELLED", "EXPIRED"],
  AWAITING_PAYMENT: ["CONFIRMED", "EXPIRED", "CANCELLED", "FAILED"],
  CONFIRMED: ["REFUNDED"],
  EXPIRED: ["REFUND_REQUIRED"],
  FAILED: ["REFUND_REQUIRED"],
  CANCELLED: ["REFUND_REQUIRED"],
  REFUND_REQUIRED: ["REFUNDED"],
  REFUNDED: [],
} as const;
export type OrderStatus = keyof typeof transitions;

export async function transition(
  exec: SqlExecutor,
  id: string,
  from: OrderStatus,
  to: OrderStatus,
  expectedVersion: number,
): Promise<void> {
  if (!(transitions[from] as readonly string[]).includes(to))
    throw new ProblemException(
      "INVALID_ORDER_TRANSITION",
      409,
      "Order transition is not permitted",
    );
  const rows = await exec.query(
    `UPDATE orders SET status=$3,version=version+1,updated_at=now()
     WHERE id=$1::uuid AND status=$2 AND version=$4 RETURNING id`,
    [id, from, to, expectedVersion],
  );
  if (rows.length !== 1)
    throw new ProblemException("ORDER_VERSION_CONFLICT", 409, "Order was changed concurrently");
}
