import { BeforeApplicationShutdown, Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { ENV } from "../app.tokens";
import { Env } from "../config/env.schema";
import { MetricsService } from "../metrics/metrics";
import { EventSnapshotRepository } from "../seat-hold/event-snapshot.repository";
import { SeatHoldRedisClient } from "../seat-hold/seat-hold-redis";
import { AdmissionTokens, grantSchema } from "./admission-token";
import { QueueStatusDto } from "./queue.dto";
import { queueKeys, QueueResult, registerQueueCommands } from "./queue-redis";
import { activeQueuePhase, QueuePhase } from "./sale-phase";

@Injectable()
export class QueueService implements BeforeApplicationShutdown {
  private readonly tokens: AdmissionTokens;
  private readonly streams = new Set<() => void>();
  private stopping = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly snapshots: EventSnapshotRepository,
    private readonly cache: SeatHoldRedisClient,
    private readonly metrics: MetricsService,
  ) {
    this.tokens = new AdmissionTokens(env.ADMISSION_TOKEN_SECRET ?? "");
  }

  private required(): ProblemException {
    return new ProblemException(
      "ADMISSION_REQUIRED",
      403,
      "A valid admission token for this user and event is required",
    );
  }

  async phase(event: string): Promise<QueuePhase> {
    const snapshot = await this.snapshots.find(event);
    const phase = activeQueuePhase(snapshot?.sale_window);
    if (!snapshot || !["APPROVED", "PUBLISHED"].includes(snapshot.status) || !phase)
      throw new ProblemException("EVENT_NOT_ON_SALE", 404, "Event is not currently on sale");
    return phase;
  }

  async operation(
    event: string,
    user: string,
    op: "join" | "status" | "admit",
    phase: QueuePhase,
  ): Promise<QueueResult> {
    try {
      const redis = registerQueueCommands(await this.cache.connected());
      const result = await redis.queueOperation(
        5,
        ...queueKeys(event),
        op,
        user,
        phase.admit_rate,
        this.env.ADMISSION_MAX_ACTIVE,
        this.env.ADMISSION_TOKEN_TTL_SECONDS,
        this.env.QUEUE_TTL_SECONDS,
        randomUUID(),
        Date.parse(phase.starts_at),
        Date.parse(phase.ends_at),
      );
      if (result[0] === -2)
        throw new ProblemException("EVENT_NOT_ON_SALE", 404, "Sale phase has ended");
      return result;
    } catch (error) {
      if (error instanceof ProblemException) throw error;
      this.metrics.queueOutcomes.inc({ outcome: "unavailable" });
      throw new ProblemException(
        "QUEUE_UNAVAILABLE",
        503,
        "Waiting Room is temporarily unavailable; retry the request",
      );
    }
  }

  async status(event: string, user: string, join = false): Promise<QueueStatusDto> {
    if (!this.env.ADMISSION_REQUIRED)
      return { status: "disabled", position: null, estimated_wait_sec: 0 };
    const phase = await this.phase(event);
    if (!phase.queue_enabled) return { status: "disabled", position: null, estimated_wait_sec: 0 };
    const [rank, raw] = await this.operation(event, user, join ? "join" : "status", phase);
    if (raw) {
      const grant = grantSchema.parse(JSON.parse(raw) as unknown);
      return {
        status: "admitted",
        position: null,
        estimated_wait_sec: 0,
        admission_token: await this.tokens.sign(user, event, grant),
        expires_at: new Date(grant.exp * 1000).toISOString(),
      };
    }
    if (join) this.metrics.queueOutcomes.inc({ outcome: "join" });
    return rank < 0
      ? { status: "not_joined", position: null, estimated_wait_sec: null }
      : {
          status: "waiting",
          position: rank,
          estimated_wait_sec: Math.floor(rank / phase.admit_rate) + 1,
        };
  }

  async authorize(event: string, user: string, token: string | undefined): Promise<void> {
    if (!this.env.ADMISSION_REQUIRED) return;
    const snapshot = await this.snapshots.find(event);
    const phase = activeQueuePhase(snapshot?.sale_window);
    if (phase?.queue_enabled === false) return;
    if (!phase || !token || token.length > 4096) throw this.required();
    let grant;
    try {
      grant = await this.tokens.verify(token, user, event);
    } catch {
      throw this.required();
    }
    const [, raw] = await this.operation(event, user, "status", phase);
    if (!raw) throw this.required();
    try {
      const active = grantSchema.parse(JSON.parse(raw) as unknown);
      if (active.jti !== grant.jti || active.exp !== grant.exp || active.iat !== grant.iat)
        throw this.required();
    } catch {
      throw this.required();
    }
  }

  async stream(event: string, user: string, res: Response): Promise<void> {
    if (this.stopping || this.streams.size >= this.env.QUEUE_MAX_STREAMS)
      throw new ProblemException(
        "QUEUE_UNAVAILABLE",
        503,
        "Waiting Room stream limit reached; retry",
      );
    let closed = false;
    let timer: NodeJS.Timeout | undefined;
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      this.streams.delete(close);
      this.metrics.queueStreams.dec();
      res.off("close", close);
      res.end();
      resolveDone();
    };
    this.streams.add(close);
    this.metrics.queueStreams.inc();
    res.once("close", close);
    try {
      const initial = await this.status(event, user);
      if (closed || res.destroyed) {
        close();
        return;
      }
      res.status(200).set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      const send = (status: QueueStatusDto) => {
        if (closed) return;
        if (
          !res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`) ||
          status.status !== "waiting"
        )
          close();
      };
      const tick = async () => {
        try {
          send(await this.status(event, user));
        } catch (error) {
          if (!closed)
            res.write(
              `event: error\ndata: ${JSON.stringify({ code: error instanceof ProblemException ? error.code : "QUEUE_UNAVAILABLE" })}\n\n`,
            );
          close();
        }
        if (!closed)
          timer = setTimeout(() => {
            void tick();
          }, 1000);
      };
      send(initial);
      if (!closed)
        timer = setTimeout(() => {
          void tick();
        }, 1000);
      await done;
    } catch (error) {
      // Before headers are sent, let Nest return a normal problem+json response.
      if (!closed) {
        closed = true;
        this.streams.delete(close);
        this.metrics.queueStreams.dec();
        res.off("close", close);
      }
      if (res.destroyed) return;
      throw error;
    }
  }

  beforeApplicationShutdown(): void {
    this.stopping = true;
    for (const close of this.streams) close();
  }
}
