import { transition, transitions } from "./order-state";
import { SqlExecutor } from "@ticketing/outbox-inbox";

describe("ADR-0009 state machine", () => {
  it("rejects invalid transitions before issuing SQL", async () => {
    const exec = { query: jest.fn() };
    await expect(transition(exec, "id", "PENDING", "CONFIRMED", 0)).rejects.toThrow();
    expect(exec.query).not.toHaveBeenCalled();
    expect(transitions.REFUNDED).toEqual([]);
  });
  it("requires exactly one matching version and status", async () => {
    const query = jest.fn().mockResolvedValue([]);
    await expect(
      transition({ query } as SqlExecutor, "id", "PENDING", "AWAITING_PAYMENT", 0),
    ).rejects.toThrow();
    expect(query.mock.calls[0][0]).toContain("version=$4");
    query.mockResolvedValue([{ id: "id" }]);
    await expect(
      transition({ query } as SqlExecutor, "id", "PENDING", "AWAITING_PAYMENT", 0),
    ).resolves.toBeUndefined();
  });
});
