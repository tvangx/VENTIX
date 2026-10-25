import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";

/** Mỗi suite có DB riêng. TEST_DATABASE_URL chỉ dành cho PostgreSQL kiểm thử local. */
export async function testDatabase() {
  const external = process.env.TEST_DATABASE_URL;
  const container = external ? undefined : await new PostgreSqlContainer("postgres:16").start();
  const adminUrl = external ?? container!.getConnectionUri();
  const databaseName = `identity_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: adminUrl });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const uri = new URL(adminUrl);
  uri.pathname = `/${databaseName}`;
  const url = uri.toString();
  const root = join(__dirname, "../..");
  const runPrisma = (...args: string[]) =>
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), ...args], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });
  const pool = new Pool({ connectionString: url });
  try {
    runPrisma("migrate", "deploy");
  } catch (error) {
    await pool.end();
    await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin.end();
    await container?.stop();
    throw error;
  }
  return {
    url,
    pool,
    runPrisma,
    seed: () =>
      execFileSync(process.execPath, [join(root, "prisma/seed.js")], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: url },
        stdio: "pipe",
      }),
    stop: () => admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`),
    async close() {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
      await container?.stop();
    },
  };
}
