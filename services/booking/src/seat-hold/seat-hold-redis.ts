import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Redis from "ioredis";
import { ENV } from "../app.tokens";
import type { Env } from "../config/env.schema";

type RedisArg = string | number;
export type HoldResult = [1] | [2] | [0, string];
export type SeatHoldRedis = Redis & {
  holdSeats(keyCount: number, ...args: RedisArg[]): Promise<HoldResult>;
  releaseSeats(keyCount: number, ...args: RedisArg[]): Promise<number>;
  readHold(keyCount: number, ...args: RedisArg[]): Promise<[number, ...string[]]>;
};

export function registerSeatHoldCommands(redis: Redis, holdlogEnabled: boolean): SeatHoldRedis {
  const script = (name: string) => readFileSync(join(__dirname, "lua", `${name}.lua`), "utf8");
  redis.defineCommand("holdSeats", {
    lua: `local holdlogEnabled = ${holdlogEnabled ? "true" : "false"}\n${script("hold_seats")}`,
  });
  redis.defineCommand("releaseSeats", { lua: script("release_seats") });
  redis.defineCommand("readHold", { lua: script("read_hold") });
  return redis as SeatHoldRedis;
}

@Injectable()
export class SeatHoldRedisClient implements OnModuleDestroy {
  readonly redis: SeatHoldRedis;
  private connecting?: Promise<void>;

  constructor(@Inject(ENV) env: Env) {
    const redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 3000,
      retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
    });
    // Lỗi mạng được chuyển thành problem+json ở service; không log URL có thể chứa password.
    redis.on("error", () => undefined);
    this.redis = registerSeatHoldCommands(redis, env.HOLDLOG_ENABLED);
  }

  async connected(): Promise<SeatHoldRedis> {
    // connect() đồng thời chỉ được gọi một lần; các request sau chờ ready event.
    if (this.redis.status === "wait") {
      this.connecting = this.redis.connect().finally(() => {
        this.connecting = undefined;
      });
    }
    if (this.connecting) await this.connecting;
    if (this.redis.status !== "ready") throw new Error("Redis is not ready");
    return this.redis;
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
