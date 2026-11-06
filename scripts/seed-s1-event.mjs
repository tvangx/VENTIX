/* global process */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
const bookingRequire = createRequire(new URL("../services/booking/package.json", import.meta.url));
const { Pool } = bookingRequire("pg");
const { z } = bookingRequire("zod");

async function main() {
  const env = z
    .object({
      DATABASE_URL: z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            ["postgres:", "postgresql:"].includes(url.protocol) &&
            url.username === "booking_user" &&
            url.pathname === "/booking_db" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          );
        }, "Use local booking_user / booking_db only"),
    })
    .parse(process.env);
  const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  const event = randomUUID();
  try {
    // Fixture local T-205, tương tự test T-202; không giả lập producer nghiệp vụ.
    // Không sửa snapshot hiện có hoặc quyết định pricing_ready của consumer thật.
    await pool.query(
      `INSERT INTO event_snapshots
      (event_id, organizer_id, status, event_version, seat_map_version, pricing_ready, ticket_classes, sale_window)
      VALUES ($1,$2,'APPROVED',1,1,true,'[]',$3)`,
      [
        event,
        randomUUID(),
        JSON.stringify({
          starts_at: new Date(Date.now() - 60000).toISOString(),
          ends_at: new Date(Date.now() + 86400000).toISOString(),
        }),
      ],
    );
    process.stdout.write(`${JSON.stringify({ event_id: event, synthetic: true })}\n`);
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  process.stderr.write(
    "S1 fixture failed: check local booking_user / booking_db configuration and migrations.\n",
  );
  process.exitCode = 1;
});
