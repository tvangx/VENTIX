import { splitVat } from "./vat";

describe("VAT nguyên VND, giá thực thu đã gồm thuế", () => {
  it("làm tròn net half-up, VAT là phần dư", () => {
    expect(splitVat(105, 0.1)).toEqual({ gross: 105n, net: 95n, vat: 10n });
    expect(splitVat(3, 1)).toEqual({ gross: 3n, net: 2n, vat: 1n });
  });
  it("property: net + vat = gross với biên an toàn và nhiều mức thuế", () => {
    let seed = 402;
    for (let i = 0; i < 10000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const gross = i === 0 ? Number.MAX_SAFE_INTEGER : seed;
      const rate = (seed % 10001) / 10000;
      const result = splitVat(gross, rate);
      expect(result.net + result.vat).toBe(BigInt(gross));
      expect(result.net >= 0n && result.vat >= 0n).toBe(true);
    }
  });
  it("từ chối tiền không nguyên/an toàn và thuế không hợp lệ", () => {
    for (const price of [-1, 1.1, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => splitVat(price, 0.1)).toThrow();
    for (const rate of [-1, 1.1, NaN, 0.12345]) expect(() => splitVat(100, rate)).toThrow();
  });
});
