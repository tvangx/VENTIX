import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Logger, ProblemException } from "@ticketing/common";
import type { Response } from "express";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { ENV, LOGGER } from "../app.tokens";
import { Env } from "../config/env.schema";
import { MetricsService } from "../metrics/metrics";
import { EventSnapshotRepository } from "../seat-hold/event-snapshot.repository";
import { SeatHoldRedisClient } from "../seat-hold/seat-hold-redis";
import { SeatStatusDto } from "./seat-status.dto";
import { registerSeatStatusCommands, SeatStatusRedis } from "./seat-status-redis";

interface StreamClient {
  eventId: string;
  marker: string;
  collecting: boolean;
  ready: boolean;
  pending: Map<string, string>;
  res: Response;
  close: () => void;
}

@Injectable()
export class SeatStatusService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly streams = new Set<StreamClient>();
  private subscriber?: Redis;
  private subscription?: Promise<void>;
  private batchTimer?: NodeJS.Timeout;
  private sweepTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private sweepJob?: Promise<void>;
  private stopping = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly client: SeatHoldRedisClient,
    private readonly events: EventSnapshotRepository,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    this.batchTimer = setInterval(() => this.flush(), 500);
    this.heartbeatTimer = setInterval(() => {
      for (const stream of this.streams) {
        if (stream.ready && !stream.res.write(": heartbeat\n\n")) stream.close();
      }
    }, 15000);
    this.sweepTimer = setInterval(() => {
      if (!this.sweepJob && !this.stopping) {
        this.sweepJob = this.sweep()
          .catch(() => {
            this.metrics.seatStatusFailures.inc({ operation: "sweep" });
            this.logger.warn(
              { request_id: "seat-sweeper", trace_id: "seat-sweeper" },
              "Seat expiry sweep failed; retrying next tick",
            );
          })
          .finally(() => {
            this.sweepJob = undefined;
          });
      }
    }, 1000);
  }

  private async redis(): Promise<SeatStatusRedis> {
    return registerSeatStatusCommands(await this.client.connected());
  }

  private unavailable(): ProblemException {
    return new ProblemException(
      "SEAT_STATUS_UNAVAILABLE",
      503,
      "Seat status is temporarily unavailable; reconnect for a fresh snapshot",
    );
  }

  async snapshot(eventId: string, marker = ""): Promise<SeatStatusDto> {
    try {
      const redis = await this.redis();
      const slot = `{evt:${eventId}}`;
      const [sold, held, now] = await redis.seatSnapshot(
        2,
        `sold:${slot}`,
        `hexp:${slot}`,
        marker ? `delta:${slot}` : "",
        marker,
      );
      return { sold: sold.sort(), held: held.sort(), as_of: new Date(Number(now)).toISOString() };
    } catch {
      this.metrics.seatStatusFailures.inc({ operation: "snapshot" });
      throw this.unavailable();
    }
  }

  private async subscribe(): Promise<void> {
    if (this.stopping) throw this.unavailable();
    if (!this.subscription) {
      this.subscription = (async () => {
        const redis = await this.client.connected();
        const sub = redis.duplicate({ lazyConnect: true });
        this.subscriber = sub;
        sub.on("error", () => undefined);
        sub.on("pmessage", (_pattern: string, channel: string, message: string) =>
          this.receive(channel, message),
        );
        // Pub/Sub không replay: đóng stream khi mất kết nối để reconnect lấy snapshot.
        sub.on("close", () => {
          for (const stream of this.streams) stream.close();
          this.subscription = undefined;
          sub.disconnect();
        });
        await sub.connect();
        await sub.psubscribe("delta:{evt:*}");
      })().catch(() => {
        this.subscriber?.disconnect();
        this.subscription = undefined;
        throw this.unavailable();
      });
    }
    await this.subscription;
  }

  private receive(channel: string, message: string): void {
    const match = /^delta:\{evt:([0-9a-f-]+)\}$/.exec(channel);
    if (!match) return;
    for (const stream of this.streams) {
      if (stream.eventId !== match[1]) continue;
      if (message === `snapshot:${stream.marker}`) stream.collecting = true;
      if (!stream.collecting || !/^[HAS]:[^:]+$/.test(message)) continue;
      const id = message.slice(2);
      stream.pending.set(id, message);
      if (stream.pending.size > 10000) stream.close();
    }
  }

  async stream(eventId: string, res: Response): Promise<void> {
    if (this.env.ADMISSION_REQUIRED) {
      throw new ProblemException(
        "ADMISSION_REQUIRED",
        403,
        "Admission is required before subscribing to seat status",
      );
    }
    await this.subscribe();
    if (res.destroyed || this.stopping || this.subscriber?.status !== "ready")
      throw this.unavailable();
    const stream: StreamClient = {
      eventId,
      marker: randomUUID(),
      collecting: false,
      ready: false,
      pending: new Map(),
      res,
      close: () => {
        if (!this.streams.delete(stream)) return;
        this.metrics.seatStreams.dec();
        res.off("close", stream.close);
        res.end();
      },
    };
    this.streams.add(stream);
    this.metrics.seatStreams.inc();
    res.once("close", stream.close);
    try {
      const snapshot = await this.snapshot(eventId, stream.marker);
      if (!this.streams.has(stream) || res.destroyed) {
        stream.close();
        return;
      }
      res.status(200).set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      if (!res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)) {
        stream.close();
        return;
      }
      stream.ready = true;
    } catch (error) {
      if (this.streams.delete(stream)) this.metrics.seatStreams.dec();
      res.off("close", stream.close);
      throw error;
    }
  }

  private flush(): void {
    for (const stream of this.streams) {
      if (!stream.ready || !stream.pending.size) continue;
      const deltas = [...stream.pending.values()];
      stream.pending.clear();
      this.metrics.seatDeltaBatches.inc();
      if (!stream.res.write(`event: delta\ndata: ${JSON.stringify(deltas)}\n\n`)) stream.close();
    }
  }

  async sweep(): Promise<void> {
    let cursor = "00000000-0000-0000-0000-000000000000";
    const redis = await this.redis();
    while (!this.stopping) {
      const events = await this.events.eventIdsAfter(cursor);
      if (!events.length) return;
      for (const eventId of events) {
        const slot = `{evt:${eventId}}`;
        // Mỗi Lua tối đa 500 ghế để không khóa Redis lâu. Drain backlog cùng tick.
        // Giới hạn 20 batch/event để các event khác vẫn được xử lý khi flash sale kéo dài.
        for (let batch = 0; batch < 20 && !this.stopping; batch++) {
          const [visited, expired] = await redis.sweepSeats(
            1,
            `hexp:${slot}`,
            `seat:${slot}:`,
            `delta:${slot}`,
          );
          this.metrics.seatExpired.inc(expired);
          if (visited < 500) break;
        }
      }
      cursor = events[events.length - 1];
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearInterval(this.batchTimer);
    clearInterval(this.sweepTimer);
    clearInterval(this.heartbeatTimer);
    for (const stream of this.streams) stream.close();
    await this.subscription?.catch(() => undefined);
    this.subscriber?.disconnect();
    await this.sweepJob;
  }
}
