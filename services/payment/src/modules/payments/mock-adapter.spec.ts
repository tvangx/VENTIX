import { MockAdapter } from "./mock-adapter";

describe("MockAdapter", () => {
  const input = {
    paymentId: "11111111-1111-4111-8111-111111111111",
    amountVnd: 10000,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    expiresAt: new Date("2026-01-01T00:15:00Z"),
    ipAddress: "127.0.0.1",
  };
  it.each(["SUCCESS", "FAILURE"] as const)(
    "supports deterministic %s and duplicate callback",
    (outcome) => {
      const a = new MockAdapter(
        { minDelayMs: 10, maxDelayMs: 20, successRate: 0.5, outcome, duplicate: true },
        () => 0.5,
      );
      const result = a.createPayment(input);
      expect(result.mock?.dueAt).toBe("2026-01-01T00:00:00.015Z");
      expect(result.mock?.duplicate).toBe(true);
      expect(a.verifyIpn(JSON.parse(JSON.stringify(result.mock?.notification)))).toMatchObject({
        succeeded: outcome === "SUCCESS",
        paidAt: new Date("2026-01-01T00:00:00.015Z"),
      });
    },
  );
  it("honors random success-rate boundaries and rejects malformed callback", () => {
    const a = new MockAdapter(
      { minDelayMs: 0, maxDelayMs: 0, successRate: 0, outcome: "RANDOM", duplicate: false },
      () => 0,
    );
    expect(a.createPayment(input).mock?.notification.succeeded).toBe(false);
    expect(a.verifyIpn({})).toBeNull();
    expect(a.verifyReturn(a.createPayment(input).mock?.notification)?.succeeded).toBe(false);
  });
  it("leaves refund to T-401", async () => {
    const a = new MockAdapter({
      minDelayMs: 0,
      maxDelayMs: 0,
      successRate: 1,
      outcome: "SUCCESS",
      duplicate: false,
    });
    await expect(a.refund()).rejects.toThrow("T-401");
  });
});
