/* global process */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createPublicKey, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";

test("mint dev JWTs: signatures, claims, unique subjects and private output", () => {
  const cli = resolve("dist/t205/mint-test-tokens.js");
  const directory = `secrets/t205-token-test-${randomUUID()}`;
  const run = (args) =>
    spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 15000 });
  const result = run(["--count", "3", "--out-dir", directory, "--ttl", "60"]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes("eyJ"));
  const rows = JSON.parse(readFileSync(`${directory}/tokens.json`, "utf8"));
  const key = createPublicKey(readFileSync(`${directory}/public.pem`));
  assert.equal(new Set(rows.map((row) => row.sub)).size, 3);
  for (const row of rows) {
    const [header, payload, signature] = row.token.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "RS256", typ: "JWT" });
    assert.ok(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        key,
        Buffer.from(signature, "base64url"),
      ),
    );
    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    assert.equal(claims.sub, row.sub);
    assert.equal(claims.iss, "https://identity.ticketing.local");
    assert.equal(claims.aud, "ticketing-api");
    assert.equal(claims.exp - claims.iat, 60);
  }
  assert.equal(run(["--out-dir", directory]).status, 1, "must not overwrite existing tokens");
  assert.equal(
    run(["--out-dir", "dist/unsafe-token-output"]).status,
    1,
    "output must be ignored secrets directory",
  );
  assert.equal(run(["--count", "0"]).status, 1);
  const reused = `${directory}-reused`;
  const reuse = run([
    "--count",
    "1",
    "--out-dir",
    reused,
    "--private-key",
    `${directory}/private.pem`,
  ]);
  assert.equal(reuse.status, 0, reuse.stderr);
  assert.equal(
    readFileSync(`${reused}/public.pem`, "utf8"),
    readFileSync(`${directory}/public.pem`, "utf8"),
  );
});
