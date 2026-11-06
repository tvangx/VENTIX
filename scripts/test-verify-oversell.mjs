/* global process */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";
const bookingRequire = createRequire(new URL("../services/booking/package.json", import.meta.url));
const Redis = bookingRequire("ioredis");
const url = process.env.REDIS_URL;
if (!url) throw new Error("Use REDIS_URL pointing to a disposable test Redis");
const cli = fileURLToPath(new URL("./verify-oversell.mjs", import.meta.url));

test("verifier CLI: Redis fixtures", async (t) => {
  const redis = new Redis(url, { retryStrategy: null });
  redis.on("error", () => undefined);
  try {
    for (const mode of [
      "valid",
      "duplicate",
      "missing",
      "extra",
      "wrong-owner",
      "no-ttl",
      "empty",
      "wrong-count",
      "expired",
    ]) {
      await t.test(mode, async () => {
        const event = randomUUID();
        const tag = `{evt:${event}}`;
        const stream = `holdlog:${tag}`;
        const seat = randomUUID();
        const holder = `H:${randomUUID()}`;
        const expiry = Date.now() + (mode === "expired" ? -1000 : 3600000);
        const log = () =>
          redis.xadd(
            stream,
            "*",
            "holder",
            holder,
            "seat_ids",
            JSON.stringify([seat]),
            "expires_at",
            expiry,
          );
        if (mode !== "empty") await log();
        if (mode === "duplicate") await log(); // đúng một ghế được ghi thành công hai lần
        if (mode !== "missing" && mode !== "empty") {
          const value = mode === "wrong-owner" ? `H:${randomUUID()}` : holder;
          if (mode === "no-ttl") await redis.set(`seat:${tag}:${seat}`, value);
          else await redis.set(`seat:${tag}:${seat}`, value, "EX", 3600);
        }
        if (mode === "extra") await redis.set(`seat:${tag}:${randomUUID()}`, holder, "EX", 3600);
        const result = spawnSync(
          process.execPath,
          [cli, event, "2", mode === "wrong-count" ? "2" : "1"],
          { env: { ...process.env, REDIS_URL: url }, encoding: "utf8", timeout: 15000 },
        );
        assert.equal(result.error, undefined);
        assert.equal(result.status, mode === "valid" ? 0 : 1, result.stderr);
        if (mode === "valid")
          assert.deepEqual(JSON.parse(result.stdout), {
            event_id: event,
            entries: 1,
            successes: 1,
            held: 1,
            oversell: 0,
          });
        if (mode === "duplicate") assert.match(result.stderr, /Duplicate successful hold/);
        // Fixture chỉ sống trong container riêng được dừng sau test.
      });
    }
    await t.test("pagination: 501 successful seats", async () => {
      const event = randomUUID();
      const tag = `{evt:${event}}`;
      const pipe = redis.pipeline();
      for (let i = 0; i < 501; i++) {
        const seat = randomUUID();
        const holder = `H:${randomUUID()}`;
        pipe.xadd(
          `holdlog:${tag}`,
          "*",
          "holder",
          holder,
          "seat_ids",
          JSON.stringify([seat]),
          "expires_at",
          Date.now() + 3600000,
        );
        pipe.set(`seat:${tag}:${seat}`, holder, "EX", 3600);
      }
      const replies = await pipe.exec();
      assert.ok(replies.every(([error]) => error === null));
      const result = spawnSync(process.execPath, [cli, event, "501", "501"], {
        env: process.env,
        encoding: "utf8",
        timeout: 15000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).held, 501);
    });
  } finally {
    redis.disconnect();
  }
});
