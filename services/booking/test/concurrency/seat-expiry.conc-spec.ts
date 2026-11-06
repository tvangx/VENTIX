import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import {
  registerSeatStatusCommands,
  SeatStatusRedis,
} from "../../src/seat-status/seat-status-redis";
import { BookingRedis, pollUntil, startBookingRedis } from "../support/booking-redis";

describe("seat expiry replicas", () => {
  let cache: BookingRedis;
  let observer: Redis;
  let replica: SeatStatusRedis;
  beforeAll(async () => {
    cache = await startBookingRedis();
    observer = cache.redis.duplicate();
    replica = registerSeatStatusCommands(cache.redis.duplicate());
  });
  afterAll(async () => {
    await observer?.quit();
    await replica?.quit();
    await cache?.close();
  });

  it("50 concurrent sweeps on two connections announce 100 expired seats exactly once", async () => {
    const redis = registerSeatStatusCommands(cache.redis);
    const slot = `{evt:${randomUUID()}}`;
    const channel = `delta:${slot}`;
    const messages: string[] = [];
    await observer.subscribe(channel);
    observer.on("message", (_channel: string, message: string) => messages.push(message));
    const seats = Array.from({ length: 100 }, () => randomUUID());
    await redis.zadd(`hexp:${slot}`, ...seats.flatMap((id) => [0, id]));
    const result = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        (i % 2 ? replica : redis).sweepSeats(1, `hexp:${slot}`, `seat:${slot}:`, channel),
      ),
    );
    await redis.publish(channel, "barrier");
    await pollUntil(async () => messages.includes("barrier"));
    expect(result.reduce((sum, value) => sum + value[1], 0)).toBe(100);
    expect(messages.filter((message) => message.startsWith("A:")).sort()).toEqual(
      seats.map((id) => `A:${id}`).sort(),
    );
    expect(await redis.zcard(`hexp:${slot}`)).toBe(0);
  });
});
