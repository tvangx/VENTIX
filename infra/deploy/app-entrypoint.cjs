const { spawn } = require("node:child_process");
const { envSchema } = require("./dist/config/env.schema");

const service = process.env.DEMO_SERVICE;
const hosts = {
  identity: "postgres",
  event: "postgres",
  booking: "postgres-booking",
  payment: "postgres-payment",
  ticket: "postgres-ticket",
};
if (!Object.hasOwn(hosts, service) || !process.env.DB_PASSWORD) {
  process.stderr.write("Missing valid DEMO_SERVICE or DB_PASSWORD\n");
  process.exit(1);
}
process.env.DATABASE_URL = `postgresql://${service}_user:${encodeURIComponent(process.env.DB_PASSWORD)}@${hosts[service]}:5432/${service}_db`;
if (process.env.REDIS_PASSWORD)
  process.env.REDIS_URL = `redis://:${encodeURIComponent(process.env.REDIS_PASSWORD)}@redis:6379`;
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Report field names only: validation errors must never dump input secrets.
  process.stderr.write(
    `Invalid ${service} configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}\n`,
  );
  process.exit(1);
}
const command = process.argv.slice(2);
if (command[0] === "validate") process.exit(0);
const child = spawn(command[0], command.slice(1), { stdio: "inherit", env: process.env });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("error", () => {
  process.stderr.write(`Could not start ${service} command\n`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
