import { backoffDelayMs, sleep } from "./backoff";

describe("backoffDelayMs", () => {
  it("tăng theo mũ 2 và bị chặn bởi trần (jitter = 1 → giá trị lớn nhất)", () => {
    const max = () => 0.999999;
    expect(backoffDelayMs(1, 100, 1000, max)).toBe(99);
    expect(backoffDelayMs(2, 100, 1000, max)).toBe(199);
    expect(backoffDelayMs(3, 100, 1000, max)).toBe(399);
    expect(backoffDelayMs(10, 100, 1000, max)).toBe(999);
  });

  it("jitter 0 cho 0 ms, và luôn nằm trong [0, trần]", () => {
    expect(backoffDelayMs(5, 100, 1000, () => 0)).toBe(0);
    for (let i = 0; i < 200; i++) {
      const d = backoffDelayMs(4, 100, 500);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(500);
    }
  });
});

describe("sleep", () => {
  it("dừng sớm khi signal bị hủy", async () => {
    const ac = new AbortController();
    const started = Date.now();
    const p = sleep(10_000, ac.signal);
    ac.abort();
    await p;
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("trả về ngay nếu signal đã hủy sẵn", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleep(10_000, ac.signal)).resolves.toBeUndefined();
  });
});
