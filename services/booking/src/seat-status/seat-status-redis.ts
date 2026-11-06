import Redis from "ioredis";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const registered = new WeakSet<Redis>();

export type SeatStatusRedis = Redis & {
  seatSnapshot(keys: number, ...args: string[]): Promise<[string[], string[], string]>;
  sweepSeats(keys: number, ...args: string[]): Promise<[number, number]>;
};

export function registerSeatStatusCommands(redis: Redis): SeatStatusRedis {
  if (registered.has(redis)) return redis as SeatStatusRedis;
  for (const [command, file] of [
    ["seatSnapshot", "seat_snapshot"],
    ["sweepSeats", "sweep_seats"],
  ]) {
    redis.defineCommand(command, {
      lua: readFileSync(join(__dirname, "lua", `${file}.lua`), "utf8"),
    });
  }
  registered.add(redis);
  return redis as SeatStatusRedis;
}
