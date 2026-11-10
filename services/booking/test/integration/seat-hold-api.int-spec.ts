import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { createLogger, loadEnv } from "@ticketing/common";
import { exportSPKI, generateKeyPair, KeyLike, SignJWT } from "jose";
import request from "supertest";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";
import { BookingDb, startBookingDb } from "../support/booking-db";
import { BookingRedis, pollUntil, startBookingRedis } from "../support/booking-redis";

describe("/v1/holds (HTTP, JWT, PostgreSQL and Redis)", () => {
  let db: BookingDb;
  let cache: BookingRedis;
  let app: INestApplication;
  let privateKey: KeyLike;
  let publicKey: string;
  let event: string;
  let seats: string[];
  const user = randomUUID();
  const other = randomUUID();
  const sign = (id: string = user) =>
    new SignJWT({ roles: ["USER"] })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(id)
      .setIssuer("holds-test")
      .setAudience("ticketing-api")
      .setExpirationTime("5m")
      .sign(privateKey);
  const create = async (ids = seats, userId = user) =>
    request(app.getHttpServer())
      .post("/v1/holds")
      .set("Authorization", `Bearer ${await sign(userId)}`)
      .set("Idempotency-Key", randomUUID())
      .send({ event_id: event, seat_ids: ids });
  const get = async (userId = user) =>
    request(app.getHttpServer())
      .get(`/v1/holds?event_id=${event}`)
      .set("Authorization", `Bearer ${await sign(userId)}`);
  const remove = async (userId = user, ids?: string[]) =>
    request(app.getHttpServer())
      .delete("/v1/holds")
      .set("Authorization", `Bearer ${await sign(userId)}`)
      .send({ event_id: event, ...(ids ? { seat_ids: ids } : {}) });
  const env = (admission = "false") =>
    loadEnv(envSchema, {
      NODE_ENV: "test",
      EVENT_CONSUMER_ENABLED: "false", // suite HTTP giữ ghế không chạy broker
      ADMISSION_TOKEN_SECRET: "synthetic-admission-key-for-booking-tests",
      QUEUE_WORKER_ENABLED: "false",
      INTERNAL_API_KEY: "synthetic-test-key",
      DATABASE_URL: db.pool.options.connectionString,
      REDIS_URL: cache.url,
      HOLD_TTL_SECONDS: "2",
      HOLD_MAX_SEATS: "2",
      ADMISSION_REQUIRED: admission,
      AUTH_ISSUER: "holds-test",
      AUTH_AUDIENCE: "ticketing-api",
      AUTH_PUBLIC_KEY_PEM: publicKey,
    });

  beforeAll(async () => {
    db = await startBookingDb();
    cache = await startBookingRedis();
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    publicKey = await exportSPKI(pair.publicKey);
    app = await createApp(env(), createLogger("holds-test", { level: "silent" }));
    await app.init();
  });
  beforeEach(async () => {
    event = randomUUID();
    seats = [randomUUID(), randomUUID()];
    await db.pool.query(
      `INSERT INTO event_snapshots
      (event_id, organizer_id, status, event_version, seat_map_version, pricing_ready, ticket_classes, sale_window)
      VALUES ($1,$2,'APPROVED',1,1,true,'[]',$3)`,
      [
        event,
        randomUUID(),
        JSON.stringify({
          queue_enabled: true,
          admit_rate: 100,
          starts_at: new Date(Date.now() - 60000).toISOString(),
          ends_at: new Date(Date.now() + 60000).toISOString(),
        }),
      ],
    );
  });
  afterAll(async () => {
    await app?.close();
    await cache?.close();
    await db?.close();
  });

  it("requires JWT and validates UUIDs, unique/nonempty seat_ids and unexpected fields", async () => {
    await request(app.getHttpServer())
      .post("/v1/holds")
      .send({ event_id: event, seat_ids: seats })
      .expect(401);
    const token = await sign();
    for (const body of [
      { event_id: "bad", seat_ids: seats },
      { event_id: event, seat_ids: [] },
      { event_id: event, seat_ids: [seats[0], seats[0]] },
      { event_id: event, seat_ids: ["bad"] },
      { event_id: event, seat_ids: seats, user_id: other },
    ]) {
      await request(app.getHttpServer())
        .post("/v1/holds")
        .set("Authorization", `Bearer ${token}`)
        .send(body)
        .expect(400);
    }
  });

  it("returns 201, exposes only the current user's hold and releases all idempotently", async () => {
    const response = await create();
    expect(response.status).toBe(201);
    expect(response.body.seat_ids).toEqual(seats);
    expect(Date.parse(response.body.expires_at)).toBeGreaterThan(Date.now());
    expect((await get()).body.seat_ids.sort()).toEqual([...seats].sort());
    expect((await get(other)).body).toEqual({ seat_ids: [], expires_at: null });
    expect((await remove(other, seats)).status).toBe(204);
    expect(await cache.redis.get(`seat:{evt:${event}}:${seats[0]}`)).toBe(`H:${user}`);
    expect((await remove()).status).toBe(204);
    expect((await remove()).status).toBe(204);
    expect((await get()).body).toEqual({ seat_ids: [], expires_at: null });
  });

  it("returns 409 with seat_id and request_id, leaving all other seats untouched", async () => {
    await cache.redis.set(`seat:{evt:${event}}:${seats[1]}`, `H:${other}`, "EX", 10);
    const response = await create();
    expect(response.status).toBe(409);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.body).toMatchObject({
      code: "SEAT_UNAVAILABLE",
      seat_id: seats[1],
      request_id: expect.any(String),
    });
    expect(await cache.redis.get(`seat:{evt:${event}}:${seats[0]}`)).toBeNull();
    expect(await cache.redis.exists(`hold:{evt:${event}}:${user}`)).toBe(0);
  });

  it("returns 422 for a batch above the limit, and for cumulative holds, without extra writes", async () => {
    const extra = randomUUID();
    expect((await create([...seats, extra])).status).toBe(422);
    expect(
      await cache.redis.exists(...[...seats, extra].map((id) => `seat:{evt:${event}}:${id}`)),
    ).toBe(0);
    expect((await create()).status).toBe(201);
    const response = await create([extra]);
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("HOLD_LIMIT_EXCEEDED");
    expect(await cache.redis.get(`seat:{evt:${event}}:${extra}`)).toBeNull();
  });

  it("renews a repeated 201 hold and makes an expired seat available to another user", async () => {
    expect((await create([seats[0]])).status).toBe(201);
    const key = `seat:{evt:${event}}:${seats[0]}`;
    await pollUntil(async () => (await cache.redis.pttl(key)) < 1500);
    const renewed = await create([seats[0]]);
    expect(renewed.status).toBe(201);
    expect(await cache.redis.pttl(key)).toBeGreaterThan(1500);
    await pollUntil(async () => (await cache.redis.get(key)) === null);
    expect((await get()).body.seat_ids).toEqual([]);
    expect((await create([seats[0]], other)).status).toBe(201);
  });

  it.each(["DRAFT", "PENDING", "CANCELLED", "ENDED", "REJECTED"])(
    "refuses snapshot status %s",
    async (status) => {
      await db.pool.query("UPDATE event_snapshots SET status = $2 WHERE event_id = $1", [
        event,
        status,
      ]);
      const response = await create();
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("EVENT_NOT_ON_SALE");
    },
  );

  it("refuses missing snapshot, invalid/closed/future sale windows without touching Redis", async () => {
    for (const window of [
      {},
      { starts_at: "invalid", ends_at: "invalid" },
      {
        starts_at: new Date(Date.now() + 10000).toISOString(),
        ends_at: new Date(Date.now() + 20000).toISOString(),
      },
      {
        starts_at: new Date(Date.now() - 20000).toISOString(),
        ends_at: new Date(Date.now() - 10000).toISOString(),
      },
    ]) {
      await db.pool.query("UPDATE event_snapshots SET sale_window = $2 WHERE event_id = $1", [
        event,
        JSON.stringify(window),
      ]);
      expect((await create()).body.code).toBe("EVENT_NOT_ON_SALE");
    }
    await db.pool.query("DELETE FROM event_snapshots WHERE event_id = $1", [event]);
    expect((await create()).status).toBe(404);
    expect(await cache.redis.exists(`hold:{evt:${event}}:${user}`)).toBe(0);
  });

  it("returns 503 EVENT_NOT_READY and Retry-After while pricing is not ready", async () => {
    await db.pool.query("UPDATE event_snapshots SET pricing_ready = false WHERE event_id = $1", [
      event,
    ]);
    const response = await create();
    expect(response.status).toBe(503);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.body.code).toBe("EVENT_NOT_READY");
    expect(await cache.redis.exists(`hold:{evt:${event}}:${user}`)).toBe(0);
  });

  it("accepts PUBLISHED snapshots and multiple sale phases", async () => {
    const window = [
      {
        starts_at: new Date(Date.now() - 1000).toISOString(),
        ends_at: new Date(Date.now() + 10000).toISOString(),
      },
    ];
    await db.pool.query(
      "UPDATE event_snapshots SET status = 'PUBLISHED', sale_window = $2 WHERE event_id = $1",
      [event, JSON.stringify(window)],
    );
    expect((await create()).status).toBe(201);
  });

  it("fails closed for a queue-enabled phase without an admission token", async () => {
    const protectedApp = await createApp(
      env("true"),
      createLogger("admission-test", { level: "silent" }),
    );
    try {
      await protectedApp.init();
      const response = await request(protectedApp.getHttpServer())
        .post("/v1/holds")
        .set("Authorization", `Bearer ${await sign()}`)
        .send({ event_id: event, seat_ids: seats });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("ADMISSION_REQUIRED");
    } finally {
      await protectedApp.close();
    }
  });

  it("100 HTTP users including cold Redis initialization produce 1 success and 99 conflicts", async () => {
    const coldApp = await createApp(env(), createLogger("cold-holds-test", { level: "silent" }));
    try {
      await coldApp.listen(0, "127.0.0.1");
      const tokens = await Promise.all(Array.from({ length: 100 }, () => sign(randomUUID())));
      const responses = await Promise.all(
        tokens.map((token) =>
          request(coldApp.getHttpServer())
            .post("/v1/holds")
            .set("Authorization", `Bearer ${token}`)
            .send({ event_id: event, seat_ids: [seats[0]] }),
        ),
      );
      expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
      expect(responses.filter((response) => response.status === 409)).toHaveLength(99);
    } finally {
      await coldApp.close();
    }
  });

  it("returns a retryable 503 without writing seats when Redis rejects metadata", async () => {
    await cache.redis.set(`hexp:{evt:${event}}`, "wrong-type");
    const response = await create();
    expect(response.status).toBe(503);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.body.code).toBe("SEAT_HOLD_UNAVAILABLE");
    expect(await cache.redis.get(`seat:{evt:${event}}:${seats[0]}`)).toBeNull();
  });

  it("canonicalizes UUID case so users cannot bypass ownership or limits with alternate key casing", async () => {
    expect((await create([seats[0]])).status).toBe(201);
    const response = await request(app.getHttpServer())
      .post("/v1/holds")
      .set("Authorization", `Bearer ${await sign(other)}`)
      .send({ event_id: event.toUpperCase(), seat_ids: [seats[0].toUpperCase()] });
    expect(response.status).toBe(409);
    expect(response.body.seat_id).toBe(seats[0]);
    await request(app.getHttpServer())
      .post("/v1/holds")
      .set("Authorization", `Bearer ${await sign()}`)
      .send({ event_id: event, seat_ids: [seats[0], seats[0].toUpperCase()] })
      .expect(400);
    const current = await request(app.getHttpServer())
      .get(`/v1/holds?event_id=${event.toUpperCase()}`)
      .set("Authorization", `Bearer ${await sign(user.toUpperCase())}`);
    expect(current.status).toBe(200);
    expect(current.body.seat_ids).toEqual([seats[0]]);
  });
});
