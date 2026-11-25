import { VnpayAdapter, canonicalQuery, gmt7 } from "./vnpay-adapter";

// Digest independently calculated with Python hmac/hashlib over this literal string.
const signed =
  "vnp_Amount=1000000&vnp_OrderInfo=Thanh+toan+don+hang&vnp_ReturnUrl=https%3A%2F%2Fexample.test%2Freturn%3Fa%3D1%26b%3D2";
describe("VNPay protocol", () => {
  it("uses the configured sandbox endpoint without changing signature parameters", () => {
    const a = new VnpayAdapter({
      tmnCode: "TESTCODE",
      secret: "test-secret",
      returnUrl: "https://example.test/return",
      paymentUrl: "https://sandbox.vnpaytest.vn/paymentv2/vpcpay.html",
    });
    const result = new URL(
      a.createPayment({
        paymentId: "11111111-1111-4111-8111-111111111111",
        amountVnd: 10000,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 900000),
        ipAddress: "127.0.0.1",
      }).redirect_url,
    );
    expect(result.origin).toBe("https://sandbox.vnpaytest.vn");
    expect(result.searchParams.get("vnp_SecureHash")).toHaveLength(128);
  });
  const adapter = new VnpayAdapter({
    tmnCode: "TESTCODE",
    secret: "test-secret",
    returnUrl: "https://example.test/return",
  });
  it("canonicalizes alphabetically and encodes spaces as plus without double encoding", () => {
    expect(
      canonicalQuery({
        vnp_ReturnUrl: "https://example.test/return?a=1&b=2",
        vnp_OrderInfo: "Thanh toan don hang",
        vnp_Amount: "1000000",
      }),
    ).toBe(signed);
    expect(canonicalQuery({ b: "+%&=", a: "!()*'" })).toBe("a=!()*'&b=%2B%25%26%3D");
  });
  it("signs an independent vector", () => {
    expect(
      adapter.sign({
        vnp_ReturnUrl: "https://example.test/return?a=1&b=2",
        vnp_OrderInfo: "Thanh toan don hang",
        vnp_Amount: "1000000",
      }),
    ).toBe(
      "574326189231cbda1e8ee0a17d0ba4b38e49469ab36ee8a0df8517cd2f97c2d3a9d7694f6ec9c8bd27a412e94e3603d36717d02d4274df0a9a8f71143a9f45e9",
    );
  });
  it("verifies an independently calculated callback vector", () => {
    const input = {
      ...payload(),
      vnp_SecureHash:
        "7752d39ae49d7512acbbcce85ae8ac28ea347f34cde72a6295cb0b1b2452a9556f738d2098ff8e03222ee6bb78c2999ede4655561bd718477dc94019e626e211",
    };
    expect(adapter.verifyIpn(input)?.succeeded).toBe(true);
    expect(adapter.verifyReturn(input)?.amountVnd).toBe(10000);
    expect(adapter.verifyReturn({ ...input, vnp_Amount: "2000000" })).toBeNull();
  });
  it("accepts optional PayDate and failed TransactionNo=0", () => {
    const p: Record<string, string> = {
      ...payload(),
      vnp_TransactionNo: "0",
      vnp_ResponseCode: "24",
      vnp_TransactionStatus: "02",
    };
    delete p.vnp_PayDate;
    expect(adapter.verifyIpn({ ...p, vnp_SecureHash: adapter.sign(p) })?.succeeded).toBe(false);
  });
  it("formats GMT+7 across UTC date boundaries", () => {
    expect(gmt7(new Date("2026-01-31T18:02:03Z"))).toBe("20260201010203");
  });
  it("creates all mandatory parameters, amount x100 and the exact payable expiry", () => {
    const url = new URL(
      adapter.createPayment({
        paymentId: "11111111-1111-4111-8111-111111111111",
        amountVnd: 10000,
        createdAt: new Date("2026-01-31T18:00:00Z"),
        expiresAt: new Date("2026-01-31T18:15:00Z"),
        ipAddress: "127.0.0.1",
      }).redirect_url,
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      vnp_Version: "2.1.0",
      vnp_Command: "pay",
      vnp_TmnCode: "TESTCODE",
      vnp_Amount: "1000000",
      vnp_CurrCode: "VND",
      vnp_CreateDate: "20260201010000",
      vnp_ExpireDate: "20260201011500",
      vnp_IpAddr: "127.0.0.1",
      vnp_OrderType: "other",
      vnp_Locale: "vn",
    });
    expect(url.searchParams.has("vnp_IpnUrl")).toBe(false);
  });
  const payload = () => ({
    vnp_BankCode: "NCB",
    vnp_OrderInfo: "Thanh toan don hang",
    vnp_TxnRef: "11111111111141118111111111111111",
    vnp_TmnCode: "TESTCODE",
    vnp_Amount: "1000000",
    vnp_ResponseCode: "00",
    vnp_TransactionStatus: "00",
    vnp_TransactionNo: "123456",
    vnp_PayDate: "20260201011500",
  });
  it("verifies IPN/Return, normalizes reference and requires both success codes", () => {
    const p = payload();
    const input = { ...p, vnp_SecureHash: adapter.sign(p), vnp_SecureHashType: "HmacSHA512" };
    expect(adapter.verifyIpn(input)).toMatchObject({
      succeeded: true,
      amountVnd: 10000,
      paidAt: new Date("2026-01-31T18:15:00Z"),
      paymentId: "11111111-1111-4111-8111-111111111111",
    });
    expect(adapter.verifyReturn(input)).toEqual(adapter.verifyIpn(input));
    const failed = { ...p, vnp_TransactionStatus: "02" };
    expect(adapter.verifyIpn({ ...failed, vnp_SecureHash: adapter.sign(failed) })?.succeeded).toBe(
      false,
    );
  });
  it("rejects tampering, malformed hashes, arrays, wrong merchant, invalid amount and date", () => {
    const p = payload();
    const input = { ...p, vnp_SecureHash: adapter.sign(p) };
    expect(adapter.verifyIpn({ ...input, vnp_Amount: "100" })).toBeNull();
    expect(adapter.verifyIpn({ ...input, vnp_SecureHash: "zz" })).toBeNull();
    expect(adapter.verifyIpn({ ...input, vnp_Amount: ["1000000"] })).toBeNull();
    for (const patch of [
      { vnp_TmnCode: "OTHER" },
      { vnp_Amount: "10001" },
      { vnp_Amount: "1e6" },
      { vnp_PayDate: "20260231011500" },
    ]) {
      const bad = { ...p, ...patch };
      expect(adapter.verifyIpn({ ...bad, vnp_SecureHash: adapter.sign(bad) })).toBeNull();
    }
  });
});
