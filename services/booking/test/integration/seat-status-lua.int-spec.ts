import { randomUUID } from "node:crypto";
import {
  registerSeatStatusCommands,
  SeatStatusRedis,
} from "../../src/seat-status/seat-status-redis";
import { BookingRedis, startBookingRedis } from "../support/booking-redis";

describe("seat status atomic snapshot and expiry", () => {
  let cache: BookingRedis;
  let redis: SeatStatusRedis;
  beforeAll(async () => {
    cache = await startBookingRedis();
    redis = registerSeatStatusCommands(cache.redis);
  });
  afterAll(async () => cache?.close());

  it("reads sold and live held seats, excluding expired entries without scanning", async () => {
    const slot = `{evt:${randomUUID()}}`;
    await redis.sadd(`sold:${slot}`, "sold");
    await redis.zadd(`hexp:${slot}`, Date.now() - 1000, "expired", Date.now() + 10000, "held");
    const [sold, held, now] = await redis.seatSnapshot(2, `sold:${slot}`, `hexp:${slot}`, "", "");
    expect(sold).toEqual(["sold"]);
    expect(held).toEqual(["held"]);
    expect(Number(now)).toBeGreaterThan(Date.now() - 1000);
  });

  it("expires only absent seats, preserving renewed holds and sold seats", async () => {
    const slot = `{evt:${randomUUID()}}`;
    await redis.zadd(`hexp:${slot}`, 0, "expired", 0, "renewed", 0, "sold");
    await redis.set(`seat:${slot}:renewed`, "H:user", "PX", 10000);
    await redis.set(`seat:${slot}:sold`, "S");
    expect(await redis.sweepSeats(1, `hexp:${slot}`, `seat:${slot}:`, `delta:${slot}`)).toEqual([
      3, 1,
    ]);
    expect(await redis.zrange(`hexp:${slot}`, 0, -1)).toEqual(["renewed"]);
    expect(await redis.get(`seat:${slot}:sold`)).toBe("S");
    expect(await redis.sweepSeats(1, `hexp:${slot}`, `seat:${slot}:`, `delta:${slot}`)).toEqual([
      0, 0,
    ]);
  });

  it("rejects wrong metadata types before publishing or removing anything", async () => {
    const slot = `{evt:${randomUUID()}}`;
    await redis.zadd(`hexp:${slot}`, 0, "a", 0, "b");
    await redis.sadd(`seat:${slot}:b`, "wrong-type");
    await expect(
      redis.sweepSeats(1, `hexp:${slot}`, `seat:${slot}:`, `delta:${slot}`),
    ).rejects.toThrow();
    expect(await redis.zcard(`hexp:${slot}`)).toBe(2);
  });
});
