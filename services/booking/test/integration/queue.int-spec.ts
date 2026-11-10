import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { SignJWT } from "jose";
import request from "supertest";
import { AdmissionWorker } from "../../src/queue/admission-worker.service";
import { AdmissionTokens } from "../../src/queue/admission-token";
import { QueueStatusDto } from "../../src/queue/queue.dto";
import { queueKeys } from "../../src/queue/queue-redis";
import { QueueService } from "../../src/queue/queue.service";
import { MetricsService } from "../../src/metrics/metrics";
import { checkoutFixture, CheckoutFixture } from "../support/checkout";
import { openSeatStream } from "../support/seat-stream";

describe("Waiting Room HTTP, JWT, SSE, PostgreSQL and Redis", () => {
  let f: CheckoutFixture;
  let queue: QueueService;
  let base: string;
  const streams: Awaited<ReturnType<typeof openSeatStream>>[] = [];
  beforeAll(async () => {
    f = await checkoutFixture();
    queue = f.app.get(QueueService);
    await f.app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(f.app.getHttpServer().address() as AddressInfo).port}/v1`;
  });
  afterEach(() => {
    for (const stream of streams.splice(0)) stream.close();
    f.env.QUEUE_MAX_STREAMS = 1000;
  });
  afterAll(async () => {
    await f?.close();
  });
  const join = async (event: string, user: string) =>
    request(f.app.getHttpServer())
      .post("/v1/queue/join")
      .auth(await f.token(user), { type: "bearer" })
      .send({ event_id: event });
  const admitted = async (event: string, user: string) => {
    expect((await join(event, user)).status).toBe(201);
    await f.app.get(AdmissionWorker).sweep();
    const status = await queue.status(event, user);
    expect(status.status).toBe("admitted");
    return status.admission_token!;
  };

  it("requires JWT and validated event UUID; repeat join retains score and FIFO rank", async () => {
    const s = await f.seed(100, true);
    await request(f.app.getHttpServer())
      .post("/v1/queue/join")
      .send({ event_id: s.event })
      .expect(401);
    await request(f.app.getHttpServer())
      .post("/v1/queue/join")
      .auth(await f.token(s.user), { type: "bearer" })
      .send({ event_id: "invalid" })
      .expect(400);
    const a = await join(s.event, s.user);
    expect(a.body).toMatchObject({ status: "waiting", position: 0, estimated_wait_sec: 1 });
    const key = queueKeys(s.event)[0];
    const score = await f.cache.redis.zscore(key, s.user);
    const other = randomUUID();
    expect((await join(s.event, other)).body.position).toBe(1);
    expect((await join(s.event, s.user)).body.position).toBe(0);
    expect(await f.cache.redis.zscore(key, s.user)).toBe(score);
    expect(await f.cache.redis.zcard(key)).toBe(2);
    expect(await f.cache.redis.ttl(key)).toBeGreaterThan(0);
    expect((await queue.status(s.event, randomUUID())).status).toBe("not_joined");
  });

  it("SSE delivers admission; reconnect and repeat join replay it; token permits hold, seat stream and checkout", async () => {
    const s = await f.seed(100, true);
    await join(s.event, s.user);
    const auth = await f.token(s.user);
    const stream = await openSeatStream(`${base}/queue/status?event_id=${s.event}`, auth);
    streams.push(stream);
    expect(
      (await stream.wait((frame) => (frame.data as QueueStatusDto).status === "waiting")).data,
    ).toMatchObject({ position: 0 });
    await f.app.get(AdmissionWorker).sweep();
    const frame = await stream.wait(
      (frame) => (frame.data as QueueStatusDto).status === "admitted",
    );
    const status = frame.data as QueueStatusDto;
    const token = status.admission_token!;
    const replay = await openSeatStream(`${base}/queue/status?event_id=${s.event}`, auth);
    streams.push(replay);
    expect((await replay.wait(() => true)).data).toEqual(status);
    expect((await join(s.event, s.user)).body).toEqual(status);
    expect(await f.cache.redis.zcard(queueKeys(s.event)[0])).toBe(0);
    expect(
      await new AdmissionTokens(f.env.ADMISSION_TOKEN_SECRET!).verify(token, s.user, s.event),
    ).toMatchObject({ sub: s.user, evt: s.event });
    await request(f.app.getHttpServer())
      .post("/v1/holds")
      .auth(auth, { type: "bearer" })
      .set("X-Admission-Token", token)
      .send({ event_id: s.event, seat_ids: [s.seat] })
      .expect(201);
    const seats = await openSeatStream(`${base}/events/${s.event}/seat-stream`, auth, token);
    streams.push(seats);
    await seats.wait((frame) => frame.event === "snapshot");
    expect((await f.post(s.user, s.input, randomUUID(), token)).status).toBe(201);
  });

  it("missing, expired, other-event, other-user, forged and other-algorithm tokens are 403 on all gated routes", async () => {
    const s = await f.seed(100, true);
    const token = await admitted(s.event, s.user);
    const now = Math.floor(Date.now() / 1000);
    const signer = new AdmissionTokens(f.env.ADMISSION_TOKEN_SECRET!);
    const grant = { jti: randomUUID(), iat: now, exp: now + 600 };
    const bad = [
      undefined,
      "broken",
      await signer.sign(s.user, s.event, { ...grant, iat: now - 601, exp: now - 1 }),
      await signer.sign(s.user, randomUUID(), grant),
      await signer.sign(randomUUID(), s.event, grant),
      await new AdmissionTokens("other-synthetic-secret-for-booking-tests").sign(
        s.user,
        s.event,
        grant,
      ),
      await new SignJWT({ evt: s.event, ...grant })
        .setSubject(s.user)
        .setIssuer("booking-admission")
        .setAudience("booking")
        .setProtectedHeader({ alg: "HS384" })
        .sign(Buffer.from(f.env.ADMISSION_TOKEN_SECRET!)),
    ];
    const auth = await f.token(s.user);
    for (const admission of bad) {
      for (const route of ["holds", "checkout", "seat-stream"]) {
        const req =
          route === "seat-stream"
            ? request(f.app.getHttpServer()).get(`/v1/events/${s.event}/seat-stream`)
            : request(f.app.getHttpServer()).post(`/v1/${route}`);
        req.auth(auth, { type: "bearer" }).set("Idempotency-Key", randomUUID());
        if (admission) req.set("X-Admission-Token", admission);
        if (route !== "seat-stream") req.send(s.input);
        const result = await req;
        expect(result.status).toBe(403);
        expect(result.body.code).toBe("ADMISSION_REQUIRED");
        expect(result.headers["content-type"]).toContain("application/problem+json");
      }
    }
    // Even a correctly signed token must match the live grant, not just user/event.
    await f.cache.redis.zadd(queueKeys(s.event)[1], Date.now() - 1, s.user);
    expect((await f.post(s.user, s.input, randomUUID(), token)).status).toBe(403);
    expect(f.calls()).toBe(0);
  });

  it("queue_enabled=false bypasses admission with the new default enabled", async () => {
    const s = await f.seed();
    expect(f.env.ADMISSION_REQUIRED).toBe(true);
    expect((await join(s.event, s.user)).body.status).toBe("disabled");
    await request(f.app.getHttpServer())
      .post("/v1/holds")
      .auth(await f.token(s.user), { type: "bearer" })
      .send({ event_id: s.event, seat_ids: [s.seat] })
      .expect(201);
    expect((await f.post(s.user, s.input, randomUUID())).status).toBe(201);
  });

  it("validates Redis key types before any writes and returns 503 with Retry-After", async () => {
    const s = await f.seed(100, true);
    const keys = queueKeys(s.event);
    await f.cache.redis.set(keys[2], "wrong-type");
    const response = await join(s.event, s.user);
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("QUEUE_UNAVAILABLE");
    expect(response.headers["retry-after"]).toBe("1");
    expect(await f.cache.redis.exists(keys[0], keys[1], keys[3], keys[4])).toBe(0);
    await request(f.app.getHttpServer())
      .get(`/v1/queue/status?event_id=${s.event}`)
      .auth(await f.token(s.user), { type: "bearer" })
      .expect(503);
  });

  it("bounds SSE connections and cleans up disconnected clients", async () => {
    const s = await f.seed(100, true);
    await join(s.event, s.user);
    f.env.QUEUE_MAX_STREAMS = 1;
    const auth = await f.token(s.user);
    const first = await openSeatStream(`${base}/queue/status?event_id=${s.event}`, auth);
    streams.push(first);
    await first.wait(() => true);
    await request(f.app.getHttpServer())
      .get(`/v1/queue/status?event_id=${s.event}`)
      .auth(auth, { type: "bearer" })
      .expect(503);
    first.close();
    // Await socket close propagation using a condition rather than a fixed delay.
    const { pollUntil } = await import("../support/booking-redis");
    await pollUntil(
      async () => (await f.app.get(MetricsService).queueStreams.get()).values[0].value === 0,
    );
    const next = await openSeatStream(`${base}/queue/status?event_id=${s.event}`, auth);
    streams.push(next);
    await next.wait(() => true);
  });
});
