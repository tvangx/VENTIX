import type { Response } from "express";
import { EventEmitter } from "node:events";
import { ProblemException } from "@ticketing/common";
import { Env } from "../config/env.schema";
import { MetricsService } from "../metrics/metrics";
import { EventSnapshotRepository } from "../seat-hold/event-snapshot.repository";
import { SeatHoldRedisClient } from "../seat-hold/seat-hold-redis";
import { QueueStatusDto } from "./queue.dto";
import { QueueService } from "./queue.service";

describe("queue stream lifecycle", () => {
  let queue: QueueService;
  let metrics: MetricsService;
  let status: jest.SpyInstance<Promise<QueueStatusDto>>;
  const waiting: QueueStatusDto = { status: "waiting", position: 0, estimated_wait_sec: 1 };
  const response = () =>
    Object.assign(new EventEmitter(), {
      destroyed: false,
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      flushHeaders: jest.fn(),
      write: jest.fn(() => true),
      end: jest.fn(),
    });
  beforeEach(() => {
    jest.useFakeTimers();
    metrics = new MetricsService();
    queue = new QueueService(
      { QUEUE_MAX_STREAMS: 2 } as Env,
      {} as EventSnapshotRepository,
      {} as SeatHoldRedisClient,
      metrics,
    );
    status = jest.spyOn(queue, "status").mockResolvedValue(waiting);
  });
  afterEach(() => {
    queue.beforeApplicationShutdown();
    jest.useRealTimers();
  });

  it("closes a slow client instead of buffering an unbounded stream", async () => {
    const res = response();
    res.write.mockReturnValue(false);
    await queue.stream("event", "user", res as unknown as Response);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect((await metrics.queueStreams.get()).values[0].value).toBe(0);
    await jest.advanceTimersByTimeAsync(2000);
    expect(status).toHaveBeenCalledTimes(1);
  });

  it("propagates an initial error before sending SSE headers", async () => {
    const res = response();
    status.mockRejectedValue(new ProblemException("QUEUE_UNAVAILABLE", 503, "Retry"));
    await expect(queue.stream("event", "user", res as unknown as Response)).rejects.toMatchObject({
      code: "QUEUE_UNAVAILABLE",
    });
    expect(res.flushHeaders).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
    expect((await metrics.queueStreams.get()).values[0].value).toBe(0);
  });

  it("sends a safe error frame after headers then cancels polling", async () => {
    const res = response();
    status.mockResolvedValueOnce(waiting).mockRejectedValue(new Error("private backend detail"));
    const stream = queue.stream("event", "user", res as unknown as Response);
    await jest.advanceTimersByTimeAsync(1000);
    await stream;
    expect(res.write).toHaveBeenLastCalledWith(
      'event: error\ndata: {"code":"QUEUE_UNAVAILABLE"}\n\n',
    );
    await jest.advanceTimersByTimeAsync(5000);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("shutdown closes active streams and does not restart timers", async () => {
    const res = response();
    const stream = queue.stream("event", "user", res as unknown as Response);
    await jest.advanceTimersByTimeAsync(0);
    queue.beforeApplicationShutdown();
    await stream;
    await jest.advanceTimersByTimeAsync(2000);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);
    await expect(
      queue.stream("event", "user", response() as unknown as Response),
    ).rejects.toMatchObject({ code: "QUEUE_UNAVAILABLE" });
  });

  it("disconnect during an in-flight initial read cannot leak a timer or decrement twice", async () => {
    const res = response();
    let reject!: (reason: Error) => void;
    status.mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const stream = queue.stream("event", "user", res as unknown as Response);
    res.destroyed = true;
    res.emit("close");
    reject(new Error("disconnected"));
    await stream;
    expect((await metrics.queueStreams.get()).values[0].value).toBe(0);
    expect(res.write).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});
