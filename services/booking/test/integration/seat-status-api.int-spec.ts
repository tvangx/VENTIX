import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { createLogger, loadEnv } from "@ticketing/common";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import request from "supertest";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";
import { SeatStatusService } from "../../src/seat-status/seat-status.service";
import { BookingDb, startBookingDb } from "../support/booking-db";
import { BookingRedis, pollUntil, startBookingRedis } from "../support/booking-redis";
import { openSeatStream, SeatFrame } from "../support/seat-stream";

describe("seat status HTTP and two SSE replicas", () => {
  let db: BookingDb;
  let cache: BookingRedis;
  const apps: INestApplication[] = [];
  const streams: Awaited<ReturnType<typeof openSeatStream>>[] = [];
  let token: string;
  let publicKey: string;
  let base: string[];
  let event: string;
  const seat = randomUUID();
  const otherEvent = randomUUID();
  const has = (delta: string) => (frame: SeatFrame) =>
    frame.event === "delta" && Array.isArray(frame.data) && frame.data.includes(delta);
  const env = (admission = "false") =>
    loadEnv(envSchema, {
      NODE_ENV: "test",
      DATABASE_URL: db.pool.options.connectionString,
      REDIS_URL: cache.url,
      EVENT_CONSUMER_ENABLED: "false",
      REHYDRATE_ENABLED: "false",
      HOLD_TTL_SECONDS: "2",
      AUTH_ISSUER: "seat-test",
      AUTH_AUDIENCE: "ticketing-api",
      AUTH_PUBLIC_KEY_PEM: publicKey,
      ADMISSION_REQUIRED: admission,
    });
  const connect = async (replica = 0) => {
    const stream = await openSeatStream(`${base[replica]}/v1/events/${event}/seat-stream`, token);
    streams.push(stream);
    await stream.wait((frame) => frame.event === "snapshot");
    return stream;
  };
  beforeAll(async () => {
    db = await startBookingDb();
    cache = await startBookingRedis();
    const pair = await generateKeyPair("RS256");
    publicKey = await exportSPKI(pair.publicKey);
    token = await new SignJWT({ roles: ["USER"] })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(randomUUID())
      .setIssuer("seat-test")
      .setAudience("ticketing-api")
      .setExpirationTime("10m")
      .sign(pair.privateKey);
    for (let i = 0; i < 2; i++) {
      const app = await createApp(env(), createLogger("seat-test", { level: "silent" }));
      await app.listen(0, "127.0.0.1");
      apps.push(app);
    }
    base = await Promise.all(apps.map((app) => app.getUrl()));
  });
  beforeEach(async () => {
    event = randomUUID();
    await db.pool.query(
      `INSERT INTO event_snapshots (event_id,organizer_id,status,event_version,seat_map_version,pricing_ready,ticket_classes,sale_window)
      VALUES ($1,$2,'APPROVED',1,1,true,'[]',$3)`,
      [
        event,
        randomUUID(),
        JSON.stringify({
          starts_at: new Date(Date.now() - 60000).toISOString(),
          ends_at: new Date(Date.now() + 60000).toISOString(),
        }),
      ],
    );
  });
  afterEach(() => {
    for (const stream of streams.splice(0)) stream.close();
  });
  afterAll(async () => {
    for (const app of apps) await app.close();
    await cache?.close();
    await db?.close();
  });

  it("requires JWT, validates UUID, and returns canonicalized snapshot with live held seats", async () => {
    await request(apps[0].getHttpServer()).get(`/v1/events/${event}/seat-status`).expect(401);
    await request(apps[0].getHttpServer()).get(`/v1/events/${event}/seat-stream`).expect(401);
    await request(apps[0].getHttpServer())
      .get("/v1/events/bad/seat-status")
      .auth(token, { type: "bearer" })
      .expect(400);
    await request(apps[0].getHttpServer())
      .get("/v1/events/bad/seat-stream")
      .auth(token, { type: "bearer" })
      .expect(400);
    await cache.redis.sadd(`sold:{evt:${event}}`, "sold");
    await cache.redis.zadd(`hexp:{evt:${event}}`, Date.now() + 10000, seat, 0, "expired");
    const result = await request(apps[0].getHttpServer())
      .get(`/v1/events/${event.toUpperCase()}/seat-status`)
      .auth(token, { type: "bearer" })
      .expect(200);
    expect(result.body).toEqual({ sold: ["sold"], held: [seat], as_of: expect.any(String) });
    expect(Number.isNaN(Date.parse(result.body.as_of))).toBe(false);
    const stream = await connect();
    expect(stream.frames[0].data).toMatchObject({ sold: ["sold"], held: [seat] });
  });

  it("delivers H within 1 second and one A per client after TTL with two replicas", async () => {
    const clients = await Promise.all([connect(0), connect(1)]);
    const raw: string[] = [];
    const observer = cache.redis.duplicate();
    await observer.subscribe(`delta:{evt:${event}}`);
    observer.on("message", (_channel: string, message: string) => raw.push(message));
    try {
      const start = Date.now();
      await request(apps[0].getHttpServer())
        .post("/v1/holds")
        .auth(token, { type: "bearer" })
        .send({ event_id: event, seat_ids: [seat] })
        .expect(201);
      const held = await Promise.all(clients.map((client) => client.wait(has(`H:${seat}`), 1000)));
      const latency = Math.max(...held.map((frame) => frame.at - start));
      expect(latency).toBeLessThanOrEqual(1000);
      await Promise.all(clients.map((client) => client.wait(has(`A:${seat}`))));
      // Hai lượt sweep bổ sung phải không tạo thêm thông báo hết hạn.
      await Promise.all(apps.map((app) => app.get(SeatStatusService).sweep()));
      await cache.redis.publish(`delta:{evt:${event}}`, "test-barrier");
      await pollUntil(async () => raw.includes("test-barrier"));
      expect(raw.filter((value) => value === `A:${seat}`)).toHaveLength(1);
      for (const client of clients) expect(client.frames.filter(has(`A:${seat}`))).toHaveLength(1);
      process.stdout.write(
        `T-204 measurement: H max latency=${latency}ms; expiry A publishes=1; SSE clients=2\n`,
      );
    } finally {
      await observer.quit();
    }
  });

  it("coalesces a burst to the last state per seat and isolates events", async () => {
    const stream = await connect();
    await cache.redis
      .pipeline()
      .publish(`delta:{evt:${event}}`, `H:${seat}`)
      .publish(`delta:{evt:${event}}`, `A:${seat}`)
      .publish(`delta:{evt:${event}}`, `S:${seat}`)
      .publish(`delta:{evt:${otherEvent}}`, "H:foreign")
      .exec();
    const frame = await stream.wait(has(`S:${seat}`));
    expect(frame.data).toEqual([`S:${seat}`]);
    expect(stream.frames.filter((frame) => frame.event === "delta")).toHaveLength(1);
  });

  it("returns problem+json and Retry-After when Redis metadata is invalid", async () => {
    await cache.redis.set(`hexp:{evt:${event}}`, "wrong-type");
    for (const path of ["seat-status", "seat-stream"]) {
      const result = await request(apps[0].getHttpServer())
        .get(`/v1/events/${event}/${path}`)
        .auth(token, { type: "bearer" })
        .expect(503);
      expect(result.headers["retry-after"]).toBe("1");
      expect(result.headers["content-type"]).toContain("application/problem+json");
      expect(result.body.code).toBe("SEAT_STATUS_UNAVAILABLE");
    }
  });

  it("fails closed when admission is required, until T-304", async () => {
    const app = await createApp(env("true"), createLogger("seat-test", { level: "silent" }));
    try {
      await app.init();
      const result = await request(app.getHttpServer())
        .get(`/v1/events/${event}/seat-stream`)
        .auth(token, { type: "bearer" })
        .expect(403);
      expect(result.body.code).toBe("ADMISSION_REQUIRED");
    } finally {
      await app.close();
    }
  });

  it("closes clients on Pub/Sub disconnect so reconnect gets a fresh snapshot", async () => {
    const stream = await connect();
    const connections = (await cache.redis.client("LIST")) as string;
    const ids = connections
      .split("\n")
      .filter((line) => /\bcmd=psubscribe\b/.test(line))
      .map((line) => /\bid=(\d+)/.exec(line)?.[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) if (id) await cache.redis.client("KILL", "ID", id);
    await pollUntil(async () => stream.response.complete);
    const reconnected = await connect();
    expect(reconnected.frames[0].event).toBe("snapshot");
  });
});
