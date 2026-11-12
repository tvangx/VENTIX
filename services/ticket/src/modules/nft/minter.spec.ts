import { randomUUID } from "node:crypto";
import { MockMinter, mintRequest, retryDelayMs } from "./minter";

describe("S-502 MockMinter", () => {
  const ticketId = randomUUID();
  const eventId = randomUUID();

  it("returns the same mock token across concurrent calls and process restarts", async () => {
    const request = mintRequest(ticketId, eventId);
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        new MockMinter().mint(request, new AbortController().signal),
      ),
    );
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    expect(results[0]).toMatchObject({ provider: "MOCK", txHash: null });
    expect(results[0].mockReference).toMatch(/^mock:[a-f0-9]{64}$/);
  });

  it("uses different keys for different tickets and allowlists public metadata", async () => {
    const first = mintRequest(ticketId, eventId);
    const second = mintRequest(randomUUID(), eventId);
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(first.metadata).toEqual({
      name: "VENTIX ticket",
      ticket_id: ticketId,
      event_id: eventId,
    });
    const signal = new AbortController().signal;
    expect(await new MockMinter().mint(first, signal)).not.toEqual(
      await new MockMinter().mint(second, signal),
    );
  });

  it("honors cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new MockMinter().mint(mintRequest(ticketId, eventId), controller.signal),
    ).rejects.toThrow();
  });

  it("bounds exponential backoff and jitter", () => {
    expect(retryDelayMs(1, 100, 1000, () => 0)).toBe(50);
    expect(retryDelayMs(1, 100, 1000, () => 1)).toBe(100);
    expect(retryDelayMs(4, 100, 1000, () => 1)).toBe(800);
    expect(retryDelayMs(100, 100, 1000, () => 1)).toBe(1000);
  });
});
