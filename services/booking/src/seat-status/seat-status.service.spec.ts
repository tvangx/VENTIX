import { Test } from "@nestjs/testing";
import { createLogger } from "@ticketing/common";
import type { Response } from "express";
import { EventEmitter } from "node:events";
import { ENV, LOGGER } from "../app.tokens";
import { MetricsService } from "../metrics/metrics";
import { EventSnapshotRepository } from "../seat-hold/event-snapshot.repository";
import { SeatHoldRedisClient } from "../seat-hold/seat-hold-redis";
import { SeatStatusService } from "./seat-status.service";

describe("seat SSE lifecycle and batching", () => {
  const event = "11111111-1111-4111-8111-111111111111";
  const channel = `delta:{evt:${event}}`;
  let service: SeatStatusService;
  let metrics: MetricsService;
  let sub: EventEmitter & {
    status: string;
    connect: jest.Mock;
    psubscribe: jest.Mock;
    disconnect: jest.Mock;
  };
  let redis: {
    defineCommand: jest.Mock;
    duplicate: jest.Mock;
    seatSnapshot: jest.Mock;
    sweepSeats: jest.Mock;
  };
  let events: { eventIdsAfter: jest.Mock };
  const response = () =>
    Object.assign(new EventEmitter(), {
      destroyed: false,
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      flushHeaders: jest.fn(),
      write: jest.fn<boolean, [string]>(() => true),
      end: jest.fn(),
    });
  const send = (value: string) => sub.emit("pmessage", "delta:{evt:*}", channel, value);
  beforeEach(async () => {
    jest.useFakeTimers();
    sub = Object.assign(new EventEmitter(), {
      status: "ready",
      connect: jest.fn().mockResolvedValue(undefined),
      psubscribe: jest.fn().mockResolvedValue(1),
      disconnect: jest.fn(),
    });
    redis = {
      defineCommand: jest.fn(),
      duplicate: jest.fn(() => sub),
      seatSnapshot: jest.fn(
        async (_keys: number, _sold: string, _held: string, _channel: string, marker: string) => {
          send(`snapshot:${marker}`);
          return [[], [], String(Date.now())];
        },
      ),
      sweepSeats: jest.fn().mockResolvedValue([0, 0]),
    };
    events = { eventIdsAfter: jest.fn().mockResolvedValue([]) };
    const module = await Test.createTestingModule({
      providers: [
        SeatStatusService,
        MetricsService,
        { provide: ENV, useValue: { ADMISSION_REQUIRED: false } },
        { provide: LOGGER, useValue: createLogger("seat-unit", { level: "silent" }) },
        {
          provide: SeatHoldRedisClient,
          useValue: { connected: jest.fn().mockResolvedValue(redis) },
        },
        { provide: EventSnapshotRepository, useValue: events },
      ],
    }).compile();
    service = module.get(SeatStatusService);
    metrics = module.get(MetricsService);
    service.onApplicationBootstrap();
  });
  afterEach(async () => {
    await service.beforeApplicationShutdown();
    jest.useRealTimers();
  });

  it("ignores pre-snapshot deltas and retains post-marker deltas while snapshot is in flight", async () => {
    let release!: (value: [string[], string[], string]) => void;
    const captured = new Promise<void>((resolve) => {
      redis.seatSnapshot.mockImplementation(
        (_keys: number, _sold: string, _held: string, _channel: string, marker: string) => {
          send("H:stale");
          send(`snapshot:${marker}`);
          send("A:changed");
          resolve();
          return new Promise((done) => {
            release = done;
          });
        },
      );
    });
    const res = response();
    const opening = service.stream(event, res as unknown as Response);
    await captured;
    expect(res.write).not.toHaveBeenCalled();
    release([[], ["changed"], String(Date.now())]);
    await opening;
    expect(res.write.mock.calls[0][0]).toContain("event: snapshot");
    await jest.advanceTimersByTimeAsync(499);
    expect(res.write).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(res.write.mock.calls[1][0]).toBe('event: delta\ndata: ["A:changed"]\n\n');
  });

  it("shares one Redis subscription and removes only the disconnected client", async () => {
    const first = response();
    const second = response();
    await Promise.all([
      service.stream(event, first as unknown as Response),
      service.stream(event, second as unknown as Response),
    ]);
    expect(redis.duplicate).toHaveBeenCalledTimes(1);
    first.emit("close");
    send("H:seat");
    await jest.advanceTimersByTimeAsync(500);
    expect(first.write).toHaveBeenCalledTimes(1);
    expect(second.write).toHaveBeenCalledTimes(2);
    expect((await metrics.seatStreams.get()).values[0].value).toBe(1);
  });

  it("closes a slow client rather than buffering an unbounded backlog", async () => {
    const res = response();
    await service.stream(event, res as unknown as Response);
    res.write.mockReturnValue(false);
    send("H:seat");
    await jest.advanceTimersByTimeAsync(500);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect((await metrics.seatStreams.get()).values[0].value).toBe(0);
  });

  it("bounds pending changes and cleans up once when an in-flight snapshot fails after disconnect", async () => {
    const res = response();
    await service.stream(event, res as unknown as Response);
    for (let i = 0; i <= 10000; i++) send(`H:${i}`);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect((await metrics.seatStreams.get()).values[0].value).toBe(0);
    let reject!: (error: Error) => void;
    const reading = new Promise<void>((resolve) => {
      redis.seatSnapshot.mockImplementation(
        () =>
          new Promise((_done, fail) => {
            reject = fail;
            resolve();
          }),
      );
    });
    const other = response();
    const opening = service.stream(event, other as unknown as Response);
    await reading;
    other.emit("close");
    reject(new Error("network"));
    await expect(opening).rejects.toMatchObject({ message: expect.any(String) });
    expect((await metrics.seatStreams.get()).values[0].value).toBe(0);
  });

  it("drains expiry batches and paginates events without scanning Redis", async () => {
    events.eventIdsAfter.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);
    redis.sweepSeats.mockResolvedValueOnce([500, 500]).mockResolvedValueOnce([3, 3]);
    await service.sweep();
    expect(redis.sweepSeats).toHaveBeenCalledTimes(2);
    expect(events.eventIdsAfter.mock.calls[1][0]).toBe(event);
    expect((await metrics.seatExpired.get()).values[0].value).toBe(503);
  });

  it("emits sparse heartbeat and closes streams when subscriber loses its connection", async () => {
    const res = response();
    await service.stream(event, res as unknown as Response);
    await jest.advanceTimersByTimeAsync(15000);
    expect(res.write).toHaveBeenLastCalledWith(": heartbeat\n\n");
    sub.emit("close");
    expect(res.end).toHaveBeenCalledTimes(1);
    expect((await metrics.seatStreams.get()).values[0].value).toBe(0);
  });
});
