// node infra/postgres/prod-init.test.cjs — chỉ Postgres local tạm, không có port host.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const root = resolve(__dirname, "../..");
const image = readFileSync(resolve(root, ".env.prod.example"), "utf8")
  .match(/^POSTGRES_IMAGE=(.+)$/m)[1]
  .trim();
const name = `ticketing-t207-init-${Date.now()}`;
const password = "test-only'quote\\and$dollar";
const docker = (...args) => spawnSync("docker", args, { encoding: "utf8", timeout: 30000 });
const sql = (query) =>
  docker(
    "exec",
    name,
    "psql",
    "-XAt",
    "-U",
    "t207_bootstrap",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    query,
  );
let started = false;
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};

(async () => {
  try {
    const run = docker(
      "run",
      "--rm",
      "-d",
      "--name",
      name,
      "-e",
      "POSTGRES_USER=t207_bootstrap",
      "-e",
      "POSTGRES_PASSWORD=test-only-bootstrap",
      "-e",
      "SERVICE_DATABASES=booking",
      "-e",
      `DB_PASSWORD_BOOKING=${password}`,
      "--mount",
      `type=bind,source=${resolve(__dirname, "prod-init")},target=/docker-entrypoint-initdb.d,readonly`,
      image,
    );
    assert.equal(run.status, 0, run.stderr);
    started = true;
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      const probe = docker(
        "exec",
        name,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "t207_bootstrap",
        "-d",
        "postgres",
      );
      if (probe.status === 0) {
        ready = true;
        break;
      }
      await delay(500);
    }
    check(ready, "Postgres must complete init and listen on TCP");
    check(
      sql(
        "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='booking_db'",
      ).stdout.trim() === "booking_user",
      "booking_user owns booking_db",
    );
    check(
      sql(
        "SELECT rolsuper::text || ',' || rolcreatedb::text FROM pg_roles WHERE rolname='booking_user'",
      ).stdout.trim() === "false,false",
      "Business role must not be superuser/CREATEDB",
    );
    const auth = docker(
      "exec",
      "-e",
      `PGPASSWORD=${password}`,
      name,
      "psql",
      "-XAt",
      "-h",
      "127.0.0.1",
      "-U",
      "booking_user",
      "-d",
      "booking_db",
      "-c",
      "SELECT current_user",
    );
    check(
      auth.status === 0 && auth.stdout.trim() === "booking_user",
      "Quoted password must work with SCRAM login",
    );
    check(
      sql("SELECT count(*) FROM pg_database WHERE datname LIKE '%_db'").stdout.trim() === "1",
      "Only the configured service DB is created",
    );
    assert.equal(sql("CREATE ROLE t207_probe LOGIN PASSWORD 'test-only-probe'").status, 0);
    const forbidden = docker(
      "exec",
      "-e",
      "PGPASSWORD=test-only-probe",
      name,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "t207_probe",
      "-d",
      "booking_db",
      "-c",
      "SELECT 1",
    );
    check(
      forbidden.status !== 0 && forbidden.stderr.includes("permission denied"),
      "Unrelated role must not connect to booking_db",
    );
    check(
      docker("exec", name, "bash", "/docker-entrypoint-initdb.d/01-create-databases.sh").status ===
        0,
      "Init can run again without duplicate role/DB failures",
    );
    check(
      docker(
        "exec",
        "-e",
        "DB_PASSWORD_BOOKING=",
        name,
        "bash",
        "/docker-entrypoint-initdb.d/01-create-databases.sh",
      ).status !== 0,
      "Empty secret must fail without dev fallback",
    );
    process.stdout.write(
      `PASS: ${checks} Postgres init assertions in a temporary local container.\n`,
    );
  } finally {
    if (started) {
      const stop = docker("stop", name);
      assert.equal(stop.status, 0, stop.stderr);
    }
  }
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
