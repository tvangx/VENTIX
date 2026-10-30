import { randomUUID } from "node:crypto";
import { registerSeatHoldCommands, SeatHoldRedis } from "../../src/seat-hold/seat-hold-redis";
import { BookingRedis, pollUntil, startBookingRedis } from "../support/booking-redis";

describe("seat hold Lua (real Redis)", () => {
  let db: BookingRedis;
  let redis: SeatHoldRedis;
  let event: string;
  const user = "H:user-one";
  const hold = () => `hold:{evt:${event}}:user-one`;
  const seat = (id: string) => `seat:{evt:${event}}:${id}`;
  const acquire = (ids: string[], ttl = 10, max = 6, tag = user) =>
    redis.holdSeats(ids.length + 1, hold(), ...ids.map(seat), tag, ttl, max, Date.now(), ...ids);
  const release = (ids: string[], tag = user) =>
    redis.releaseSeats(ids.length + 1, hold(), ...ids.map(seat), tag, ...ids);

  beforeAll(async () => {
    db = await startBookingRedis();
    redis = registerSeatHoldCommands(db.redis, false);
  });
  beforeEach(() => {
    event = randomUUID();
  });
  afterAll(async () => db?.close());

  it("refuses the whole batch without touching A/C or metadata when B is held", async () => {
    await redis.set(seat("B"), "H:other", "EX", 10);
    expect(await acquire(["A", "B", "C"])).toEqual([0, seat("B")]);
    expect(await redis.mget(seat("A"), seat("C"))).toEqual([null, null]);
    expect(await redis.exists(hold(), `hexp:{evt:${event}}`)).toBe(0);
  });

  it("refuses SOLD seats", async () => {
    await redis.set(seat("A"), "S");
    expect(await acquire(["A"])).toEqual([0, seat("A")]);
    expect(await redis.ttl(seat("A"))).toBe(-1);
  });

  it("enforces the cumulative limit without modifying keys or refreshing TTL", async () => {
    expect(await acquire(["A", "B"], 10, 2)).toEqual([1]);
    const before = await redis.pexpiretime(seat("A"));
    expect(await acquire(["A", "C"], 20, 2)).toEqual([2]);
    expect(await redis.get(seat("C"))).toBeNull();
    expect(await redis.pexpiretime(seat("A"))).toBe(before);
    expect((await redis.smembers(hold())).sort()).toEqual(["A", "B"]);
  });

  it("only the owner can release; release is idempotent and preserves SOLD/other owners", async () => {
    await acquire(["A", "B", "C"]);
    await redis.set(seat("B"), "H:other", "EX", 10);
    await redis.set(seat("C"), "S");
    await release(["A"], "H:other");
    expect(await redis.get(seat("A"))).toBe(user);
    await release(["A", "B", "C"]);
    await release(["A", "B", "C"]);
    expect(await redis.mget(seat("A"), seat("B"), seat("C"))).toEqual([null, "H:other", "S"]);
    expect(await redis.zscore(`hexp:{evt:${event}}`, "A")).toBeNull();
  });

  it("expires and can be acquired by another holder", async () => {
    await acquire(["A"], 1);
    expect(await redis.ttl(hold())).toBeGreaterThanOrEqual(0);
    await pollUntil(async () => (await redis.get(seat("A"))) === null);
    expect(await acquire(["A"], 10, 6, "H:other")).toEqual([1]);
  });

  it("renews a repeated hold without counting it twice", async () => {
    await acquire(["A"], 1, 1);
    const previous = Number(await redis.pexpiretime(seat("A")));
    expect(await acquire(["A"], 10, 1)).toEqual([1]);
    expect(await redis.pttl(seat("A"))).toBeGreaterThan(9000);
    expect(Number(await redis.pexpiretime(seat("A")))).toBeGreaterThan(previous);
    expect(await redis.scard(hold())).toBe(1);
    expect(Number(await redis.zscore(`hexp:{evt:${event}}`, "A"))).toBeGreaterThan(previous);
  });

  it("does not count expired set members or expose a new owner's seats", async () => {
    await acquire(["A"], 1, 2);
    await acquire(["B"], 10, 2);
    await pollUntil(async () => (await redis.get(seat("A"))) === null);
    await redis.set(seat("A"), "H:other", "EX", 10);
    expect(await acquire(["C"], 10, 2)).toEqual([1]);
    expect((await redis.smembers(hold())).sort()).toEqual(["B", "C"]);
    const current = await redis.readHold(1, hold(), user);
    expect(current.slice(1).sort()).toEqual(["B", "C"]);
    expect(await redis.get(seat("A"))).toBe("H:other");
  });

  it("does not log holds by default; publishes H/A deltas for successful owner changes only", async () => {
    const subscriber = db.redis.duplicate();
    const channel = `delta:{evt:${event}}`;
    const messages: string[] = [];
    subscriber.on("message", (_channel, message) => messages.push(message));
    try {
      await subscriber.subscribe(channel);
      await acquire(["A"]);
      await release(["A"], "H:other");
      await release(["A"]);
      await pollUntil(async () => messages.length >= 2);
      expect(messages).toEqual(["H:A", "A:A"]);
      expect(await redis.exists(`holdlog:{evt:${event}}`)).toBe(0);
    } finally {
      await subscriber.quit();
    }
  });

  it("logs only successful holds when enabled", async () => {
    registerSeatHoldCommands(redis, true);
    try {
      await acquire(["A"]);
      await acquire(["B"], 10, 1);
      expect(await redis.xlen(`holdlog:{evt:${event}}`)).toBe(1);
    } finally {
      registerSeatHoldCommands(redis, false);
    }
  });

  it("validates metadata types before any seat is written", async () => {
    await redis.set(`hexp:{evt:${event}}`, "wrong-type");
    await expect(acquire(["A"])).rejects.toThrow();
    expect(await redis.get(seat("A"))).toBeNull();
    expect(await redis.exists(hold())).toBe(0);
  });
});
