import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import Redis from "ioredis";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";

export type CacheResult<T> = { value: T; hit: boolean };

export function catalogListKey(query: { q?: string; cursor?: string; limit: number }): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([query.q?.toLocaleLowerCase() ?? "", query.cursor ?? "", query.limit]))
    .digest("hex");
  return `catalog:{evt:catalog}:list:${digest}`;
}

export function catalogDetailKey(id: string): string {
  return `catalog:{evt:${id}}:detail`;
}

@Injectable()
export class CatalogCache implements OnApplicationShutdown {
  private readonly redis: Redis;
  private connection?: Promise<boolean>;
  private readonly flights = new Map<string, Promise<CacheResult<unknown>>>();

  constructor(@Inject(ENV) env: Env) {
    this.redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      connectTimeout: 300,
      commandTimeout: 300,
    });
    this.redis.on("error", () => undefined);
  }

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
  }

  private async ready(): Promise<boolean> {
    if (this.redis.status === "ready") return true;
    if (this.connection) return this.connection;
    this.connection = this.connect();
    const ready = await this.connection;
    this.connection = undefined;
    return ready;
  }

  private async connect(): Promise<boolean> {
    try {
      await this.redis.connect();
      return true;
    } catch {
      return false;
    }
  }

  private async read<T>(key: string): Promise<T | null | undefined> {
    try {
      const value = await this.redis.get(key);
      return value === null ? undefined : (JSON.parse(value) as T);
    } catch {
      return null;
    }
  }

  async getOrLoad<T>(key: string, load: () => Promise<T>): Promise<CacheResult<T>> {
    const flight = this.flights.get(key);
    if (flight) {
      const shared = await flight;
      return { value: shared.value as T, hit: shared.hit };
    }
    const running = this.loadWithRedis(key, load);
    this.flights.set(key, running);
    try {
      return await running;
    } finally {
      this.flights.delete(key);
    }
  }

  private async loadWithRedis<T>(key: string, load: () => Promise<T>): Promise<CacheResult<T>> {
    if (!(await this.ready())) return { value: await load(), hit: false };
    const cached = await this.read<T>(key);
    if (cached === null) return { value: await load(), hit: false };
    if (cached !== undefined) return { value: cached, hit: true };

    // NX/PX là một lệnh atomic. Key có TTL nên worker chết không giữ khóa vô hạn.
    let owner = false;
    for (let round = 0; round < 2; round++) {
      try {
        owner = (await this.redis.set(`${key}:fill`, "1", "PX", 2000, "NX")) === "OK";
      } catch {
        return { value: await load(), hit: false };
      }
      if (owner) break;
      for (let attempt = 0; attempt < 40; attempt++) {
        await setTimeout(50);
        const shared = await this.read<T>(key);
        if (shared === null) return { value: await load(), hit: false };
        if (shared !== undefined) return { value: shared, hit: true };
      }
    }
    if (!owner) {
      // Chờ có giới hạn để Redis/worker lỗi không làm treo đường đọc công khai.
      return { value: await load(), hit: false };
    }
    const filled = await this.read<T>(key);
    if (filled === null) return { value: await load(), hit: false };
    if (filled !== undefined) return { value: filled, hit: true };
    const value = await load();
    try {
      if (value !== null) {
        await this.redis.set(key, JSON.stringify(value), "EX", 30 + Math.floor(Math.random() * 16));
      }
    } catch {
      // Redis là cache tùy chọn; PostgreSQL vẫn là nguồn dữ liệu.
    }
    return { value, hit: false };
  }
}
