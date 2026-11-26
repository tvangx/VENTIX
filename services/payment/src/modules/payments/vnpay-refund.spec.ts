import { createHmac } from "node:crypto";
import { VnpayAdapter } from "./vnpay-adapter";
import { RefundInput } from "./payment-adapter";

const input: RefundInput = {
  refundId: "11111111-1111-4111-8111-111111111111",
  paymentId: "22222222-2222-4222-8222-222222222222",
  amountVnd: 10000,
  transactionDate: "20260101070000",
  providerTxnId: "123456",
  sentAt: new Date("2026-01-02T00:00:00Z"),
  actorId: "33333333-3333-4333-8333-333333333333",
};
const digest = (value: string) => createHmac("sha512", "test-secret").update(value).digest("hex");
function response(overrides: Record<string, string> = {}) {
  const p = {
    vnp_ResponseId: "response123",
    vnp_Command: "refund",
    vnp_ResponseCode: "00",
    vnp_Message: "Success",
    vnp_TmnCode: "TESTCODE",
    vnp_TxnRef: input.paymentId.replace(/-/g, ""),
    vnp_Amount: "1000000",
    vnp_BankCode: "NCB",
    vnp_PayDate: "20260102070001",
    vnp_TransactionNo: "987654",
    vnp_TransactionType: "02",
    vnp_TransactionStatus: "00",
    vnp_OrderInfo: `Refund ${input.refundId.replace(/-/g, "")}`,
    ...overrides,
  };
  // Fixture theo thứ tự trường của tài liệu, độc lập với hằng số trong adapter.
  const data = [
    p.vnp_ResponseId,
    p.vnp_Command,
    p.vnp_ResponseCode,
    p.vnp_Message,
    p.vnp_TmnCode,
    p.vnp_TxnRef,
    p.vnp_Amount,
    p.vnp_BankCode,
    p.vnp_PayDate,
    p.vnp_TransactionNo,
    p.vnp_TransactionType,
    p.vnp_TransactionStatus,
    p.vnp_OrderInfo,
  ].join("|");
  return { ...p, vnp_SecureHash: digest(data) };
}
const config = {
  tmnCode: "TESTCODE",
  secret: "test-secret",
  returnUrl: "https://example.test/return",
  refundEnabled: true,
  refundUrl: "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction",
  refundIp: "127.0.0.1",
  refundTimeoutMs: 100,
};
describe("T-401 VNPay refund/query protocol", () => {
  it("sends the JSON reference endpoint, full amount and correct ordered HMAC with stable 32-character RequestId", async () => {
    const transport = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response(JSON.stringify(response())));
    const a = new VnpayAdapter(config, () => new Date("2026-01-02T00:00:00Z"), transport);
    expect(await a.refund(input)).toEqual({ status: "SUCCEEDED", providerRefundId: "987654" });
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe(config.refundUrl);
    expect(options?.redirect).toBe("error");
    const sent = JSON.parse(options?.body as string) as Record<string, string>;
    expect(sent).toMatchObject({
      vnp_RequestId: "11111111111141118111111111111111",
      vnp_Amount: "1000000",
      vnp_TransactionType: "02",
      vnp_TransactionDate: "20260101070000",
      vnp_CreateDate: "20260102070000",
      vnp_TransactionNo: "123456",
    });
    const raw =
      "11111111111141118111111111111111|2.1.0|refund|TESTCODE|02|22222222222242228222222222222222|1000000|123456|20260101070000|33333333-3333-4333-8333-333333333333|20260102070000|127.0.0.1|Refund 11111111111141118111111111111111";
    expect(sent.vnp_SecureHash).toBe(digest(raw));
  });
  it.each<Record<string, string>>([
    { vnp_ResponseCode: "94", vnp_TransactionStatus: "05" },
    { vnp_ResponseCode: "00", vnp_TransactionStatus: "06" },
    { vnp_ResponseCode: "98", vnp_TransactionStatus: "01" },
    { vnp_TransactionType: "01" },
    { vnp_Amount: "1" },
    { vnp_TmnCode: "OTHER123" },
    { vnp_TxnRef: "other" },
    { vnp_OrderInfo: "other" },
    { vnp_Command: "querydr" },
  ])(
    "does not complete or authorize resend for processing/mismatched reply %j",
    async (override) => {
      const transport = jest
        .fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockResolvedValue(new Response(JSON.stringify(response(override))));
      expect((await new VnpayAdapter(config, undefined, transport).refund(input)).status).toBe(
        "UNKNOWN",
      );
    },
  );
  it("rejects a tampered signature, timeout and redirect; disabled refunds do not call transport", async () => {
    const bad = { ...response(), vnp_SecureHash: "a".repeat(128) };
    const transport = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(new Response(JSON.stringify(bad)))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(new Response("", { status: 302 }));
    const a = new VnpayAdapter(config, undefined, transport);
    for (let i = 0; i < 3; i++) expect((await a.refund(input)).status).toBe("UNKNOWN");
    expect(
      (
        await new VnpayAdapter({ ...config, refundEnabled: false }, undefined, transport).refund(
          input,
        )
      ).status,
    ).toBe("UNKNOWN");
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it("a verified original-payment query success is never refund success or permission to resend", async () => {
    const p = {
      ...response({
        vnp_Command: "querydr",
        vnp_TransactionType: "01",
        vnp_TransactionNo: "123456",
      }),
      vnp_PromotionCode: "",
      vnp_PromotionAmount: "",
    };
    p.vnp_SecureHash = digest(
      [
        p.vnp_ResponseId,
        p.vnp_Command,
        p.vnp_ResponseCode,
        p.vnp_Message,
        p.vnp_TmnCode,
        p.vnp_TxnRef,
        p.vnp_Amount,
        p.vnp_BankCode,
        p.vnp_PayDate,
        p.vnp_TransactionNo,
        p.vnp_TransactionType,
        p.vnp_TransactionStatus,
        p.vnp_OrderInfo,
        "",
        "",
      ].join("|"),
    );
    const transport = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response(JSON.stringify(p)));
    expect(await new VnpayAdapter(config, undefined, transport).reconcileRefund(input)).toEqual({
      status: "UNKNOWN",
      code: "VNPAY_REFUND_REQUIRES_MANUAL_EVIDENCE",
    });
    const sent = JSON.parse(transport.mock.calls[0][1]?.body as string) as Record<string, string>;
    expect(sent.vnp_Command).toBe("querydr");
    expect(sent.vnp_RequestId).toHaveLength(32);
    expect(sent.vnp_RequestId).not.toBe(input.refundId.replace(/-/g, ""));
  });
});
