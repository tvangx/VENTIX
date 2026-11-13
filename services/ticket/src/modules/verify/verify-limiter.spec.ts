import { VerifyLimiter } from "./verify-limiter";

describe("S-503 verification limiter", () => {
  it("limits each peer and resets the window without retaining peers forever", () => {
    let now = 0;
    const limiter = new VerifyLimiter(2, 10, 1000, 2, () => now);
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBe(1);
    now = 1000;
    expect(limiter.take("a")).toBe(0);
  });
  it("caps distinct peers and total requests", () => {
    const limiter = new VerifyLimiter(2, 3, 1000, 2, () => 0);
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("b")).toBe(0);
    expect(limiter.take("c")).toBe(1);
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("b")).toBe(1);
  });
});
