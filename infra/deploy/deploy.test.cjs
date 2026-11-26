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

function run(failure = "", timeout = "1", input, tunnel = "") {
  const dir = mkdtempSync(join(tmpdir(), "ticketing-t207-deploy-"));
  const mock = join(dir, "docker");
  const envFile = join(dir, ".env.prod");
  const logFile = join(dir, "calls");
  const tokenFile = join(dir, "token");
  try {
    writeFileSync(envFile, "# mock only, no secrets\n");
    writeFileSync(logFile, "");
    writeFileSync(tokenFile, tunnel === "empty" ? "" : "test-only-token-sentinel");
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
      if [[ "$arg" == exec || "$arg" == run ]]; then
        if [[ "$TEST_FAIL" == stdin ]]; then
          if IFS= read -r line; then echo 'unexpected inherited stdin' >&2; exit 20; fi
          [[ " $* " == *" -T "* && " $* " == *" --interactive=false "* ]] || exit 21
        fi
        if [[ "$TEST_FAIL" == "hang-$arg" ]]; then
          trap '' TERM
          sleep 30
        fi
      fi
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
        'export PATH="$1:/usr/bin:/bin"; shift; exec bash "$@"',
        "--",
        posix(dir),
        script,
        posix(envFile),
        timeout,
        ...(tunnel
          ? [
              "--tunnel",
              tunnel === "missing"
                ? `${posix(tokenFile)}-missing`
                : tunnel === "relative"
                  ? "relative-token"
                  : posix(tokenFile),
            ]
          : []),
      ],
      {
        encoding: "utf8",
        timeout: 15000,
        input,
        env: { ...process.env, TEST_FAIL: failure, TEST_CALLS: posix(logFile) },
      },
    );
    if (result.error) throw result.error;
    return { ...result, calls: readFileSync(logFile, "utf8") };
  } finally {
    for (const file of [mock, envFile, logFile, tokenFile]) unlinkSync(file);
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
    "exec -T --interactive=false redis",
    "http://kong:8000/health/infra",
    "run -T --interactive=false --rm --no-deps kafka-init",
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

test("piped input never reaches Docker exec/run and interactive mode is disabled", () => {
  const result = run("stdin", "1", "must-not-be-consumed\n");
  assert.equal(result.status, 0, result.stderr);
});

for (const stage of ["exec", "run"]) {
  test(`hung ${stage} ignoring TERM is killed within a bounded deadline`, () => {
    const start = Date.now();
    const result = run(`hang-${stage}`);
    assert.equal(result.status, stage === "exec" ? 1 : 137, result.stderr);
    assert.ok(Date.now() - start < 10000, "Timeout must escalate when TERM is ignored");
    assert.ok(!result.calls.includes(" ps "), result.calls);
    assert.doesNotMatch(result.stdout, /Infrastructure health checks passed/);
  });
}

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
    assert.equal(result.status, ["unpinned", "exec", "kong"].includes(failure) ? 1 : 13);
    assert.ok(!result.calls.includes(forbidden), result.calls);
    assert.doesNotMatch(result.stdout, /Infrastructure health checks passed/);
  });
}

test("invalid health timeout fails before any Docker command", () => {
  const result = run("", "0");
  assert.notEqual(result.status, 0);
  assert.equal(result.calls, "");
});

test("tunnel is explicit and its overlay applies to every compose stage", () => {
  const result = run("", "1", undefined, "valid");
  assert.equal(result.status, 0, result.stderr);
  for (const line of result.calls.trim().split("\n")) {
    if (!line.includes(" version ")) assert.match(line, /docker-compose\.tunnel\.yml/);
  }
  assert.doesNotMatch(result.calls + result.stdout + result.stderr, /test-only-token-sentinel/);
  assert.doesNotMatch(run().calls, /docker-compose\.tunnel\.yml/);
});

for (const invalid of ["missing", "empty", "relative"]) {
  test(`invalid tunnel token file (${invalid}) fails before Docker`, () => {
    const result = run("", "1", undefined, invalid);
    assert.notEqual(result.status, 0);
    assert.equal(result.calls, "");
  });
}
