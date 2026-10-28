// Kiểm tra config thực bằng secret giả; không tạo container hay kết nối VPS.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const root = resolve(__dirname, "../..");
const example = readFileSync(join(root, ".env.prod.example"), "utf8");
const required = [...example.matchAll(/^([A-Z_]+)=$/gm)].map((match) => match[1]);
const fixture = example.replace(/^([A-Z_]+)=$/gm, "$1=test-only-not-a-secret");
const dir = mkdtempSync(join(tmpdir(), "ticketing-t207-config-"));
const file = join(dir, ".env.prod");
const env = { ...process.env };
// Không để biến export ở máy chạy che mất ca thiếu secret.
for (const match of example.matchAll(/^([A-Z_]+)=/gm)) delete env[match[1]];
const args = [
  "compose",
  "--env-file",
  file,
  "-f",
  join(root, "infra/compose/docker-compose.prod.yml"),
  "--profile",
  "bootstrap",
  "config",
];
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
try {
  writeFileSync(file, fixture);
  const plainArgs = args.filter((arg) => !["--profile", "bootstrap"].includes(arg));
  const plain = spawnSync("docker", [...plainArgs, "--quiet"], { encoding: "utf8", env });
  check(plain.status === 0, "Default compose config must pass without enabling bootstrap profile");
  const result = spawnSync("docker", [...args, "--format", "json"], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr);
  checks++;
  const config = JSON.parse(result.stdout);
  check(
    Object.keys(config.services).length === 9,
    "Expected 8 daemons and 1 bootstrap job, no business service",
  );
  check(config.networks.backend.internal === true, "Backend must be internal");
  for (const [name, service] of Object.entries(config.services)) {
    check(service.image.includes("@sha256:"), `${name}: image must be pinned`);
    if (name === "kong") {
      check(
        service.ports.length === 1 &&
          service.ports[0].host_ip === "127.0.0.1" &&
          service.ports[0].target === 8000,
        "Only loopback Kong proxy may be published",
      );
      check(service.environment.KONG_ADMIN_LISTEN === "off", "Admin API must be disabled");
    } else {
      check(!service.ports?.length, `${name}: must not publish ports`);
      check(!service.networks.edge, `${name}: must only use backend`);
    }
    check(
      service.restart === (name === "kafka-init" ? "no" : "unless-stopped"),
      `${name}: restart policy`,
    );
  }
  for (const variable of required) {
    writeFileSync(file, fixture.replace(new RegExp(`^${variable}=.*$`, "m"), `${variable}=`));
    const missing = spawnSync("docker", [...args, "--quiet"], { encoding: "utf8", env });
    check(
      missing.status !== 0 && missing.stderr.includes(variable),
      `Missing ${variable} must fail without fallback`,
    );
  }
  const imageVariables = [...example.matchAll(/^([A-Z_]+_IMAGE)=/gm)].map((match) => match[1]);
  for (const variable of imageVariables) {
    writeFileSync(file, fixture.replace(new RegExp(`^${variable}=.*$`, "m"), `${variable}=`));
    const missing = spawnSync("docker", [...args, "--quiet"], { encoding: "utf8", env });
    check(
      missing.status !== 0 && missing.stderr.includes(variable),
      `Missing ${variable} must fail`,
    );
  }
  process.stdout.write(
    `PASS: ${checks} config assertions, including ${required.length} missing-secret cases. No containers started.\n`,
  );
} finally {
  unlinkSync(file);
  rmdirSync(dir);
}
