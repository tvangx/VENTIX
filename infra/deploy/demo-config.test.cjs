const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { generateKeyPairSync } = require("node:crypto");

const root = resolve(__dirname, "../..");
const dir = mkdtempSync(join(tmpdir(), "ticketing-t208-"));
const infra = join(dir, "infra.env");
const demo = join(dir, "demo.env");
const override = join(dir, "local.yml");
const token = join(dir, "token");
writeFileSync(
  infra,
  readFileSync(join(root, ".env.prod.example"), "utf8").replace(
    /^([A-Z_]+)=$/gm,
    "$1=t208-local-fixture-only",
  ),
);
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const fixtures = {
  DEMO_RELEASE: process.env.DEMO_RELEASE ?? "t208",
  DEMO_ORIGIN: "https://ventixxx.dpdns.org",
  INTERNAL_API_KEY: "t208-local-internal-fixture-only",
  ADMISSION_TOKEN_SECRET: "t208-local-admission-fixture-only-32",
  JWT_PRIVATE_KEY_PEM: privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n"),
  TICKET_ACTIVE_KEY_ID: "demo-v1",
  TICKET_ENCRYPTION_KEYS: JSON.stringify({ "demo-v1": Buffer.alloc(32, 7).toString("base64") }),
  VNPAY_TMN_CODE: "TEST208X",
  VNPAY_HASH_SECRET: "t208-synthetic-test-not-a-merchant-secret",
};
function envFile(values) {
  writeFileSync(
    demo,
    Object.entries(values)
      .map(([key, value]) => `${key}='${value}'`)
      .join("\n") + "\n",
  );
}
envFile(fixtures);
writeFileSync(token, "t208-invalid-token-no-external-connection");
writeFileSync(override, "services:\n  kong:\n    ports: !reset []\n");
const env = { ...process.env, CLOUDFLARED_TOKEN_FILE: token };
// Ignore exported variables on developer machine, never read a real env file.
for (const key of [
  ...Object.keys(fixtures),
  ...readFileSync(infra, "utf8").matchAll(/^([A-Z_]+)=/gm),
].map((item) => (Array.isArray(item) ? item[1] : item)))
  delete env[key];
const base = [
  "compose",
  "-p",
  "ticketing-t208-local",
  "--env-file",
  infra,
  "--env-file",
  demo,
  "-f",
  join(root, "infra/compose/docker-compose.prod.yml"),
];
const apps = [...base, "-f", join(root, "infra/compose/docker-compose.apps.yml"), "-f", override];
const tunnel = [
  ...base,
  "-f",
  join(root, "infra/compose/docker-compose.tunnel.yml"),
  "-f",
  join(root, "infra/compose/docker-compose.apps.yml"),
  "-f",
  override,
];
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}
function docker(args, input) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    env,
    input,
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const config = JSON.parse(docker([...tunnel, "config", "--format", "json"]));
const old = JSON.parse(
  docker([
    ...base,
    "-f",
    join(root, "infra/compose/docker-compose.tunnel.yml"),
    "-f",
    override,
    "config",
    "--format",
    "json",
  ]),
);
check(JSON.stringify(config.volumes) === JSON.stringify(old.volumes), "Data volumes unchanged");
check(JSON.stringify(config.networks) === JSON.stringify(old.networks), "Networks unchanged");
check(
  JSON.stringify(config.services.cloudflared) === JSON.stringify(old.services.cloudflared),
  "Connector unchanged",
);
for (const svc of [
  "postgres",
  "postgres-booking",
  "postgres-payment",
  "postgres-ticket",
  "redis",
  "kafka",
  "minio",
])
  check(
    JSON.stringify(config.services[svc]) === JSON.stringify(old.services[svc]),
    `${svc} unchanged`,
  );
check(
  config.services.kong.environment.KONG_TRUSTED_IPS === "172.30.207.2/32",
  "Exact connector trust",
);
check(config.services.kong.environment.KONG_ADMIN_LISTEN === "off", "Kong Admin off");
check(
  config.services.kong.environment.KONG_ROUTER_FLAVOR === "traditional",
  "T-206 PCRE router required",
);
check(
  config.services.identity.environment.AUTH_JWKS_URI ===
    "http://identity:3001/.well-known/jwks.json",
  "Identity publishes JWKS outside v1 prefix",
);
for (const [name, svc] of Object.entries(config.services))
  check(!svc.ports?.length, `${name}: no extra published ports in local test`);
for (const svc of ["identity", "event", "booking", "payment", "ticket"]) {
  check(
    config.services[svc].depends_on[`${svc}-migrate`].condition ===
      "service_completed_successfully",
    `${svc} migration gate`,
  );
  check(
    config.services[`${svc}-migrate`].command.join(" ") ===
      "node_modules/.bin/prisma migrate deploy",
    `${svc} no seed/reset`,
  );
}
for (const key of Object.keys(fixtures)) {
  envFile({ ...fixtures, [key]: "" });
  const result = spawnSync("docker", [...apps, "config", "--quiet"], { encoding: "utf8", env });
  check(result.status !== 0 && result.stderr.includes(key), `${key} missing must fail`);
}
envFile(fixtures);
writeFileSync(join(dir, "compose-args.json"), JSON.stringify(apps));
process.stdout.write(`PASS ${checks} config checks. Synthetic local fixture directory: ${dir}\n`);
if (process.argv.includes("--up")) {
  // New isolated project/volumes; never read or mutate existing dev/prod data.
  process.stdout.write(
    docker([
      ...apps,
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "240",
      "postgres",
      "postgres-booking",
      "postgres-payment",
      "postgres-ticket",
      "redis",
      "kafka",
    ]),
  );
  process.stdout.write(docker([...apps, "run", "--rm", "--no-deps", "kafka-init"]));
  process.stdout.write(
    docker([
      ...apps,
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "240",
      "identity",
      "event",
      "booking",
      "payment",
      "ticket",
      "web",
      "kong",
    ]),
  );
  process.stdout.write(
    "PASS isolated demo stack healthy. Keep fixture directory for further smoke; no volume removal.\n",
  );
  // Existing additive seeds, ONLY on this isolated local project.
  process.stdout.write(
    docker([...apps, "run", "--rm", "--no-deps", "identity", "node", "prisma/seed.js"]),
  );
  process.stdout.write(
    docker([...apps, "run", "--rm", "--no-deps", "event", "node", "dist/tools/seed.js"]),
  );
  process.stdout.write(
    docker(
      [
        ...apps,
        "exec",
        "-T",
        "-e",
        "T208_SYNTHETIC_LOCAL=true",
        "web",
        "node",
        "--input-type=module",
      ],
      readFileSync(join(__dirname, "demo-smoke.mjs"), "utf8"),
    ),
  );
}
