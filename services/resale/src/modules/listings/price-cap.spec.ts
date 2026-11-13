import { assertPriceCap, maximumPrice } from "./price-cap";

describe("S-304 integer resale price cap", () => {
  it("accepts 120 percent and rejects a single VND above it", () => {
    expect(maximumPrice(100000n, 120)).toBe(120000n);
    expect(() => assertPriceCap(100000n, 120000n, 120)).not.toThrow();
    expect(() => assertPriceCap(100000n, 120001n, 120)).toThrow();
  });
  it("rounds fractional caps down and supports free tickets and large values", () => {
    expect(maximumPrice(101n, 120)).toBe(121n);
    expect(() => assertPriceCap(101n, 122n, 120)).toThrow();
    expect(() => assertPriceCap(0n, 0n, 120)).not.toThrow();
    expect(() => assertPriceCap(0n, 1n, 120)).toThrow();
    expect(maximumPrice(9007199254740991n, 120)).toBe(10808639105689189n);
  });
  it("rejects negative prices and invalid cap policies", () => {
    expect(() => assertPriceCap(100n, -1n, 120)).toThrow();
    expect(() => maximumPrice(-1n, 120)).toThrow();
    for (const percent of [0, 121, 1.5, NaN]) expect(() => maximumPrice(100n, percent)).toThrow();
  });
});
