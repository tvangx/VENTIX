const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

test("static server serves SPA refresh, assets and refuses API/dotfiles/methods", async () => {
  const dir = mkdtempSync(join(tmpdir(), "t208-web-"));
  mkdirSync(join(dir, "dist/assets"), { recursive: true });
  writeFileSync(join(dir, "dist/index.html"), "<html>real-built-spa-fixture</html>");
  writeFileSync(join(dir, "dist/assets/test.js"), "export const fixture = true;");
  const child = spawn(process.execPath, [resolve(__dirname, "../../apps/web/server.mjs")], {
    cwd: dir,
    stdio: "pipe",
  });
  let error = "";
  child.stderr.on("data", (data) => {
    error += data;
  });
  try {
    const deadline = Date.now() + 10000;
    while (true) {
      if (child.exitCode !== null) throw new Error(error);
      try {
        await fetch("http://127.0.0.1:8080/");
        break;
      } catch {
        if (Date.now() > deadline) throw new Error("Static server readiness timeout");
        await new Promise((done) => setTimeout(done, 50));
      }
    }
    for (const path of ["/", "/login", "/events/fixture/seats"]) {
      const res = await fetch(`http://127.0.0.1:8080${path}`);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /real-built-spa-fixture/);
      assert.equal(res.headers.get("cache-control"), "no-cache");
    }
    const asset = await fetch("http://127.0.0.1:8080/assets/test.js");
    assert.match(asset.headers.get("cache-control"), /immutable/);
    assert.match(asset.headers.get("content-type"), /javascript/);
    for (const path of [
      "/api",
      "/api/unknown",
      "/.env",
      "/%2eenv",
      "/missing.js",
      "/mockServiceWorker.js",
      "/bad%ZZ",
    ]) {
      assert.ok([400, 404].includes((await fetch(`http://127.0.0.1:8080${path}`)).status), path);
    }
    assert.equal((await fetch("http://127.0.0.1:8080/", { method: "POST" })).status, 405);
    assert.equal(await (await fetch("http://127.0.0.1:8080/login", { method: "HEAD" })).text(), "");
  } finally {
    child.kill();
    await new Promise((done) => child.once("exit", done));
  }
});
