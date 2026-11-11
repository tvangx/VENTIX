import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";

/** TEST_DATABASE_URL chỉ trỏ tới PostgreSQL kiểm thử, event_user có CREATEDB. */
export async function testDatabase({ migrate = true } = {}) {
  const external = process.env.TEST_DATABASE_URL;
  const container = external ? undefined : await new PostgreSqlContainer("postgres:16").start();
  const adminUrl = external ?? container!.getConnectionUri();
  const name = `event_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: adminUrl });
  await admin.query(`CREATE DATABASE "${name}"`);
  const uri = new URL(adminUrl);
  uri.pathname = `/${name}`;
  const url = uri.toString();
  const pool = new Pool({ connectionString: url });
  try {
    if (migrate) {
      execFileSync(
        process.execPath,
        [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
        {
          cwd: join(__dirname, "../.."),
          env: { ...process.env, DATABASE_URL: url },
          stdio: "pipe",
        },
      );
    }
  } catch (error) {
    await pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
    await container?.stop();
    throw error;
  }
  return {
    url,
    pool,
    stop: () => admin.query(`DROP DATABASE "${name}" WITH (FORCE)`),
    async close() {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
      await container?.stop();
    },
  };
}
