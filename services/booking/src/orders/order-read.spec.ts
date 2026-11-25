import { OrderReadService } from "./order-read";
import { CheckoutRepository } from "../checkout/checkout.repository";
describe("owner order read", () => {
  it("filters the database query by both order and authenticated owner", async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] });
    const service = new OrderReadService({ pool: { query } } as unknown as CheckoutRepository);
    await expect(service.get("order", "another-user")).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND",
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("id=$1 AND user_id=$2"), [
      "order",
      "another-user",
    ]);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("returns server state and integer money with immutable items", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "order",
            event_id: "event",
            status: "CONFIRMED",
            total_amount_vnd: "350000",
            ticket_amount_vnd: "350000",
            merch_amount_vnd: "0",
            expires_at: new Date("2026-11-26T00:00:00Z"),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const service = new OrderReadService({ pool: { query } } as unknown as CheckoutRepository);
    expect(await service.get("order", "owner")).toMatchObject({
      status: "CONFIRMED",
      total_amount_vnd: 350000,
    });
  });
});
