import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";

const execFileAsync = promisify(execFile);

export async function startBookingDb() {
  const container = await new PostgreSqlContainer("postgres:16")
    .withUsername("booking_bootstrap")
    .withPassword("bootstrap_test")
    .withDatabase("booking_db")
    .withCopyContentToContainer([
      {
        content: `CREATE ROLE booking_user LOGIN PASSWORD 'booking_test' NOSUPERUSER NOCREATEDB;
ALTER DATABASE booking_db OWNER TO booking_user;
GRANT ALL ON SCHEMA public TO booking_user;`,
        target: "/docker-entrypoint-initdb.d/booking.sql",
      },
    ])
    .start();
  const url = new URL(container.getConnectionUri());
  url.username = "booking_user";
  url.password = "booking_test";
  const pool = new Pool({ connectionString: url.toString(), max: 10 });
  const close = async () => {
    await pool.end();
    await container.stop();
  };
  try {
    const before = await pool.query<{ count: string }>(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
    );
    if (before.rows[0].count !== "0") throw new Error("Expected an empty booking database");
    const migration = await execFileAsync(
      process.execPath,
      [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
      {
        cwd: join(__dirname, "../.."),
        env: { ...process.env, DATABASE_URL: url.toString() },
        timeout: 60000,
      },
    );
    return { pool, close, migrationOutput: migration.stdout };
  } catch (error) {
    await close();
    throw error;
  }
}

export type BookingDb = Awaited<ReturnType<typeof startBookingDb>>;
