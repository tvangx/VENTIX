import { randomUUID } from "node:crypto";
import { newMessage } from "@ticketing/event-contracts";
import { confirmedOrder, fixture } from "../support/ticket";

describe("S-303 issue/refund race", () => {
  it("50 competing confirmations/refunds leave no active tickets or secrets", async () => {
    const context = await fixture();
    try {
      const order = confirmedOrder();
      const refund = newMessage("RefundCompleted", {
        refund_id: randomUUID(),
        order_id: order.data.order_id,
        payment_id: order.data.payment_id,
        amount_vnd: order.data.total_amount_vnd,
      });
      const outcomes = await Promise.all(
        Array.from({ length: 50 }, (_, index) =>
          context.deliver({ ...(index % 2 ? refund : order), message_id: randomUUID() }),
        ),
      );
      expect(outcomes.every((outcome) => outcome === "processed")).toBe(true);
      expect(
        (
          await context.repo.pool.query(
            "SELECT * FROM tickets WHERE order_id=$1 AND status <> 'REFUNDED'",
            [order.data.order_id],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await context.repo.pool.query(
            "SELECT secret.* FROM ticket_secrets secret JOIN tickets ticket ON ticket.id=secret.ticket_id WHERE ticket.order_id=$1 AND secret.revoked_at IS NULL",
            [order.data.order_id],
          )
        ).rowCount,
      ).toBe(0);
      const rows = await context.repo.pool.query(
        "SELECT status FROM ticket_order_invalidations WHERE order_id=$1",
        [order.data.order_id],
      );
      expect(rows.rows).toEqual([{ status: "REFUNDED" }]);
    } finally {
      await context.close();
    }
  });
});
