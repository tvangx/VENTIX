// Local-only: real compiled service bootstraps + disposable PostgreSQL + a TCP relay.
// Does not touch demo containers, app env, cloud connector or business data.
const assert = require("node:assert/strict");
const { execFileSync, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { generateKeyPairSync } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { join, resolve } = require("node:path");
const root = resolve(__dirname, "../..");
const req = createRequire(join(root, "services/_template/package.json"));
const { PostgreSqlContainer } = req("@testcontainers/postgresql");
const { createLogger } = req("@ticketing/common");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const dir = join(root, "dist/obs/smoke");
mkdirSync(dir, { recursive: true });
const envFile = join(dir, "obs.env");
const project = "ticketing-t404-smoke";
const network = `${project}-backend`;
const relay = `${project}-relay-${Date.now()}`;
const services = ["identity", "event", "booking", "payment", "ticket"];
const password = "synthetic-t404-password-only";
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const shellPath = (path) =>
  process.platform === "win32"
    ? path.replace(/^([A-Z]):/i, (_, drive) => `/${drive.toLowerCase()}`).replaceAll("\\", "/")
    : path;
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  });
const obs = (action) =>
  execFileSync(bash, [join(__dirname, "obs.sh"), action, shellPath(envFile), project], {
    encoding: "utf8",
    timeout: 180000,
  });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, timeout = 90000) {
  const end = Date.now() + timeout;
  let last;
  do {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await wait(1000);
  } while (Date.now() < end);
  throw last ?? new Error("Polling deadline exceeded");
}
async function prom(query, time) {
  const result = await fetch(
    `http://127.0.0.1:19090/api/v1/query?${new URLSearchParams({ query, ...(time ? { time: String(time) } : {}) })}`,
    { headers: { Connection: "close" } },
  ).then((r) => r.json());
  assert.equal(result.status, "success");
  return result.data.result;
}
async function grafana(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:13030${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`obsadmin:${password}`).toString("base64")}`,
      "Content-Type": "application/json",
      Connection: "close",
    },
  });
  assert.ok(response.ok, `Grafana ${path}: ${response.status}`);
  return response.json();
}
const apps = [];
const databases = [];
let timer;
let madeRelay = false;
async function main() {
  // Windows locks loaded Prisma DLLs. Use an identical private engine copy so other
  // test commands can generate clients without attempting to replace a loaded DLL.
  if (process.platform === "win32") {
    const engine = join(dir, `query-engine-${Date.now()}.dll.node`);
    copyFileSync(
      join(root, "services/identity/generated/client/query_engine-windows.dll.node"),
      engine,
    );
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = engine;
  }
  writeFileSync(
    envFile,
    readFileSync(join(__dirname, "obs.env.example"), "utf8")
      .replace("GRAFANA_ADMIN_PASSWORD=", `GRAFANA_ADMIN_PASSWORD=${password}`)
      .replace("OBS_NETWORK=ticketing-prod_backend", `OBS_NETWORK=${network}`)
      .replace("PROMETHEUS_PORT=9090", "PROMETHEUS_PORT=19090")
      .replace("GRAFANA_PORT=3030", "GRAFANA_PORT=13030"),
  );
  const protectedBefore = docker("ps", "--format", "{{.ID}} {{.Names}}")
    .trim()
    .split("\n")
    .filter((line) => /ticketing-t208-local/.test(line));
  try {
    docker("network", "inspect", network);
  } catch {
    docker("network", "create", network);
  }
  for (const [index, service] of services.entries()) {
    const pg = await new PostgreSqlContainer("postgres:16")
      .withUsername(`${service}_user`)
      .withDatabase(`${service}_db`)
      .start();
    databases.push(pg);
    const { envSchema } = require(join(root, `services/${service}/dist/config/env.schema`));
    const { createApp } = require(join(root, `services/${service}/dist/bootstrap`));
    const env = envSchema.parse({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      PORT: String(13301 + index),
      DATABASE_URL: pg.getConnectionUri(),
      AUTH_ISSUER: "https://identity.test",
      AUTH_AUDIENCE: "ticketing-api",
      AUTH_PUBLIC_KEY_PEM: publicKey.export({ type: "spki", format: "pem" }),
      JWT_PRIVATE_KEY_PEM: privateKey.export({ type: "pkcs8", format: "pem" }),
      REHYDRATE_ENABLED: "false",
      EVENT_CONSUMER_ENABLED: "false",
      QUEUE_WORKER_ENABLED: "false",
      PAYMENT_WORKERS_ENABLED: "false",
      ADMISSION_TOKEN_SECRET: "synthetic-t404-admission-only-32-chars",
      INTERNAL_API_KEY: "synthetic-t404-internal-only",
    });
    const app = await createApp(env, createLogger(service, { level: "silent" }));
    await app.listen(13301 + index, "0.0.0.0");
    apps.push(app);
    assert.equal((await fetch(`http://127.0.0.1:${13301 + index}/health/ready`)).status, 200);
    console.log(`${service}: real bootstrap ready against disposable ${service}_db`);
  }
  const relayCode = `const net=require('net');for(let i=0;i<5;i++)net.createServer(s=>{const c=net.connect(13301+i,'host.docker.internal');s.pipe(c).pipe(s);c.on('error',()=>s.destroy());s.on('error',()=>c.destroy());}).listen(3001+i,'0.0.0.0');`;
  docker(
    "run",
    "-d",
    "--name",
    relay,
    "--network",
    network,
    ...services.flatMap((service) => ["--network-alias", service]),
    "--memory",
    "64m",
    "node:20.19.5-bookworm-slim",
    "node",
    "-e",
    relayCode,
  );
  madeRelay = true;
  console.log(obs("start"));
  console.log("Checking HTTP smoke and Kong metrics boundary");
  if (process.env.K6_BINARY) {
    const summary = join(dir, "k6.json");
    const { stdout: output } = await promisify(execFile)(
      process.env.K6_BINARY,
      ["run", "--summary-export", summary, join(__dirname, "http-smoke.js")],
      { encoding: "utf8" },
    );
    const checks = JSON.parse(readFileSync(summary, "utf8")).metrics.checks;
    assert.ok(checks.passes > 0 && checks.fails === 0, "k6 must execute actual successful checks");
    writeFileSync(join(dir, "k6.txt"), output);
    console.log("k6 smoke passed");
  }
  const gateway = `${project}-kong-${Date.now()}`;
  docker(
    "run",
    "-d",
    "--name",
    gateway,
    "--network",
    network,
    "--memory",
    "256m",
    "-p",
    "127.0.0.1:18040:8000",
    "-e",
    "KONG_DATABASE=off",
    "-e",
    "KONG_ROUTER_FLAVOR=traditional",
    "-e",
    "KONG_NGINX_WORKER_PROCESSES=1",
    "-e",
    "KONG_DECLARATIVE_CONFIG=/kong/kong.yml",
    "--mount",
    `type=bind,src=${join(root, "infra/kong/kong.demo.yml")},dst=/kong/kong.yml,readonly`,
    "kong:3.8",
  );
  try {
    await until(async () => (await fetch("http://127.0.0.1:18040/health/infra")).status === 200);
    for (const service of services) {
      for (const suffix of ["metrics", "metrics/", "METRICS", "metrics?probe=1"]) {
        const response = await fetch(`http://127.0.0.1:18040/api/${service}/${suffix}`);
        assert.equal(response.status, 404);
        assert.ok(!(await response.text()).includes("http_server_request_duration_seconds"));
      }
      assert.equal(
        (
          await fetch(`http://127.0.0.1:18040/api/${service}/metrics`, {
            method: "OPTIONS",
            headers: {
              Origin: "https://ventixxx.dpdns.org",
              "Access-Control-Request-Method": "GET",
            },
          })
        ).status,
        404,
      );
    }
    console.log("Kong: 25 external metrics probes blocked");
  } finally {
    docker("stop", gateway);
  }
  const traffic = async () => {
    for (let i = 0; i < services.length; i++) {
      await fetch(`http://127.0.0.1:${13301 + i}/v1/whoami`); // Real guard rejection, no fixture controller.
      await fetch(`http://127.0.0.1:${13301 + i}/missing/t404-smoke`);
    }
  };
  await traffic();
  timer = setInterval(() => traffic().catch(() => {}), 1000);
  await until(async () => {
    const up = await prom('up{job="application"}');
    return up.length === 5 && up.every((row) => row.value[1] === "1");
  });
  const before = await prom(
    'sum by(service) (http_server_request_duration_seconds_count{job="application"})',
  );
  await until(async () => {
    const after = await prom(
      'sum by(service) (http_server_request_duration_seconds_count{job="application"})',
    );
    return (
      after.length === 5 &&
      after.every(
        (row) =>
          Number(row.value[1]) >
          Number(before.find((old) => old.metric.service === row.metric.service)?.value[1]),
      )
    );
  });
  const datasource = await grafana("/api/datasources/uid/prometheus/health");
  assert.equal(datasource.status, "OK");
  const dashboard = await grafana("/api/dashboards/uid/ventix-red");
  assert.ok(dashboard.meta.provisioned);
  // Query every panel through Grafana's actual provisioned datasource.
  for (const panel of dashboard.dashboard.panels) {
    const expr = panel.targets[0].expr
      .replaceAll("$service", ".*")
      .replaceAll("$__rate_interval", "1m");
    await until(async () => {
      const data = await grafana("/api/ds/query", {
        method: "POST",
        body: JSON.stringify({
          from: String(Date.now() - 300000),
          to: String(Date.now()),
          queries: [
            {
              refId: "A",
              datasource: { uid: "prometheus", type: "prometheus" },
              expr,
              instant: true,
              format: "time_series",
              intervalMs: 15000,
              maxDataPoints: 100,
            },
          ],
        }),
      });
      assert.ok(!data.results.A.error, data.results.A.error);
      return data.results.A.frames?.some((frame) =>
        frame.data.values.some((values) => values.length > 0),
      );
    });
  }
  await grafana("/api/org/preferences", {
    method: "PUT",
    body: JSON.stringify({ homeDashboardUID: "ventix-red" }),
  });
  const timestamp = Date.now() / 1000;
  const historic = await prom(
    'sum(http_server_request_duration_seconds_count{job="application"})',
    timestamp,
  );
  console.log(obs("start")); // Force recreate and replay WAL; reuse volumes.
  assert.deepEqual(
    await until(() =>
      prom('sum(http_server_request_duration_seconds_count{job="application"})', timestamp),
    ),
    historic,
  );
  assert.equal((await grafana("/api/org/preferences")).homeDashboardUID, "ventix-red");
  console.log(obs("stop"));
  const protectedAfter = docker("ps", "--format", "{{.ID}} {{.Names}}")
    .trim()
    .split("\n")
    .filter((line) => /ticketing-t208-local/.test(line));
  // Kong was already restarting before test; compare stable business/data daemons only.
  assert.deepEqual(
    protectedAfter.filter((line) => !line.includes("kong")),
    protectedBefore.filter((line) => !line.includes("kong")),
  );
  for (let i = 0; i < services.length; i++)
    assert.equal((await fetch(`http://127.0.0.1:${13301 + i}/health/ready`)).status, 200);
  console.log(obs("start"));
  const footprint = docker(
    "stats",
    "--no-stream",
    "--format",
    "{{.Name}} {{.MemUsage}} {{.CPUPerc}}",
    `${project}-prometheus-1`,
    `${project}-grafana-1`,
  );
  const disk =
    docker("exec", `${project}-prometheus-1`, "du", "-sk", "/prometheus") +
    docker("exec", `${project}-grafana-1`, "du", "-sk", "/var/lib/grafana");
  writeFileSync(
    join(dir, "result.json"),
    JSON.stringify(
      {
        targets: await prom('up{job="application"}'),
        histogram: await prom(
          'sum by(service) (http_server_request_duration_seconds_count{job="application"})',
        ),
        datasource,
        dashboard: dashboard.meta.provisioned,
        historic,
        footprint,
        disk,
        persistence: true,
        stopPreservesApps: true,
      },
      null,
      2,
    ),
  );
  console.log(footprint + disk);
  console.log("SMOKE READY: real RED verified; holding for browser screenshot when --hold is set.");
  if (process.argv.includes("--hold")) await until(() => existsSync(join(dir, "release")), 600000);
  console.log(obs("stop"));
}
main()
  .catch((error) => {
    console.error(error.stack, error.cause?.message ?? "");
    process.exitCode = 1;
  })
  .finally(async () => {
    clearInterval(timer);
    for (const app of apps.reverse()) await app.close();
    for (const pg of databases.reverse()) await pg.stop();
    if (madeRelay) docker("stop", relay);
  });
