import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { createLogger } from "@ticketing/common";
import request from "supertest";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";
import { BookingStartupService } from "../../src/rehydrate/booking-startup.service";
import { registerRehydrateCommand } from "../../src/rehydrate/seat-rehydrate.service";
import { SeatHoldRedisClient } from "../../src/seat-hold/seat-hold-redis";
import { BookingDb, startBookingDb } from "../support/booking-db";
import { BookingRedis, startBookingRedis } from "../support/booking-redis";
import { seedAllocation } from "../support/lifecycle";

describe("Redis rehydrate before readiness (PostgreSQL + Redis + HTTP)", () => {
  let db: BookingDb;
  let cache: BookingRedis;
  let app: INestApplication | undefined;
  beforeAll(async () => {
    db = await startBookingDb();
    cache = await startBookingRedis();
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  afterAll(async () => {
    await cache?.close();
    await db?.close();
  });
  const makeApp = async (enabled = true) => {
    app = await createApp(
      envSchema.parse({
        NODE_ENV: "test",
        INTERNAL_API_KEY: "synthetic-test-key",
        DATABASE_URL: db.pool.options.connectionString,
        REDIS_URL: cache.url,
        EVENT_CONSUMER_ENABLED: "false",
        REHYDRATE_ENABLED: String(enabled),
        AUTH_ISSUER: "test",
        AUTH_AUDIENCE: "test",
        AUTH_JWKS_URI: "http://localhost/jwks",
      }),
      createLogger("test", { level: "silent" }),
    );
    return app;
  };
  it("FLUSHALL isolated Redis then restart app restores SOLD, live HELD and metadata, ignores expired/inactive/released", async () => {
    const event = randomUUID();
    const slot = `{evt:${event}}`;
    const sold = await seedAllocation(db.pool, {
      event,
      state: "SOLD",
      status: "CONFIRMED",
      expiryMs: Date.now() - 10000,
    });
    const held = await seedAllocation(db.pool, { event, expiryMs: Date.now() + 30000 });
    const expired = await seedAllocation(db.pool, { event, expiryMs: Date.now() - 1000 });
    const cancelled = await seedAllocation(db.pool, { event, status: "CANCELLED" });
    const released = await seedAllocation(db.pool, { event, state: "RELEASED" });
    await (await makeApp()).init();
    await app!.get(BookingStartupService).completion;
    await app!.close();
    app = undefined;
    // Chỉ xóa dữ liệu container test riêng do suite này tạo, không dùng Redis dev.
    await cache.redis.flushall();
    expect(await cache.redis.dbsize()).toBe(0);
    await (await makeApp()).init();
    await app!.get(BookingStartupService).completion;
    await request(app!.getHttpServer()).get("/health/ready").expect(200);
    expect(await cache.redis.get(`seat:${slot}:${sold.seat}`)).toBe("S");
    expect(await cache.redis.smembers(`sold:${slot}`)).toEqual([sold.seat]);
    expect(await cache.redis.get(`seat:${slot}:${held.seat}`)).toBe(`H:${held.user}`);
    const ttl = await cache.redis.pttl(`seat:${slot}:${held.seat}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(held.expiry - Date.now() + 100);
    expect(await cache.redis.smembers(`hold:${slot}:${held.user}`)).toEqual([held.seat]);
    expect(await cache.redis.pttl(`hold:${slot}:${held.user}`)).toBeGreaterThan(0);
    expect(Number(await cache.redis.zscore(`hexp:${slot}`, held.seat))).toBe(held.expiry);
    for (const allocation of [expired, cancelled, released])
      expect(await cache.redis.get(`seat:${slot}:${allocation.seat}`)).toBeNull();
  });
  it("NX preserves a newer holder, its TTL and metadata across restart", async () => {
    const event = randomUUID();
    const slot = `{evt:${event}}`;
    const held = await seedAllocation(db.pool, { event });
    const sold = await seedAllocation(db.pool, { event, state: "SOLD" });
    await cache.redis.set(`seat:${slot}:${held.seat}`, "H:newer", "PX", 120000);
    await cache.redis.zadd(`hexp:${slot}`, 9999999999999, held.seat);
    await cache.redis.set(`seat:${slot}:${sold.seat}`, "H:newer", "PX", 120000);
    await (await makeApp()).init();
    await app!.get(BookingStartupService).completion;
    expect(await cache.redis.get(`seat:${slot}:${held.seat}`)).toBe("H:newer");
    expect(await cache.redis.pttl(`seat:${slot}:${held.seat}`)).toBeGreaterThan(110000);
    expect(await cache.redis.zscore(`hexp:${slot}`, held.seat)).toBe("9999999999999");
    expect(await cache.redis.exists(`hold:${slot}:${held.user}`)).toBe(0);
    expect(await cache.redis.sismember(`sold:${slot}`, sold.seat)).toBe(0);
  });
  it("returns 503 over HTTP while rehydrate is blocked, then 200 after completion", async () => {
    const instance = await makeApp();
    const client = instance.get(SeatHoldRedisClient);
    const connected = client.connected.bind(client);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.spyOn(client, "connected").mockImplementation(async () => {
      await gate;
      return connected();
    });
    await instance.init();
    try {
      await request(instance.getHttpServer()).get("/health/ready").expect(503);
    } finally {
      release();
    }
    await instance.get(BookingStartupService).completion;
    await request(instance.getHttpServer()).get("/health/ready").expect(200);
  });
  it("explicit disable flag leaves Redis untouched and permits readiness", async () => {
    const event = randomUUID();
    const sold = await seedAllocation(db.pool, { event, state: "SOLD" });
    await (await makeApp(false)).init();
    await app!.get(BookingStartupService).completion;
    expect(await cache.redis.get(`seat:{evt:${event}}:${sold.seat}`)).toBeNull();
    await request(app!.getHttpServer()).get("/health/ready").expect(200);
  });
  it("validates metadata before writing seat and leaves readiness false on failure", async () => {
    const event = randomUUID();
    const held = await seedAllocation(db.pool, { event });
    const key = `hexp:{evt:${event}}`;
    await cache.redis.set(key, "bad-type");
    try {
      await (await makeApp()).init();
      await app!.get(BookingStartupService).completion;
      await request(app!.getHttpServer()).get("/health/ready").expect(503);
      expect(await cache.redis.get(`seat:{evt:${event}}:${held.seat}`)).toBeNull();
    } finally {
      await cache.redis.del(key);
    }
  });
  it("50 rehydrate workers restore each seat once and do not extend TTL on replay", async () => {
    const redis = registerRehydrateCommand(cache.redis);
    const event = randomUUID();
    const slot = `{evt:${event}}`;
    const seat = randomUUID();
    const expiry = Date.now() + 30000;
    const run = () =>
      redis.rehydrateSeat(
        4,
        `seat:${slot}:${seat}`,
        `sold:${slot}`,
        `hold:${slot}:user`,
        `hexp:${slot}`,
        "HELD",
        seat,
        "H:user",
        expiry,
      );
    const outcomes = await Promise.all(Array.from({ length: 50 }, run));
    expect(outcomes.filter((value) => value === 1)).toHaveLength(1);
    expect(outcomes.filter((value) => value === 0)).toHaveLength(49);
    expect(await cache.redis.call("PEXPIRETIME", `seat:${slot}:${seat}`)).toBe(expiry);
    await run();
    expect(await cache.redis.call("PEXPIRETIME", `seat:${slot}:${seat}`)).toBe(expiry);
    expect(await cache.redis.scard(`hold:${slot}:user`)).toBe(1);
  });
  it("skips a hold whose deadline expires during processing", async () => {
    const redis = registerRehydrateCommand(cache.redis);
    const slot = `{evt:${randomUUID()}}`;
    expect(
      await redis.rehydrateSeat(
        4,
        `seat:${slot}:seat`,
        `sold:${slot}`,
        `hold:${slot}:user`,
        `hexp:${slot}`,
        "HELD",
        "seat",
        "H:user",
        Date.now() - 1,
      ),
    ).toBe(0);
    expect(await cache.redis.exists(`seat:${slot}:seat`, `hold:${slot}:user`, `hexp:${slot}`)).toBe(
      0,
    );
  });
  it("restores more than one database page without missing SOLD seats", async () => {
    const event = randomUUID();
    const first = await seedAllocation(db.pool, { event, state: "SOLD", status: "CONFIRMED" });
    const ids = Array.from({ length: 501 }, () => randomUUID());
    await db.pool.query(
      `INSERT INTO seat_allocations (id,order_id,event_id,seat_id,state)
      SELECT seat,$1::uuid,$2::uuid,seat,'SOLD' FROM unnest($3::uuid[]) AS seat`,
      [first.order, event, ids],
    );
    await (await makeApp()).init();
    await app!.get(BookingStartupService).completion;
    expect(await cache.redis.scard(`sold:{evt:${event}}`)).toBe(502);
    for (const seat of [first.seat, ...ids])
      expect(await cache.redis.get(`seat:{evt:${event}}:${seat}`)).toBe("S");
  });
});
