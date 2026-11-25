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
const tokenFile = join(dir, "token");
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
  writeFileSync(tokenFile, "test-only-token-sentinel");
  const plainArgs = args.filter((arg) => !["--profile", "bootstrap"].includes(arg));
  const plain = spawnSync("docker", [...plainArgs, "--quiet"], { encoding: "utf8", env });
  check(plain.status === 0, "Default compose config must pass without enabling bootstrap profile");
  writeFileSync(file, fixture.replace(/^CLOUDFLARED_IMAGE=.*\r?\n/m, ""));
  const withoutTunnel = spawnSync("docker", [...plainArgs, "--quiet"], {
    encoding: "utf8",
    env: { ...env, CLOUDFLARED_TOKEN_FILE: "" },
  });
  check(withoutTunnel.status === 0, "Base must pass without tunnel image or token file");
  writeFileSync(file, fixture);
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
  const imageVariables = [...example.matchAll(/^([A-Z_]+_IMAGE)=/gm)]
    .map((match) => match[1])
    .filter((name) => name !== "CLOUDFLARED_IMAGE");
  for (const variable of imageVariables) {
    writeFileSync(file, fixture.replace(new RegExp(`^${variable}=.*$`, "m"), `${variable}=`));
    const missing = spawnSync("docker", [...args, "--quiet"], { encoding: "utf8", env });
    check(
      missing.status !== 0 && missing.stderr.includes(variable),
      `Missing ${variable} must fail`,
    );
  }
  writeFileSync(file, fixture);
  const tunnelArgs = [
    ...args.slice(0, args.indexOf("--profile")),
    "-f",
    join(root, "infra/compose/docker-compose.tunnel.yml"),
    "--profile",
    "bootstrap",
    "config",
  ];
  const tunnelEnv = { ...env, CLOUDFLARED_TOKEN_FILE: tokenFile };
  const tunnel = spawnSync("docker", [...tunnelArgs, "--format", "json"], {
    encoding: "utf8",
    env: tunnelEnv,
  });
  check(tunnel.status === 0, tunnel.stderr);
  const merged = JSON.parse(tunnel.stdout);
  const connector = merged.services.cloudflared;
  check(Object.keys(merged.services).length === 10, "Overlay only adds connector");
  check(merged.name === config.name, "Project identity is unchanged");
  check(JSON.stringify(merged.volumes) === JSON.stringify(config.volumes), "Volumes unchanged");
  for (const [name, service] of Object.entries(config.services)) {
    check(
      JSON.stringify(merged.services[name].volumes) === JSON.stringify(service.volumes),
      `${name}: mounts unchanged`,
    );
    check(
      JSON.stringify(merged.services[name].ports) === JSON.stringify(service.ports),
      `${name}: published ports unchanged`,
    );
  }
  check(!connector.ports?.length, "Connector publishes no ports");
  check(!connector.networks.backend && !connector.networks.edge, "Connector isolated from backend");
  check(connector.networks["tunnel-origin"].ipv4_address === "172.30.207.2", "Fixed connector IP");
  check(merged.networks["tunnel-origin"].internal === true, "Origin network internal");
  const originMembers = Object.entries(merged.services)
    .filter(([, service]) => service.networks["tunnel-origin"])
    .map(([name]) => name)
    .sort();
  check(
    JSON.stringify(originMembers) === JSON.stringify(["cloudflared", "kong"]),
    "Only gateway and connector share origin",
  );
  const gateway = merged.services.kong;
  check(gateway.environment.KONG_TRUSTED_IPS === "172.30.207.2/32", "Trust exact connector only");
  check(
    gateway.environment.KONG_REAL_IP_HEADER === "CF-Connecting-IP",
    "Cloudflare client IP header",
  );
  check(gateway.environment.KONG_REAL_IP_RECURSIVE === "off", "No recursive header traversal");
  check(gateway.environment.KONG_ADMIN_LISTEN === "off", "Admin remains disabled");
  check(connector.image.includes("@sha256:"), "Connector image pinned");
  check(connector.user === "65532:65532" && connector.read_only, "Nonroot read-only connector");
  check(connector.restart === "unless-stopped", "Connector restart policy");
  check(
    connector.logging.driver === "local" &&
      connector.logging.options["max-size"] === "10m" &&
      connector.logging.options["max-file"] === "3",
    "Bounded connector logs",
  );
  check(connector.command.includes("127.0.0.1:2000"), "Metrics stays on container loopback");
  check(!connector.environment?.TUNNEL_TOKEN, "No token environment");
  check(
    connector.command.includes("--token-file") && !connector.command.includes("--token"),
    "File-only token argument",
  );
  const mount = connector.volumes[0];
  check(
    mount.type === "bind" && mount.read_only && mount.bind.create_host_path === false,
    "Read-only existing file mount",
  );
  check(mount.target === "/run/secrets/cloudflared-token", "Token mount matches command");
  check(!tunnel.stdout.includes("test-only-token-sentinel"), "Token content absent from config");
  check(connector.healthcheck.test.includes("ready"), "Connector readiness is checked");
  for (const variable of ["CLOUDFLARED_IMAGE", "CLOUDFLARED_TOKEN_FILE"]) {
    const missingEnv = { ...tunnelEnv, [variable]: "" };
    const missing = spawnSync("docker", [...tunnelArgs, "--quiet"], {
      encoding: "utf8",
      env: missingEnv,
    });
    check(missing.status !== 0 && missing.stderr.includes(variable), `Missing ${variable} fails`);
  }
  process.stdout.write(
    `PASS: ${checks} config assertions, including ${required.length} missing-secret cases. No containers started.\n`,
  );
} finally {
  unlinkSync(tokenFile);
  unlinkSync(file);
  rmdirSync(dir);
}
