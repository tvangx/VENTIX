import Redis from "ioredis";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type QueueResult = [number, string, number, number, number];
export type QueueRedis = Redis & {
  queueOperation(keyCount: number, ...args: (string | number)[]): Promise<QueueResult>;
};
const registered = new WeakSet<Redis>();
export function registerQueueCommands(redis: Redis): QueueRedis {
  if (!registered.has(redis)) {
    redis.defineCommand("queueOperation", {
      lua: readFileSync(join(__dirname, "lua/queue.lua"), "utf8"),
    });
    registered.add(redis);
  }
  return redis as QueueRedis;
}
export function queueKeys(event: string): string[] {
  const slot = `{evt:${event}}`;
  return [
    `queue:${slot}`,
    `admitted:${slot}`,
    `admission-data:${slot}`,
    `admission-tick:${slot}`,
    `queue-sequence:${slot}`,
  ];
}
