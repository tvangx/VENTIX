const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const root = resolve(__dirname, "../..");
const dir = mkdtempSync(join(tmpdir(), "ventix-t404-config-"));
const file = join(dir, "obs.env");
const example = readFileSync(join(__dirname, "obs.env.example"), "utf8");
const clusters = {
  shared: "postgres",
  booking: "postgres-booking",
  payment: "postgres-payment",
  ticket: "postgres-ticket",
};
const fixture = Object.keys(clusters).reduce(
  (text, cluster) =>
    text.replace(
      `POSTGRES_MONITOR_PASSWORD_${cluster.toUpperCase()}=`,
      `POSTGRES_MONITOR_PASSWORD_${cluster.toUpperCase()}=synthetic-${cluster}-monitor-only-t501`,
    ),
  example.replace("GRAFANA_ADMIN_PASSWORD=", "GRAFANA_ADMIN_PASSWORD=synthetic-t404-password-only"),
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
check(
  Object.keys(config.services).sort().join(",") ===
    "alloy,alloy-init,grafana,jaeger,jaeger-init,kafka-exporter,loki,postgres-exporter-booking,postgres-exporter-payment,postgres-exporter-shared,postgres-exporter-ticket,prometheus,redis-exporter",
  "Only observability services, one PostgreSQL exporter per cluster",
);
// T-501 multi-cluster PostgreSQL: one exporter per independent cluster, least privilege.
for (const [cluster, host] of Object.entries(clusters)) {
  const svc = config.services[`postgres-exporter-${cluster}`];
  const environment = svc.environment;
  check(
    environment.DATA_SOURCE_URI === `${host}:5432/postgres?sslmode=disable`,
    `${cluster} exporter targets its own cluster host and the postgres database`,
  );
  check(environment.DATA_SOURCE_USER === "ticketing_monitor", `${cluster} uses monitoring role`);
  check(
    environment.DATA_SOURCE_PASS === `synthetic-${cluster}-monitor-only-t501`,
    `${cluster} uses its own password field`,
  );
  check(!Object.hasOwn(environment, "DATA_SOURCE_NAME"), `${cluster} has no legacy DSN`);
  check(
    Object.keys(svc.networks).join(",") === "obs-backend",
    `${cluster} exporter only joins the existing backend network`,
  );
  check((svc.ports ?? []).length === 0, `${cluster} exporter publishes no port`);
  check(svc.read_only === true, `${cluster} exporter has read-only root filesystem`);
  check(svc.cap_drop.join(",") === "ALL" && !svc.cap_add, `${cluster} exporter drops capabilities`);
  check(
    svc.security_opt.includes("no-new-privileges:true"),
    `${cluster} exporter has no-new-privileges`,
  );
  check(!svc.user && !svc.privileged, `${cluster} exporter keeps image non-root user`);
  check(
    Number(svc.mem_limit) === 64 * 1024 * 1024 && Number(svc.cpus) === 0.1,
    `${cluster} exporter has bounded resources`,
  );
}
check(!example.includes("POSTGRES_EXPORTER_DSN="), "Legacy single DSN removed from env schema");
const memoryBudget = Object.entries(config.services)
  .filter(([name]) => !name.endsWith("-init"))
  .reduce((total, [, svc]) => total + Number(svc.mem_limit), 0);
check(memoryBudget <= 2656 * 1024 * 1024, "Obs memory caps stay within 2656 MiB on 8 GiB EC2");
const prometheusConfig = readFileSync(join(root, "infra/prometheus/prometheus.yml"), "utf8");
check(
  !prometheusConfig.includes("postgres-exporter:9187"),
  "No legacy single PostgreSQL scrape target",
);
check(
  [...prometheusConfig.matchAll(/cluster: ([a-z]+)/g)].map((match) => match[1]).join(",") ===
    Object.keys(clusters).join(","),
  "Prometheus cluster label values are exactly the four known clusters",
);
for (const cluster of Object.keys(clusters)) {
  check(
    new RegExp(
      `- targets: \\["postgres-exporter-${cluster}:9187"\\]\\s*\\n\\s*labels: \\{ exporter: postgres, cluster: ${cluster} \\}`,
    ).test(prometheusConfig),
    `${cluster} scrape target is labelled`,
  );
}
check(
  /job_name: postgres\n\s+sample_limit: \d+\n\s+label_limit: \d+\n\s+label_value_length_limit: \d+/.test(
    prometheusConfig,
  ),
  "PostgreSQL scrape job has sample/label limits",
);
const systemDashboard = JSON.parse(
  readFileSync(join(root, "infra/grafana/dashboards/system.json"), "utf8"),
);
const systemExprs = systemDashboard.panels.flatMap((panel) => panel.targets.map((t) => t.expr));
check(
  systemExprs.includes('up{job=~"exporters|postgres"}'),
  "System dashboard shows every exporter target, including PostgreSQL clusters",
);
for (const metric of [
  "pg_up",
  "pg_stat_database_numbackends",
  "pg_settings_max_connections",
  "pg_database_size_bytes",
]) {
  check(
    systemExprs.some((expr) => expr.includes(`${metric}{job="postgres"}`)),
    `System dashboard reads ${metric} per cluster`,
  );
}
check(
  systemDashboard.panels.some((panel) =>
    panel.targets.some((t) => (t.legendFormat ?? "").includes("{{cluster}}")),
  ),
  "Dashboard legends identify the cluster",
);
check(config.networks["obs-backend"].external === true, "Existing external app network");
check(
  config.networks["obs-access"].driver === "bridge",
  "Separate obs access bridge for loopback ports",
);
check(
  !Object.hasOwn(config.services.grafana.networks, "obs-backend"),
  "Grafana cannot access the app backend directly",
);
for (const [name, svc] of Object.entries(config.services)) {
  for (const port of svc.ports ?? []) {
    check(port.host_ip === "127.0.0.1", `${name} is loopback only`);
  }
  check(!JSON.stringify(svc).includes("docker.sock"), "No docker socket");
  check(svc.image.includes("@sha256:"), "Pinned image");
  if (!name.endsWith("-init")) {
    check(svc.mem_limit > 0 && Number(svc.cpus) <= 0.5, "Resource limits");
  }
}
check(
  config.services.grafana.environment.GF_AUTH_ANONYMOUS_ENABLED === "false",
  "No anonymous access",
);
check(Object.keys(config.volumes).length === 5, "Five persistent observability volumes");
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
const appOverlay = join(root, "infra/compose/docker-compose.apps-observability.yml");
const baseWithAppOverlay = run([...baseArgs, "-f", appOverlay, "config", "--format", "json"]);
const merged = run([...baseArgs, "-f", appOverlay, "-f", compose, "config", "--format", "json"]);
check(base.status === 0, "prod+tunnel+apps base config valid without observability");
check(
  baseWithAppOverlay.status === 0,
  "app observability overlay config valid before Alloy starts",
);
check(merged.status === 0, "prod+tunnel+apps+observability config valid");
const before = JSON.parse(base.stdout);
const appOnly = JSON.parse(baseWithAppOverlay.stdout);
const after = JSON.parse(merged.stdout);
for (const name of Object.keys(before.services)) {
  if (!["identity", "event", "booking", "payment", "ticket"].includes(name)) {
    assert.deepEqual(appOnly.services[name], before.services[name], name);
    checks++;
  }
}
for (const name of ["identity", "event", "booking", "payment", "ticket"]) {
  const service = appOnly.services[name];
  check(
    service.environment.OTEL_EXPORTER_OTLP_ENDPOINT === "http://alloy:4318",
    `${name} sends OTLP internally`,
  );
  check(
    service.environment.LOG_FILE_PATH === `/var/log/ticketing/${name}.log`,
    `${name} writes its JSON log file`,
  );
  check(
    service.depends_on["app-log-init"].condition === "service_completed_successfully",
    `${name} waits only for log directory init`,
  );
  check(!Object.hasOwn(service.depends_on, "alloy"), `${name} does not wait for Alloy`);
  check(
    service.volumes.some((volume) => volume.target === "/var/log/ticketing" && !volume.read_only),
    `${name} can write the shared log directory`,
  );
  check(
    !JSON.stringify(before.services[name]).includes("/var/log/ticketing"),
    `${name} base service has no host log mount`,
  );
  assert.deepEqual(after.services[name], service, `${name} unchanged when obs is added`);
  checks++;
}
for (const [name, network] of Object.entries(before.networks)) {
  assert.deepEqual(appOnly.networks[name], network, name);
  assert.deepEqual(after.networks[name], network, name);
  checks++;
}
assert.deepEqual(Object.keys(appOnly.volumes).sort(), Object.keys(before.volumes).sort());
checks++;
check(appOnly.services["app-log-init"].user === "0:0", "Log init has explicit root user");
check(
  appOnly.services["app-log-init"].cap_drop.includes("ALL"),
  "Log init drops capabilities by default",
);
check(
  appOnly.services["app-log-init"].cap_add.join(",") === "CHOWN,FOWNER,DAC_OVERRIDE",
  "Log init has minimum ownership capabilities",
);
check(after.services.alloy.user === "473:473", "Alloy has fixed unprivileged uid");
check(
  after.services.alloy.volumes.some(
    (volume) => volume.target === "/var/log/ticketing" && volume.read_only,
  ),
  "Alloy reads application logs read-only",
);
for (const service of Object.values(after.services)) {
  for (const port of service.ports ?? [])
    check(port.host_ip === "127.0.0.1", "No public port in merged config");
}
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
// PostgreSQL monitoring credentials: per-cluster, strict, distinct and never echoed.
const runCheck = (content) => {
  writeFileSync(file, content);
  return spawnSync(
    bash,
    [join(root, "infra/obs/obs.sh"), "check", shellPath(file), "ticketing-t404-config"],
    { encoding: "utf8", env },
  );
};
for (const [content, expected, secret] of [
  [
    fixture.replace(
      /^POSTGRES_MONITOR_PASSWORD_BOOKING=.*$/m,
      "POSTGRES_MONITOR_PASSWORD_BOOKING=short-sensitive",
    ),
    "Invalid POSTGRES_MONITOR_PASSWORD_BOOKING",
    "short-sensitive",
  ],
  [
    fixture.replace(/^POSTGRES_MONITOR_PASSWORD_TICKET=.*$/m, "POSTGRES_MONITOR_PASSWORD_TICKET="),
    "Missing field: POSTGRES_MONITOR_PASSWORD_TICKET",
    "synthetic-ticket-monitor-only-t501",
  ],
  [
    fixture.replace(/^POSTGRES_MONITOR_PASSWORD_PAYMENT=.*\n/m, ""),
    "Missing field: POSTGRES_MONITOR_PASSWORD_PAYMENT",
    "synthetic-payment-monitor-only-t501",
  ],
  [
    fixture.replace(
      /^POSTGRES_MONITOR_PASSWORD_PAYMENT=.*$/m,
      "POSTGRES_MONITOR_PASSWORD_PAYMENT=synthetic-shared-monitor-only-t501",
    ),
    "must differ per cluster",
    "synthetic-shared-monitor-only-t501",
  ],
  [
    fixture.replace(
      /^POSTGRES_MONITOR_PASSWORD_SHARED=.*$/m,
      "POSTGRES_MONITOR_PASSWORD_SHARED=synthetic-has space-sensitive-x",
    ),
    "Invalid POSTGRES_MONITOR_PASSWORD_SHARED",
    "space-sensitive",
  ],
  [
    fixture +
      "POSTGRES_EXPORTER_DSN=postgresql://ticketing_monitor:legacy-sensitive@postgres:5432/postgres\n",
    "POSTGRES_EXPORTER_DSN was replaced",
    "legacy-sensitive",
  ],
]) {
  const rejected = runCheck(content);
  const output = rejected.stdout + rejected.stderr;
  check(rejected.status !== 0 && output.includes(expected), `Reject: ${expected}`);
  check(!output.includes(secret), "No leaked PostgreSQL monitoring secret");
}
writeFileSync(file, fixture);
// The role script must stay cluster-agnostic, idempotent and least privilege.
const roleSql = readFileSync(join(root, "infra/postgres/monitoring-role.sql"), "utf8").replace(
  /--.*$/gm,
  "",
);
for (const db of ["identity_db", "event_db", "booking_db", "payment_db", "ticket_db", "finance_db"])
  check(!roleSql.includes(db), `Role script does not assume ${db} exists on every cluster`);
check(!/\bPASSWORD\s+['":]/i.test(roleSql), "Role script carries no password literal/variable");
check(!/\bDROP\b/i.test(roleSql), "Role script never drops the role");
check(!/GRANT\s+(USAGE|SELECT)/i.test(roleSql), "Role script grants no schema/table access");
check(
  /NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT\s+NOREPLICATION/.test(roleSql),
  "Role attributes are least-privilege",
);
check(
  roleSql.includes("GRANT pg_monitor TO ticketing_monitor WITH INHERIT TRUE, SET FALSE;"),
  "pg_monitor inherited explicitly despite NOINHERIT",
);
check(
  roleSql.includes("GRANT CONNECT ON DATABASE postgres TO ticketing_monitor;"),
  "CONNECT only to the postgres database",
);
writeFileSync(file, fixture);
console.log(`T-404 config: ${checks} checks passed (synthetic env only).`);
