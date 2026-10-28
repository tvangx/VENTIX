// node --test infra/deploy/deploy.test.cjs; chỉ mock Docker, không chạy stack prod.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const posix = (value) =>
  value.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
const script = posix(resolve(__dirname, "deploy.sh"));

function run(failure = "", timeout = "1") {
  const dir = mkdtempSync(join(tmpdir(), "ticketing-t207-deploy-"));
  const mock = join(dir, "docker");
  const envFile = join(dir, ".env.prod");
  const logFile = join(dir, "calls");
  try {
    writeFileSync(envFile, "# mock only, no secrets\n");
    writeFileSync(logFile, "");
    writeFileSync(
      mock,
      `#!/usr/bin/env bash
set -eu
printf '%s ' "$@" >> "$TEST_CALLS"
printf '\\n' >> "$TEST_CALLS"
for arg in "$@"; do
  case "$arg" in
    version) exit 0 ;;
    config)
      [[ "$TEST_FAIL" != config ]] || exit 13
      if [[ " $* " == *" --images "* ]]; then
        if [[ "$TEST_FAIL" == unpinned ]]; then
          echo registry.test/image:latest
        else
          echo registry.test/image@sha256:${"0".repeat(64)}
        fi
      fi
      exit 0 ;;
    pull|up|exec|run|ps)
      if [[ "$arg" == exec && "$TEST_FAIL" == kong && " $* " == *" http://kong:8000/health/infra "* ]]; then exit 13; fi
      [[ "$TEST_FAIL" != "$arg" ]] || exit 13
      exit 0 ;;
  esac
done
exit 14
`,
      { mode: 0o755 },
    );
    // PATH giới hạn: Docker thật không thể được gọi nếu mock có lỗi.
    const result = spawnSync(
      bash,
      [
        "-c",
        'export PATH="$1:/usr/bin:/bin"; exec bash "$2" "$3" "$4"',
        "--",
        posix(dir),
        script,
        posix(envFile),
        timeout,
      ],
      {
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, TEST_FAIL: failure, TEST_CALLS: posix(logFile) },
      },
    );
    if (result.error) throw result.error;
    return { ...result, calls: readFileSync(logFile, "utf8") };
  } finally {
    for (const file of [mock, envFile, logFile]) unlinkSync(file);
    rmdirSync(dir);
  }
}

test("success: validates, pulls, waits, probes MinIO, initializes topics, reports status", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const commands = result.calls.split("\n");
  const stages = [
    "config --quiet",
    "config --images",
    "pull",
    "up -d --no-build --wait --wait-timeout 1",
    "exec -T redis",
    "http://kong:8000/health/infra",
    "run --rm --no-deps kafka-init",
    "ps",
  ];
  let previous = -1;
  for (const stage of stages) {
    const index = commands.findIndex((line) => line.includes(` ${stage} `));
    assert.ok(index > previous, `Missing/out-of-order stage: ${stage}`);
    previous = index;
  }
  assert.match(result.stdout, /Infrastructure health checks passed/);
});

for (const [failure, forbidden] of [
  ["config", " pull "],
  ["unpinned", " pull "],
  ["pull", " up "],
  ["up", " exec "],
  ["exec", " run "],
  ["kong", " run "],
  ["run", " ps "],
]) {
  test(`failure at ${failure}: nonzero exit, no later stage or success message`, () => {
    const result = run(failure);
    assert.notEqual(result.status, 0);
    assert.ok(!result.calls.includes(forbidden), result.calls);
    assert.doesNotMatch(result.stdout, /Infrastructure health checks passed/);
  });
}

test("invalid health timeout fails before any Docker command", () => {
  const result = run("", "0");
  assert.notEqual(result.status, 0);
  assert.equal(result.calls, "");
});
