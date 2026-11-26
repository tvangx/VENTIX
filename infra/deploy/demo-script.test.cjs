const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const posix = (value) =>
  value.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);

function run(action, failure = "") {
  const dir = mkdtempSync(join(tmpdir(), "t208-script-"));
  mkdirSync(join(dir, "infra/deploy"), { recursive: true });
  mkdirSync(join(dir, "bin"));
  copyFileSync(resolve(__dirname, "demo.sh"), join(dir, "infra/deploy/demo.sh"));
  for (const file of ["infra.env", "app.env", "token", "images.tar", "calls"])
    writeFileSync(join(dir, file), "");
  writeFileSync(join(dir, "release.env"), "DEMO_RELEASE=test\n");
  writeFileSync(join(dir, "IMAGES"), "ticketing-demo/identity:test sha256:test linux/amd64\n");
  writeFileSync(
    join(dir, "SHA256SUMS"),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  images.tar\n",
  );
  writeFileSync(
    join(dir, "bin/docker"),
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$TEST_CALLS"
case " $* " in
  *" config "*) exit 0 ;;
  *" load "*) exit 0 ;;
  *" image inspect "*) echo 'sha256:test linux/amd64'; exit 0 ;;
  *" inspect "*) echo running; exit 0 ;;
  *" ps "*) echo fixture-container; exit 0 ;;
  *" run "*)
    [[ "$*" == *'--interactive=false'* ]] || exit 21
    if IFS= read -r line; then exit 22; fi
    [[ "$TEST_FAIL" != migration || "$*" != *payment-migrate* ]] || exit 13
    [[ "$TEST_FAIL" != topics || "$*" != *kafka-init* ]] || exit 16
    [[ "$TEST_FAIL" != env || "$*" != *'identity validate'* ]] || exit 14
    exit 0 ;;
  *" up "*|*" stop "*) exit 0 ;;
esac
exit 15
`,
    { mode: 0o755 },
  );
  writeFileSync(join(dir, "bin/curl"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  const result = spawnSync(
    bash,
    [
      "-c",
      'export PATH="$1/bin:/usr/bin:/bin"; exec bash "$1/infra/deploy/demo.sh" "$2" "$1/infra.env" "$1/app.env" "$1/token"',
      "--",
      posix(dir),
      action,
    ],
    {
      encoding: "utf8",
      timeout: 15000,
      input: "never-consume-piped-input\n",
      env: { ...process.env, TEST_FAIL: failure, TEST_CALLS: posix(join(dir, "calls")) },
    },
  );
  return { ...result, calls: readFileSync(join(dir, "calls"), "utf8") };
}
test("upgrade validates then migrates before app/gateway; preserves infra", () => {
  const result = run("upgrade");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.calls.indexOf("payment-migrate") < result.calls.indexOf("up -d"));
  assert.ok(result.calls.indexOf("ticket-migrate") < result.calls.indexOf("--force-recreate"));
  assert.doesNotMatch(result.calls, /reset|down|remove-orphans|volume rm|(?:^|\s)pull(?:\s|$)/);
  assert.match(result.calls, /--no-deps --pull never/);
});
test("migration failure stops before daemon mutation", () => {
  const result = run("upgrade", "migration");
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.calls, /up -d|ticket-migrate/);
  assert.match(result.stderr, /Migration failed: payment-migrate/);
});
test("topic bootstrap failure stops before migrations or daemon mutation", () => {
  const result = run("upgrade", "topics");
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.calls, /-migrate|up -d/);
});
test("env failure stops before migration", () => {
  const result = run("upgrade", "env");
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.calls, /identity-migrate|up -d/);
});
test("check never migrates or changes daemons", () => {
  const result = run("check");
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.calls, /-migrate|up -d| stop /);
});
test("rollback skips migrations; infra-only stops apps and recreates only Kong", () => {
  const rollback = run("rollback");
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.doesNotMatch(rollback.calls, /-migrate/);
  const infra = run("infra-only");
  assert.equal(infra.status, 0, infra.stderr);
  assert.match(infra.calls, /stop identity event booking payment ticket web/);
  assert.doesNotMatch(infra.calls, / load |run |up .*postgres|up .*cloudflared/);
});
