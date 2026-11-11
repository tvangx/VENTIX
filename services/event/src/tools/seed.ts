import "dotenv/config";
import { loadEnv } from "@ticketing/common";
import { z } from "zod";
import { PrismaService } from "../db/prisma.service";
import { seedEvents } from "./seed-events";

async function main() {
  const env = loadEnv(z.object({ DATABASE_URL: z.string().url() }));
  const db = new PrismaService(env);
  try {
    const created = await seedEvents(db);
    process.stdout.write(`Created ${created} sample events. Existing fixtures were preserved.\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  process.stderr.write("Event seed failed. Check the Event database connection and migrations.\n");
  process.exitCode = 1;
});
