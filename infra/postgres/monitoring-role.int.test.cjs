// node infra/postgres/monitoring-role.int.test.cjs — T-501 multi-cluster PostgreSQL monitoring.
// Docker only, synthetic credentials, temporary containers/network; no host DB port, no app data.
// Reproduces the EC2 failure of the legacy script, then proves the new role script and one
// postgres_exporter per cluster (from docker-compose.obs.yml) against four independent clusters.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const root = resolve(__dirname, "../..");
const pick = (file, key) =>
  readFileSync(join(root, file), "utf8")
    .match(new RegExp(`^${key}=(.+)$`, "m"))[1]
    .trim();
const postgresImage = pick(".env.prod.example", "POSTGRES_IMAGE");
const prometheusImage = pick("infra/obs/obs.env.example", "PROMETHEUS_IMAGE");
const id = `ticketing-t501-pgmon-${Date.now()}`;
const admin = "t501_admin";
// Mirrors infra/compose/docker-compose.prod.yml: service DNS alias and SERVICE_DATABASES.
const clusters = {
  shared: { alias: "postgres", databases: ["identity", "event", "finance"] },
  booking: { alias: "postgres-booking", databases: ["booking"] },
  payment: { alias: "postgres-payment", databases: ["payment"] },
  ticket: { alias: "postgres-ticket", databases: ["ticket"] },
};
const monitorPassword = (cluster) => `synthetic-${cluster}-monitor-only-t501`;
const exporters = Object.keys(clusters).map((cluster) => `postgres-exporter-${cluster}`);
const roleSql = readFileSync(join(__dirname, "monitoring-role.sql"), "utf8");
// Exact content of the script shipped in #119/#120 that failed on EC2.
const legacySql = [
  "CREATE ROLE ticketing_monitor LOGIN PASSWORD :'monitor_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;",
  "GRANT pg_monitor TO ticketing_monitor;",
  "GRANT CONNECT ON DATABASE identity_db, event_db, booking_db, payment_db, ticket_db, resale_db, finance_db TO ticketing_monitor;",
].join("\n");

const docker = (args, input) =>
  spawnSync("docker", args, { encoding: "utf8", timeout: 120000, input });
const container = (cluster) => `${id}-${cluster}`;
const psql = (cluster, input, { db = "postgres", vars = [] } = {}) =>
  docker(
    [
      "exec",
      "-i",
      container(cluster),
      "psql",
      "-XAtq",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      admin,
      "-d",
      db,
      ...vars.flatMap((v) => ["-v", v]),
    ],
    input,
  );
const asMonitor = (cluster, db, query) =>
  docker([
    "exec",
    "-e",
    `PGPASSWORD=${monitorPassword(cluster)}`,
    container(cluster),
    "psql",
    "-XAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-h",
    "127.0.0.1",
    "-U",
    "ticketing_monitor",
    "-d",
    db,
    "-c",
    query,
  ]);
const value = (result, message) => {
  assert.equal(result.status, 0, `${message}: ${result.stderr}`);
  return result.stdout.trim();
};

const dir = mkdtempSync(join(tmpdir(), "ventix-t501-pgmon-"));
const envFile = join(dir, "obs.env");
const compose = [
  "compose",
  "-p",
  id,
  "--env-file",
  envFile,
  "-f",
  join(root, "infra/compose/docker-compose.obs.yml"),
];
let checks = 0;
const check = (ok, message) => {
  assert.ok(ok, message);
  checks++;
};
const poll = async (label, fn, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last.ok) return last;
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${label}: ${last?.detail ?? ""}`);
};

(async () => {
  let networkCreated = false;
  let exportersStarted = false;
  const started = [];
  try {
    const net = docker(["network", "create", id]);
    assert.equal(net.status, 0, net.stderr);
    networkCreated = true;
    for (const [cluster, { alias, databases }] of Object.entries(clusters)) {
      const passwords = databases.flatMap((db) => [
        "-e",
        `DB_PASSWORD_${db.toUpperCase()}=test-only-${db}`,
      ]);
      const run = docker([
        "run",
        "--rm",
        "-d",
        "--name",
        container(cluster),
        "--network",
        id,
        "--network-alias",
        alias,
        "-e",
        `POSTGRES_USER=${admin}`,
        "-e",
        "POSTGRES_PASSWORD=test-only-admin",
        "-e",
        "POSTGRES_DB=postgres",
        "-e",
        "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256",
        "-e",
        `SERVICE_DATABASES=${databases.join(" ")}`,
        ...passwords,
        "--mount",
        `type=bind,source=${join(__dirname, "prod-init")},target=/docker-entrypoint-initdb.d,readonly`,
        postgresImage,
      ]);
      assert.equal(run.status, 0, run.stderr);
      started.push(container(cluster));
    }
    for (const [cluster, { databases }] of Object.entries(clusters)) {
      await poll(
        `${cluster} PostgreSQL after init`,
        () => {
          const r = docker([
            "exec",
            container(cluster),
            "pg_isready",
            "-h",
            "127.0.0.1",
            "-U",
            admin,
            "-d",
            "postgres",
          ]);
          return { ok: r.status === 0, detail: r.stdout + r.stderr };
        },
        90000,
      );
      const found = value(
        psql(
          cluster,
          "SELECT string_agg(datname, ',' ORDER BY datname) FROM pg_database WHERE datname LIKE '%\\_db';",
        ),
        "list databases",
      );
      check(
        found ===
          databases
            .map((db) => `${db}_db`)
            .sort()
            .join(","),
        `${cluster} cluster holds only its own databases`,
      );
    }

    // 1) Reproduce the EC2 failure and the latent NOINHERIT problem on the shared cluster.
    const legacy = psql("shared", legacySql, { vars: ["monitor_password=legacy-synthetic-only"] });
    check(legacy.status !== 0, "Legacy script fails on the shared cluster");
    check(
      legacy.stderr.includes('database "booking_db" does not exist'),
      "Legacy failure matches EC2 error",
    );
    check(
      value(
        psql(
          "shared",
          "SELECT m.inherit_option, pg_has_role('ticketing_monitor', 'pg_read_all_stats', 'USAGE') FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member JOIN pg_roles g ON g.oid = m.roleid WHERE r.rolname = 'ticketing_monitor' AND g.rolname = 'pg_monitor';",
        ),
        "legacy membership",
      ) === "f|f",
      "Legacy NOINHERIT grant leaves pg_monitor unusable without SET ROLE",
    );

    // 2) New script: idempotent on every cluster, including the pre-existing shared role.
    for (const cluster of Object.keys(clusters)) {
      for (const attempt of [1, 2]) {
        const applied = psql(cluster, roleSql);
        check(applied.status === 0, `${cluster} role script run ${attempt}: ${applied.stderr}`);
        check(
          applied.stderr.includes("ticketing_monitor verified on this cluster"),
          `${cluster} role script verifies run ${attempt}`,
        );
      }
      // Runbook uses interactive \password; tests set a synthetic value through a psql variable.
      value(
        psql(cluster, "ALTER ROLE ticketing_monitor PASSWORD :'pw';", {
          vars: [`pw=${monitorPassword(cluster)}`],
        }),
        "set synthetic password",
      );
      check(
        value(
          psql(
            cluster,
            "SELECT concat_ws('|', rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls, rolcanlogin, rolconnlimit) FROM pg_roles WHERE rolname = 'ticketing_monitor';",
          ),
          "attributes",
        ) === "f|f|f|f|f|f|t|3",
        `${cluster} role attributes are least-privilege`,
      );
      check(
        value(
          psql(
            cluster,
            "SELECT string_agg(concat_ws(':', g.rolname, m.inherit_option, m.set_option, m.admin_option), ',') FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'ticketing_monitor';",
          ),
          "memberships",
        ) === "pg_monitor:t:f:f",
        `${cluster} only membership is pg_monitor (inherit, no SET/ADMIN)`,
      );
    }

    // 3) Positive/negative privilege checks as the monitoring role itself.
    for (const [cluster, { databases }] of Object.entries(clusters)) {
      check(
        value(
          asMonitor(
            cluster,
            "postgres",
            `SELECT pg_has_role('pg_read_all_stats', 'USAGE') AND pg_database_size('${databases[0]}_db') > 0;`,
          ),
          "monitor stats",
        ) === "t",
        `${cluster} monitor reads cluster stats and DB size without CONNECT`,
      );
      check(
        asMonitor(cluster, "postgres", "SET ROLE pg_monitor;").status !== 0,
        `${cluster} monitor cannot SET ROLE`,
      );
      check(
        asMonitor(cluster, "postgres", "CREATE TABLE t501_should_fail(id int);").status !== 0,
        `${cluster} monitor cannot create objects`,
      );
      for (const db of databases) {
        const denied = asMonitor(cluster, `${db}_db`, "SELECT 1;");
        check(
          denied.status !== 0 && denied.stderr.includes("permission denied for database"),
          `${cluster} monitor cannot CONNECT to ${db}_db`,
        );
        value(
          psql(cluster, "CREATE TABLE public.t501_business(id int);", { db: `${db}_db` }),
          "create business table",
        );
        check(
          value(
            psql(
              cluster,
              "SELECT has_table_privilege('ticketing_monitor', 'public.t501_business', 'SELECT');",
              { db: `${db}_db` },
            ),
            "table privilege",
          ) === "f",
          `${cluster} monitor has no SELECT on ${db}_db tables`,
        );
      }
    }

    // 4) One exporter per cluster, exactly as shipped in docker-compose.obs.yml.
    let env = readFileSync(join(root, "infra/obs/obs.env.example"), "utf8")
      .replace(/^OBS_NETWORK=.*$/m, `OBS_NETWORK=${id}`)
      .replace("GRAFANA_ADMIN_PASSWORD=", "GRAFANA_ADMIN_PASSWORD=synthetic-t501-grafana-only");
    for (const cluster of Object.keys(clusters))
      env = env.replace(
        `POSTGRES_MONITOR_PASSWORD_${cluster.toUpperCase()}=`,
        `POSTGRES_MONITOR_PASSWORD_${cluster.toUpperCase()}=${monitorPassword(cluster)}`,
      );
    writeFileSync(envFile, env);
    const up = docker([...compose, "up", "-d", "--pull", "never", "--no-deps", ...exporters]);
    exportersStarted = true;
    assert.equal(up.status, 0, up.stderr);
    const dashboard = JSON.parse(
      readFileSync(join(root, "infra/grafana/dashboards/system.json"), "utf8"),
    );
    const dashboardMetrics = [
      ...new Set(
        dashboard.panels
          .flatMap((panel) => panel.targets.map((t) => t.expr))
          .flatMap((expr) => [...expr.matchAll(/\b(pg_[a-z_]+)\{/g)].map((m) => m[1])),
      ),
    ];
    check(dashboardMetrics.length >= 4, "Dashboard uses PostgreSQL exporter metrics");
    for (const [cluster, { databases }] of Object.entries(clusters)) {
      const service = `postgres-exporter-${cluster}`;
      const { metrics } = await poll(
        `${service} pg_up 1`,
        () => {
          const r = docker([
            ...compose,
            "exec",
            "-T",
            service,
            "wget",
            "-qO-",
            "http://127.0.0.1:9187/metrics",
          ]);
          return { ok: /^pg_up 1$/m.test(r.stdout), metrics: r.stdout, detail: r.stderr };
        },
        60000,
      );
      for (const metric of dashboardMetrics)
        check(new RegExp(`^${metric}[{ ]`, "m").test(metrics), `${cluster} exposes ${metric}`);
      for (const db of databases)
        check(
          metrics.includes(`pg_database_size_bytes{datname="${db}_db"}`),
          `${cluster} exporter reports size of ${db}_db`,
        );
      const logs = docker([...compose, "logs", "--no-color", service]);
      check(
        !/permission denied/i.test(logs.stdout + logs.stderr),
        `${cluster} exporter has no permission errors`,
      );
      check(
        !(logs.stdout + logs.stderr).includes(monitorPassword(cluster)),
        `${cluster} exporter log has no password`,
      );
    }

    // 5) Real Prometheus scrape of the shipped config: four labelled targets up.
    const promtool = docker([
      "run",
      "--rm",
      "--entrypoint",
      "/bin/promtool",
      "--mount",
      `type=bind,source=${join(root, "infra/prometheus")},target=/etc/prometheus,readonly`,
      prometheusImage,
      "check",
      "config",
      "/etc/prometheus/prometheus.yml",
    ]);
    check(promtool.status === 0, `promtool check config: ${promtool.stderr}`);
    const prom = docker([
      "run",
      "--rm",
      "-d",
      "--name",
      `${id}-prometheus`,
      "--network",
      id,
      "-p",
      "127.0.0.1::9090",
      "--mount",
      `type=bind,source=${join(root, "infra/prometheus")},target=/etc/prometheus,readonly`,
      prometheusImage,
      "--config.file=/etc/prometheus/prometheus.yml",
      "--storage.tsdb.path=/prometheus",
    ]);
    assert.equal(prom.status, 0, prom.stderr);
    started.push(`${id}-prometheus`);
    const port = value(docker(["port", `${id}-prometheus`, "9090/tcp"]), "prometheus port")
      .split("\n")[0]
      .split(":")
      .pop();
    const query = async (expr) => {
      try {
        const res = await fetch(
          `http://127.0.0.1:${port}/api/v1/query?query=${encodeURIComponent(expr)}`,
        );
        return (await res.json()).data?.result ?? [];
      } catch {
        return [];
      }
    };
    for (const expr of ['up{job="postgres"}', 'pg_up{job="postgres"}']) {
      const { result } = await poll(
        `${expr} for four clusters`,
        async () => {
          const result = await query(expr);
          const ok = result.length === 4 && result.every((sample) => sample.value[1] === "1");
          return { ok, result, detail: JSON.stringify(result) };
        },
        90000,
      );
      check(
        result
          .map((sample) => sample.metric.cluster)
          .sort()
          .join(",") === "booking,payment,shared,ticket",
        `${expr} labelled by the four clusters`,
      );
      check(
        result.every((sample) => sample.metric.exporter === "postgres"),
        `${expr} keeps exporter=postgres label`,
      );
    }

    const stats = docker([
      "stats",
      "--no-stream",
      "--format",
      "{{.Name}} {{.MemUsage}}",
      ...exporters.map((service) => `${id}-${service}-1`),
    ]);
    console.log(`Exporter memory: ${stats.stdout.trim().replaceAll("\n", "; ")}`);
    console.log(`T-501 PostgreSQL multi-cluster monitoring: ${checks} checks passed.`);
  } finally {
    if (exportersStarted) docker([...compose, "rm", "--stop", "--force", ...exporters]);
    for (const name of started.reverse()) docker(["stop", "-t", "5", name]);
    if (networkCreated) docker(["network", "rm", id]);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
