import { Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { z } from "zod";
import { ENV } from "../app.tokens";
import type { Env } from "../config/env.schema";
import { MetricsService } from "../metrics/metrics";
import { EventSnapshotRepository } from "./event-snapshot.repository";
import {
  CreateHoldDto,
  CurrentHoldResponseDto,
  HoldResponseDto,
  ReleaseHoldDto,
} from "./seat-hold.dto";
import { SeatHoldRedis, SeatHoldRedisClient } from "./seat-hold-redis";

const salePhase = z.object({ starts_at: z.string().datetime(), ends_at: z.string().datetime() });
const saleWindow = z.union([salePhase, z.array(salePhase)]);

@Injectable()
export class SeatHoldService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly snapshots: EventSnapshotRepository,
    private readonly client: SeatHoldRedisClient,
    private readonly metrics: MetricsService,
  ) {}

  private holdKey(eventId: string, userId: string): string {
    return `hold:{evt:${eventId}}:${userId}`;
  }
  private seatKey(eventId: string, seatId: string): string {
    return `seat:{evt:${eventId}}:${seatId}`;
  }

  private async redisCall<T>(operation: (redis: SeatHoldRedis) => Promise<T>): Promise<T> {
    try {
      return await operation(await this.client.connected());
    } catch {
      throw new ProblemException(
        "SEAT_HOLD_UNAVAILABLE",
        503,
        "Seat holds are temporarily unavailable; retry the request",
      );
    }
  }

  async hold(userId: string, input: CreateHoldDto): Promise<HoldResponseDto> {
    if (this.env.ADMISSION_REQUIRED) {
      // TODO(T-304): thay bằng guard verify admission token của Waiting Room.
      throw new ProblemException(
        "ADMISSION_REQUIRED",
        403,
        "Admission is required before holding seats",
      );
    }
    const snapshot = await this.snapshots.find(input.event_id);
    const now = Date.now();
    const parsedWindow = saleWindow.safeParse(snapshot?.sale_window);
    const phases = parsedWindow.success
      ? Array.isArray(parsedWindow.data)
        ? parsedWindow.data
        : [parsedWindow.data]
      : [];
    if (
      !snapshot ||
      !["APPROVED", "PUBLISHED"].includes(snapshot.status) ||
      !phases.some((phase) => Date.parse(phase.starts_at) <= now && now < Date.parse(phase.ends_at))
    ) {
      throw new ProblemException("EVENT_NOT_ON_SALE", 404, "Event is not currently on sale");
    }
    if (!snapshot.pricing_ready) {
      throw new ProblemException("EVENT_NOT_READY", 503, "Event pricing is not ready; retry later");
    }
    let expiresAt = 0;
    const result = await this.redisCall((redis) => {
      // Đợi kết nối xong mới tính expiry, tránh hexp sớm hơn TTL vì cold connection.
      const commandNow = Date.now();
      expiresAt = commandNow + this.env.HOLD_TTL_SECONDS * 1000;
      return redis.holdSeats(
        input.seat_ids.length + 1,
        this.holdKey(input.event_id, userId),
        ...input.seat_ids.map((id) => this.seatKey(input.event_id, id)),
        `H:${userId}`,
        this.env.HOLD_TTL_SECONDS,
        this.env.HOLD_MAX_SEATS,
        commandNow,
        ...input.seat_ids,
      );
    });
    if (result[0] === 0) {
      this.metrics.seatHoldOutcomes.inc({ outcome: "conflict" });
      const seatId = result[1].slice(`seat:{evt:${input.event_id}}:`.length);
      throw new ProblemException("SEAT_UNAVAILABLE", 409, "A requested seat is unavailable", {
        seat_id: seatId,
      });
    }
    if (result[0] === 2) {
      this.metrics.seatHoldOutcomes.inc({ outcome: "limit" });
      throw new ProblemException(
        "HOLD_LIMIT_EXCEEDED",
        422,
        "Maximum held seats per user and event exceeded",
      );
    }
    this.metrics.seatHoldOutcomes.inc({ outcome: "success" });
    return {
      expires_at: new Date(expiresAt).toISOString(),
      seat_ids: input.seat_ids,
    };
  }

  async current(userId: string, eventId: string): Promise<CurrentHoldResponseDto> {
    const startedAt = Date.now();
    const [ttl, ...seats] = await this.redisCall((redis) =>
      redis.readHold(1, this.holdKey(eventId, userId), `H:${userId}`),
    );
    return {
      expires_at: seats.length ? new Date(startedAt + ttl).toISOString() : null,
      seat_ids: seats.sort(),
    };
  }

  async release(userId: string, input: ReleaseHoldDto): Promise<void> {
    const ids = input.seat_ids ?? [];
    await this.redisCall((redis) =>
      redis.releaseSeats(
        ids.length + 1,
        this.holdKey(input.event_id, userId),
        ...ids.map((id) => this.seatKey(input.event_id, id)),
        `H:${userId}`,
        ...ids,
      ),
    );
  }
}
