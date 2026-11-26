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
  it("refunds once and reconciles the same refund without repeating the effect", async () => {
    const a = new MockAdapter({
      minDelayMs: 0,
      maxDelayMs: 0,
      successRate: 1,
      outcome: "SUCCESS",
      duplicate: false,
    });
    const refund = {
      refundId: input.paymentId,
      paymentId: input.paymentId,
      amountVnd: 10000,
      transactionDate: "20260101070000",
      providerTxnId: "123",
      sentAt: input.createdAt,
      actorId: input.paymentId,
    };
    const result = await a.refund(refund);
    expect(result.status).toBe("SUCCEEDED");
    expect(await a.refund(refund)).toEqual(result);
    expect(await a.reconcileRefund(refund)).toEqual(result);
    await expect(a.refund({ ...refund, amountVnd: 1 })).rejects.toThrow("MOCK_REFUND_KEY_REUSED");
  });
  it("supports deterministic failures and response loss with receipt reconciliation", async () => {
    const config = {
      minDelayMs: 0,
      maxDelayMs: 0,
      successRate: 1,
      outcome: "SUCCESS" as const,
      duplicate: false,
    };
    const refund = {
      refundId: input.paymentId,
      paymentId: input.paymentId,
      amountVnd: 10000,
      transactionDate: "20260101070000",
      providerTxnId: "123",
      sentAt: input.createdAt,
      actorId: input.paymentId,
    };
    for (const options of [
      { refundOutcome: "FAILURE" as const },
      { refundOutcome: "RANDOM" as const, refundFailureRate: 1 },
    ]) {
      const a = new MockAdapter({ ...config, ...options }, () => 0);
      expect(await a.refund(refund)).toEqual({
        status: "NOT_PERFORMED",
        code: "MOCK_NOT_PERFORMED",
      });
      expect((await a.reconcileRefund(refund)).status).toBe("UNKNOWN");
    }
    const lost = new MockAdapter({ ...config, refundOutcome: "LOST_RESPONSE" });
    await expect(lost.refund(refund)).rejects.toThrow("MOCK_RESPONSE_LOST");
    expect((await lost.reconcileRefund(refund)).status).toBe("SUCCEEDED");
  });
});
