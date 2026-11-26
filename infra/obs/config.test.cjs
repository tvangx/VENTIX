const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const root = resolve(__dirname, "../..");
const dir = mkdtempSync(join(tmpdir(), "ventix-t404-config-"));
const file = join(dir, "obs.env");
const example = readFileSync(join(__dirname, "obs.env.example"), "utf8");
const fixture = example.replace(
  "GRAFANA_ADMIN_PASSWORD=",
  "GRAFANA_ADMIN_PASSWORD=synthetic-t404-password-only",
);
const env = { ...process.env, CLOUDFLARED_TOKEN_FILE: join(dir, "token") };
for (const match of example.matchAll(/^([A-Z_]+)=/gm)) delete env[match[1]];
writeFileSync(file, fixture);
writeFileSync(env.CLOUDFLARED_TOKEN_FILE, "synthetic-no-connection-token");
const compose = join(root, "infra/compose/docker-compose.obs.yml");
const run = (args) => spawnSync("docker", args, { encoding: "utf8", env });
const args = ["compose", "-p", "ticketing-t404-config", "--env-file", file, "-f", compose];
let checks = 0;
const check = (ok, message) => {
  assert.ok(ok, message);
  checks++;
};
check(
  !readFileSync(join(__dirname, "obs.sh"), "utf8").includes("\r"),
  "EC2 shell script must use LF",
);
const dashboard = JSON.parse(readFileSync(join(root, "infra/grafana/dashboards/red.json"), "utf8"));
const ruleTests = readFileSync(join(root, "infra/prometheus/red-test-rules.yml"), "utf8");
for (const panel of dashboard.panels.slice(2)) {
  check(
    ruleTests.includes(
      panel.targets[0].expr.replaceAll("$service", ".*").replaceAll("$__rate_interval", "1m"),
    ),
    "Promtool tests must cover actual dashboard expression",
  );
}
const result = run([...args, "config", "--format", "json"]);
check(result.status === 0, result.stderr);
const config = JSON.parse(result.stdout);
check(Object.keys(config.services).sort().join(",") === "grafana,prometheus", "Only obs services");
check(config.networks["obs-backend"].external === true, "Existing external app network");
check(
  config.networks["obs-access"].driver === "bridge",
  "Separate obs access bridge for loopback ports",
);
check(
  !Object.hasOwn(config.services.grafana.networks, "obs-backend"),
  "Grafana cannot access the app backend directly",
);
for (const svc of Object.values(config.services)) {
  check(svc.ports.length === 1 && svc.ports[0].host_ip === "127.0.0.1", "Loopback only");
  check(!JSON.stringify(svc).includes("docker.sock"), "No docker socket");
  check(svc.image.includes("@sha256:"), "Pinned image");
  check(svc.mem_limit > 0 && Number(svc.cpus) <= 0.5, "Resource limits");
}
check(
  config.services.grafana.environment.GF_AUTH_ANONYMOUS_ENABLED === "false",
  "No anonymous access",
);
check(Object.keys(config.volumes).length === 2, "Two persistent volumes");
// Compare full resolved configs to prove the overlay does not mutate apps/trust/data.
const prodExample = readFileSync(join(root, ".env.prod.example"), "utf8").replace(
  /^([A-Z_]+)=$/gm,
  "$1=synthetic-t404-only",
);
const prodFile = join(dir, "infra.env");
const demoFile = join(dir, "demo.env");
writeFileSync(prodFile, prodExample);
writeFileSync(
  demoFile,
  [
    "DEMO_RELEASE=t404",
    "DEMO_ORIGIN=https://demo.invalid",
    "INTERNAL_API_KEY=synthetic-t404-only",
    "ADMISSION_TOKEN_SECRET=synthetic-t404-only-at-least-32-chars",
    "JWT_PRIVATE_KEY_PEM=synthetic-not-a-key",
    "TICKET_ACTIVE_KEY_ID=test",
    "TICKET_ENCRYPTION_KEYS={}",
    "VNPAY_TMN_CODE=TEST404X",
    "VNPAY_HASH_SECRET=synthetic-not-a-secret",
  ].join("\n"),
);
const baseArgs = [
  "compose",
  "-p",
  "ticketing-t404-config",
  "--env-file",
  prodFile,
  "--env-file",
  demoFile,
  "--env-file",
  file,
  "-f",
  join(root, "infra/compose/docker-compose.prod.yml"),
  "-f",
  join(root, "infra/compose/docker-compose.tunnel.yml"),
  "-f",
  join(root, "infra/compose/docker-compose.apps.yml"),
];
const base = run([...baseArgs, "config", "--format", "json"]);
const merged = run([...baseArgs, "-f", compose, "config", "--format", "json"]);
check(base.status === 0 && merged.status === 0, "prod+tunnel+apps+obs config valid");
const before = JSON.parse(base.stdout);
const after = JSON.parse(merged.stdout);
for (const [name, service] of Object.entries(before.services)) {
  assert.deepEqual(after.services[name], service, name);
  checks++;
}
for (const [name, network] of Object.entries(before.networks)) {
  assert.deepEqual(after.networks[name], network, name);
  checks++;
}
assert.deepEqual(
  Object.keys(after.volumes)
    .filter((name) => !name.startsWith("obs-"))
    .sort(),
  Object.keys(before.volumes).sort(),
);
checks++;
// Wrapper must reject missing/invalid fields before any runtime mutation, without leaking values.
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const shellPath = (path) =>
  process.platform === "win32"
    ? path.replace(/^([A-Z]):/i, (_, drive) => `/${drive.toLowerCase()}`).replaceAll("\\", "/")
    : path;
for (const [name, replacement] of [
  ["GRAFANA_ADMIN_PASSWORD", "short-sensitive"],
  ["GRAFANA_ADMIN_PASSWORD", ""],
  ["PROMETHEUS_IMAGE", "prom/prometheus:latest"],
  ["GRAFANA_IMAGE", "grafana/grafana:latest"],
  ["GRAFANA_PORT", "0"],
  ["GRAFANA_PORT", "9090"],
  ["OBS_NETWORK", "bad network"],
  ["GRAFANA_ADMIN_USER", ""],
]) {
  writeFileSync(file, fixture.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${replacement}`));
  const rejected = spawnSync(
    bash,
    [join(root, "infra/obs/obs.sh"), "check", shellPath(file), "ticketing-t404-config"],
    { encoding: "utf8", env },
  );
  check(rejected.status !== 0, `Reject ${name}`);
  check(!(rejected.stdout + rejected.stderr).includes("short-sensitive"), "No leaked secret");
}
writeFileSync(file, fixture);
for (const extra of ["GRAFANA_PORT=3030", "UNKNOWN_OBS_FIELD=synthetic-value"]) {
  writeFileSync(file, fixture + extra + "\n");
  const rejected = spawnSync(
    bash,
    [join(root, "infra/obs/obs.sh"), "check", shellPath(file), "ticketing-t404-config"],
    { encoding: "utf8", env },
  );
  check(rejected.status !== 0, "Reject duplicate or unknown env field");
}
writeFileSync(file, fixture);
console.log(`T-404 config: ${checks} checks passed (synthetic env only).`);
