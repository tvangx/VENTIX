import { randomUUID } from "node:crypto";
import { createLogger } from "@ticketing/common";
import { AdmissionWorker } from "../../src/queue/admission-worker.service";
import { QueueService } from "../../src/queue/queue.service";
import { queueKeys } from "../../src/queue/queue-redis";
import { MetricsService } from "../../src/metrics/metrics";
import { SeatHoldRedisClient } from "../../src/seat-hold/seat-hold-redis";
import { EventSnapshotRepository } from "../../src/seat-hold/event-snapshot.repository";
import { checkoutFixture, CheckoutFixture } from "../support/checkout";
import { pollUntil } from "../support/booking-redis";

describe("Waiting Room two replicas on real Redis", () => {
  let f: CheckoutFixture;
  let other: SeatHoldRedisClient;
  let queues: QueueService[];
  let workers: AdmissionWorker[];
  beforeAll(async () => {
    f = await checkoutFixture();
    other = new SeatHoldRedisClient(f.env);
    const metrics = f.app.get(MetricsService);
    const snapshots = f.app.get(EventSnapshotRepository);
    queues = [f.app.get(QueueService), new QueueService(f.env, snapshots, other, metrics)];
    workers = queues.map(
      (queue) =>
        new AdmissionWorker(
          f.env,
          createLogger("queue-replica", { level: "silent" }),
          snapshots,
          queue,
          metrics,
        ),
    );
  });
  afterAll(async () => {
    for (const worker of workers ?? []) await worker.beforeApplicationShutdown();
    other?.onApplicationShutdown();
    await f?.close();
  });

  it("100 simultaneous joins on two connections keep one place per user and stable FIFO scores", async () => {
    const s = await f.seed(100, true);
    await queues[0].status(s.event, s.user, true);
    const keys = queueKeys(s.event);
    const firstScore = await f.cache.redis.zscore(keys[0], s.user);
    const others = Array.from({ length: 50 }, () => randomUUID());
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        queues[i % 2].status(s.event, i < 50 ? s.user : others[i - 50], true),
      ),
    );
    expect(await f.cache.redis.zcard(keys[0])).toBe(51);
    expect(await f.cache.redis.zrank(keys[0], s.user)).toBe(0);
    expect(await f.cache.redis.zscore(keys[0], s.user)).toBe(firstScore);
    const scores = (await f.cache.redis.zrange(keys[0], 0, -1, "WITHSCORES")).filter(
      (_, i) => i % 2 === 1,
    );
    expect(new Set(scores).size).toBe(51);
  });

  it("two live one-second workers admit exactly 7 per Redis tick, never 14", async () => {
    const s = await f.seed(100, true);
    await f.db.pool.query(
      "UPDATE event_snapshots SET sale_window=jsonb_set(sale_window,'{0,admit_rate}','7') WHERE event_id=$1",
      [s.event],
    );
    await Promise.all(
      Array.from({ length: 100 }, (_, i) => queues[i % 2].status(s.event, randomUUID(), true)),
    );
    f.env.QUEUE_WORKER_ENABLED = true;
    for (const worker of workers) worker.onApplicationBootstrap();
    try {
      await pollUntil(async () => (await f.cache.redis.zcard(queueKeys(s.event)[1])) >= 21, 8000);
    } finally {
      for (const worker of workers) await worker.beforeApplicationShutdown();
      f.env.QUEUE_WORKER_ENABLED = false;
    }
    const scores = (await f.cache.redis.zrange(queueKeys(s.event)[1], 0, -1, "WITHSCORES")).filter(
      (_, i) => i % 2 === 1,
    );
    const ticks = new Map<string, number>();
    for (const score of scores) ticks.set(score, (ticks.get(score) ?? 0) + 1);
    expect(ticks.size).toBeGreaterThanOrEqual(3);
    expect([...ticks.values()].every((count) => count === 7)).toBe(true);
    expect(await f.cache.redis.zcard(queueKeys(s.event)[0])).toBe(100 - scores.length);
  });

  it("50 simultaneous admission attempts respect active cap; expired grants free slots without renewing old users", async () => {
    const s = await f.seed(100, true);
    const users = Array.from({ length: 20 }, () => randomUUID());
    await Promise.all(users.map((user, i) => queues[i % 2].status(s.event, user, true)));
    const phase = await queues[0].phase(s.event);
    const keys = queueKeys(s.event);
    f.env.ADMISSION_MAX_ACTIVE = 5;
    try {
      await Promise.all(
        Array.from({ length: 50 }, (_, i) => queues[i % 2].operation(s.event, "", "admit", phase)),
      );
      expect(await f.cache.redis.zcard(keys[1])).toBe(5);
      expect(await f.cache.redis.zcard(keys[0])).toBe(15);
      expect(await f.cache.redis.pttl(keys[1])).toBeGreaterThan(0);
      expect(await f.cache.redis.pttl(keys[2])).toBeGreaterThan(0);
      const active = await f.cache.redis.zrange(keys[1], 0, -1);
      const original = await queues[0].status(s.event, active[0]);
      expect(await queues[1].status(s.event, active[0], true)).toEqual(original);
      // Expire only Redis admission records; no five-minute fixed sleep in tests.
      for (const user of active) await f.cache.redis.zadd(keys[1], Date.now() - 1, user);
      await pollUntil(async () => {
        await queues[1].operation(s.event, "", "admit", phase);
        return (await f.cache.redis.zcard(keys[1])) === 5;
      });
      expect(await f.cache.redis.zcard(keys[0])).toBe(10);
      for (const user of active) expect(await f.cache.redis.hget(keys[2], user)).toBeNull();
      expect((await queues[1].status(s.event, active[0])).status).toBe("not_joined");
    } finally {
      f.env.ADMISSION_MAX_ACTIVE = 1000;
    }
  });

  it("a stale phase cannot admit after its end even when a replica pauses before Lua", async () => {
    const s = await f.seed(100, true);
    await queues[0].status(s.event, s.user, true);
    const phase = await queues[0].phase(s.event);
    await expect(
      queues[1].operation(s.event, "", "admit", {
        ...phase,
        ends_at: new Date(Date.now() - 1).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "EVENT_NOT_ON_SALE" });
    expect(await f.cache.redis.zcard(queueKeys(s.event)[0])).toBe(1);
    expect(await f.cache.redis.zcard(queueKeys(s.event)[1])).toBe(0);
  });
});
