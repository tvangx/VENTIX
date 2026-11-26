// Docker local tạm, không chạy connector ra Cloudflare hoặc đụng stack/volume đang có.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const root = resolve(__dirname, "../..");
const example = readFileSync(join(root, ".env.prod.example"), "utf8");
const image = (name) => example.match(new RegExp(`^${name}=(.+)$`, "m"))[1].trim();
const docker = (...args) => spawnSync("docker", args, { encoding: "utf8", timeout: 30000 });
const ok = (...args) => {
  const result = docker(...args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
};

test("Kong uses client IP only from connector; health/internal and spoof rejection over HTTP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "t207-http-"));
  const envFile = join(dir, ".env.prod");
  const id = `t207-http-${Date.now()}`;
  const network = `${id}-origin`;
  const containers = [];
  let networkCreated = false;
  try {
    writeFileSync(envFile, example.replace(/^([A-Z_]+)=$/gm, "$1=test-only"));
    const environment = { ...process.env, CLOUDFLARED_TOKEN_FILE: join(dir, "unused-token") };
    for (const match of example.matchAll(/^([A-Z_]+)=/gm)) delete environment[match[1]];
    const rendered = spawnSync(
      "docker",
      [
        "compose",
        "--env-file",
        envFile,
        "-f",
        join(root, "infra/compose/docker-compose.prod.yml"),
        "-f",
        join(root, "infra/compose/docker-compose.tunnel.yml"),
        "config",
        "--format",
        "json",
      ],
      { encoding: "utf8", env: environment },
    );
    assert.equal(rendered.status, 0, rendered.stderr);
    const config = JSON.parse(rendered.stdout);
    const gateway = config.services.kong;
    ok(
      "network",
      "create",
      "--internal",
      "--subnet",
      config.networks["tunnel-origin"].ipam.config[0].subnet,
      network,
    );
    networkCreated = true;
    const kong = `${id}-kong`;
    const envArgs = Object.entries(gateway.environment).flatMap(([key, value]) => [
      "-e",
      `${key}=${value}`,
    ]);
    ok(
      "run",
      "--rm",
      "-d",
      "--name",
      kong,
      "--network",
      network,
      "--network-alias",
      "kong",
      "--ip",
      gateway.networks["tunnel-origin"].ipv4_address,
      ...envArgs,
      "-e",
      "KONG_NGINX_WORKER_PROCESSES=1",
      "-e",
      "KONG_NGINX_HTTP_LOG_FORMAT=t207 '$http_x_request_id $remote_addr $realip_remote_addr'",
      "-e",
      "KONG_PROXY_ACCESS_LOG=/dev/stdout t207",
      "--mount",
      `type=bind,source=${join(root, "infra/kong/kong.prod.yml")},target=/kong/kong.prod.yml,readonly`,
      gateway.image,
    );
    containers.push(kong);
    for (const [suffix, address] of [
      ["connector", "172.30.207.2"],
      ["untrusted", "172.30.207.4"],
    ]) {
      const client = `${id}-${suffix}`;
      ok(
        "run",
        "--rm",
        "-d",
        "--name",
        client,
        "--network",
        network,
        "--ip",
        address,
        "--entrypoint",
        "/bin/sleep",
        image("REDIS_IMAGE"),
        "300",
      );
      containers.push(client);
    }
    const request = (client, path, headers = []) =>
      docker(
        "exec",
        client,
        "/bin/busybox",
        "wget",
        "-S",
        "-q",
        "-T",
        "2",
        "-O",
        "-",
        ...headers.flatMap((header) => ["--header", header]),
        `http://kong:8000${path}`,
      );
    const deadline = Date.now() + 45000;
    while (true) {
      if (request(`${id}-untrusted`, "/health/infra").status === 0) break;
      assert.ok(Date.now() < deadline, ok("logs", kong));
      await delay(200);
    }
    const cases = [
      ["connector", "198.51.100.20", "198.51.100.20", "172.30.207.2"],
      ["connector", "2001:db8::20", "2001:db8::20", "172.30.207.2"],
      ["untrusted", "198.51.100.21", "172.30.207.4", "172.30.207.4"],
      ["untrusted", "2001:db8::21", "172.30.207.4", "172.30.207.4"],
    ];
    for (let index = 0; index < cases.length; index++) {
      const [client, claimed, expected, peer] = cases[index];
      const requestId = `t207-ip-${index}`;
      const response = request(`${id}-${client}`, "/health/infra", [
        `CF-Connecting-IP: ${claimed}`,
        `X-Forwarded-For: 192.0.2.99`,
        `X-Real-IP: 192.0.2.98`,
        `X-Request-Id: ${requestId}`,
      ]);
      assert.equal(response.status, 0, response.stderr);
      assert.match(response.stdout, /infrastructure-only/);
      assert.match(response.stderr, new RegExp(`X-Request-Id: ${requestId}`, "i"));
      const logs = ok("logs", kong);
      assert.ok(logs.includes(`${requestId} ${expected} ${peer}`), logs);
    }
    for (const client of ["connector", "untrusted"]) {
      const response = request(`${id}-${client}`, "/api/event/v1/internal/events/x/seat-classes");
      assert.notEqual(response.status, 0);
      assert.match(response.stderr, /404/);
    }
    assert.deepEqual(JSON.parse(ok("inspect", kong))[0].HostConfig.PortBindings, {});
  } finally {
    for (const name of containers.reverse()) ok("stop", "--time", "1", name);
    if (networkCreated) ok("network", "rm", network);
    unlinkSync(envFile);
    rmdirSync(dir);
  }
});

test("Linux PTY: deploy detaches stdin and bounds TERM-ignoring Docker clients", () => {
  const dir = mkdtempSync(join(tmpdir(), "t207-pty-"));
  const files = ["docker", "env"];
  try {
    writeFileSync(join(dir, "env"), "# mock only\n");
    writeFileSync(
      join(dir, "docker"),
      `#!/bin/bash
set -eu
if [[ -t 0 ]] || IFS= read -r line; then echo inherited-stdin >&2; exit 20; fi
for arg in "$@"; do
  case "$arg" in
    config) if [[ " $* " == *" --images "* ]]; then echo image@sha256:${"0".repeat(64)}; fi; exit 0 ;;
    exec|run)
      [[ " $* " == *" -T "* && " $* " == *" --interactive=false "* ]] || exit 21
      if [[ "$TEST_HANG" == "$arg" ]]; then trap '' TERM; sleep 30; fi
      exit 0 ;;
    version|pull|up|ps) exit 0 ;;
  esac
done
exit 22
`,
      { mode: 0o755 },
    );
    for (const stage of ["", "exec", "run"]) {
      const name = `t207-pty-${Date.now()}`;
      const start = Date.now();
      try {
        const result = spawnSync(
          "docker",
          [
            "run",
            "--rm",
            "--name",
            name,
            "-i",
            "--network",
            "none",
            "-e",
            `TEST_HANG=${stage}`,
            "--mount",
            `type=bind,source=${dir},target=/fixture`,
            "--mount",
            `type=bind,source=${join(__dirname, "deploy.sh")},target=/repo/infra/deploy/deploy.sh,readonly`,
            "--entrypoint",
            "/bin/bash",
            "postgres:16",
            "-c",
            "script -q -e -c 'PATH=/fixture:/usr/bin:/bin bash /repo/infra/deploy/deploy.sh /fixture/env 1' /dev/null",
          ],
          { encoding: "utf8", input: "must-not-reach-docker\n", timeout: 12000 },
        );
        assert.ifError(result.error);
        if (stage) {
          assert.notEqual(result.status, 0);
          assert.doesNotMatch(result.stdout, /Infrastructure health checks passed/);
          assert.ok(Date.now() - start < 10000, `${stage} must escalate to KILL`);
        } else assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.doesNotMatch(result.stdout + result.stderr, /inherited-stdin/);
      } finally {
        if (docker("inspect", name).status === 0) ok("stop", "--time", "1", name);
      }
    }
  } finally {
    for (const file of files) unlinkSync(join(dir, file));
    rmdirSync(dir);
  }
});

test("pinned cloudflared reads a private token file as 65532, fails unreadable file without network", () => {
  const donor = `t207-token-${Date.now()}`;
  try {
    ok(
      "run",
      "--rm",
      "-d",
      "--name",
      donor,
      "--network",
      "none",
      "-v",
      "/tokens",
      "--entrypoint",
      "/bin/sh",
      image("REDIS_IMAGE"),
      "-c",
      "printf test-only-invalid-token > /tokens/readable; cp /tokens/readable /tokens/denied; cp /tokens/readable /tokens/group; chown 65532:65532 /tokens/readable; chown 0:65532 /tokens/group; chmod 0440 /tokens/group; chmod 0400 /tokens/readable /tokens/denied; exec sleep 300",
    );
    // exec kiểm tra fixture sẵn sàng thay vì sleep cố định.
    ok("exec", donor, "/bin/sh", "-c", "test -s /tokens/readable && test -s /tokens/denied");
    const inspect = JSON.parse(ok("image", "inspect", image("CLOUDFLARED_IMAGE")))[0];
    assert.equal(inspect.Config.User, "65532:65532");
    for (const [file, denied] of [
      ["readable", false],
      ["group", false],
      ["denied", true],
    ]) {
      const result = docker(
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--volumes-from",
        `${donor}:ro`,
        image("CLOUDFLARED_IMAGE"),
        "tunnel",
        "run",
        "--token-file",
        `/tokens/${file}`,
      );
      assert.notEqual(result.status, 0);
      const output = result.stdout + result.stderr;
      assert.doesNotMatch(output, /test-only-invalid-token/);
      if (denied) assert.match(output, /permission denied/);
      else {
        assert.doesNotMatch(output, /permission denied/);
        assert.match(output, /token.*(invalid|valid)|failed to parse/i);
      }
    }
    const notReady = docker(
      "run",
      "--rm",
      "--network",
      "none",
      image("CLOUDFLARED_IMAGE"),
      "tunnel",
      "--metrics",
      "127.0.0.1:2000",
      "ready",
    );
    assert.notEqual(notReady.status, 0, "Readiness must fail without a connection");
  } finally {
    ok("stop", "--time", "1", donor);
  }
});
