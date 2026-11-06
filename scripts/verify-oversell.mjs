/* global process */
import { createRequire } from "node:module";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);
const bookingRequire = createRequire(join(scriptDir, "../services/booking/package.json"));
const Redis = bookingRequire("ioredis");

async function verify(redis, event, capacity, expected) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(event))
    throw new Error("EVENT_ID must be a lowercase UUID");
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new Error("SEATS must be a positive integer");
  if (expected !== undefined && (!Number.isInteger(expected) || expected < 1))
    throw new Error("Expected successes must be a positive integer");
  const tag = `{evt:${event}}`;
  const stream = `holdlog:${tag}`;
  const length = await redis.xlen(stream);
  if (length === 0) throw new Error("Empty holdlog: no evidence (check HOLDLOG_ENABLED)");
  const logged = new Map();
  let cursor = "-";
  let entries = 0;
  for (;;) {
    const rows = await redis.xrange(stream, cursor, "+", "COUNT", 500);
    if (rows.length === 0) break;
    for (const [id, fields] of rows) {
      entries++;
      const data = {};
      for (let i = 0; i < fields.length; i += 2) data[fields[i]] = fields[i + 1];
      const ids = JSON.parse(data.seat_ids);
      if (!Array.isArray(ids) || ids.length === 0 || !/^H:[0-9a-f-]{36}$/.test(data.holder))
        throw new Error("Malformed holdlog entry");
      if (!Number.isSafeInteger(Number(data.expires_at)) || Number(data.expires_at) <= Date.now())
        throw new Error("Expired or invalid holdlog; rerun with a fresh event and TTL=3600");
      for (const seat of ids) {
        if (
          typeof seat !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(seat)
        )
          throw new Error("Malformed seat UUID");
        if (logged.has(seat)) throw new Error(`Duplicate successful hold for seat ${seat}`);
        logged.set(seat, data.holder);
      }
      cursor = `(${id}`;
    }
  }
  if (entries !== length || logged.size > capacity)
    throw new Error("Stream changed or successes exceed SEATS");
  if (expected !== undefined && logged.size !== expected)
    throw new Error("Success count differs from k6 s1_success");
  // SCAN chỉ dùng offline, kiểm tra cả ghế không xuất hiện trong stream.
  const keys = new Set();
  let scan = "0";
  do {
    const page = await redis.scan(scan, "MATCH", `seat:${tag}:*`, "COUNT", 500);
    scan = page[0];
    for (const key of page[1]) keys.add(key);
  } while (scan !== "0");
  const held = new Set();
  const all = [...keys];
  for (let start = 0; start < all.length; start += 500) {
    const batch = all.slice(start, start + 500);
    const pipe = redis.pipeline();
    for (const key of batch) {
      pipe.get(key);
      pipe.pttl(key);
    }
    const replies = await pipe.exec();
    for (let i = 0; i < batch.length; i++) {
      const [getError, value] = replies[i * 2];
      const [ttlError, ttl] = replies[i * 2 + 1];
      if (getError || ttlError) throw new Error("Cannot read seat key/TTL");
      if (value === null) continue;
      if (typeof value !== "string" || !value.startsWith("H:"))
        throw new Error("S1 event must contain only fresh held seats");
      const seat = batch[i].slice(`seat:${tag}:`.length);
      if (ttl <= 0 || logged.get(seat) !== value)
        throw new Error("Seat ownership/TTL differs from holdlog");
      held.add(seat);
    }
  }
  if (held.size !== logged.size || [...logged.keys()].some((seat) => !held.has(seat)))
    throw new Error("Successful seat count/set differs from held Redis keys");
  if ((await redis.xlen(stream)) !== length)
    throw new Error("Traffic still active: stream changed during verification");
  return { event_id: event, entries, successes: logged.size, held: held.size, oversell: 0 };
}

async function main() {
  const [event, seats, expected] = process.argv.slice(2);
  const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    lazyConnect: true,
    retryStrategy: null,
    connectTimeout: 3000,
    commandTimeout: 10000,
  });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    const result = await verify(
      redis,
      event || "",
      Number(seats),
      expected === undefined ? undefined : Number(expected),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    redis.disconnect();
  }
}
export { verify };
if (process.argv[1] && resolve(process.argv[1]) === scriptPath)
  main().catch((error) => {
    // Không in lỗi kết nối có thể chứa credential Redis.
    const safe =
      /^(Empty|Expired|Malformed|Duplicate|Stream|Success|Seat |Successful|Traffic|S1 |EVENT_ID|SEATS|Expected|Cannot)/.test(
        error.message,
      );
    process.stderr.write(
      `Oversell verification FAILED: ${safe ? error.message : "check Redis availability and stream format"}\n`,
    );
    process.exitCode = 1;
  });
