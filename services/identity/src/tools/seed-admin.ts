import "dotenv/config";
import { loadEnv } from "@ticketing/common";
import { PrismaClient } from "../../generated/client";
import { envSchema } from "../config/env.schema";
import { seedAdmin } from "../modules/access/admin-seed";

async function main() {
  const env = loadEnv(envSchema);
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD)
    throw new Error("Configure ADMIN_EMAIL and ADMIN_PASSWORD before seeding Admin");
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    await seedAdmin(prisma, env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
    process.stdout.write("Admin role seeded; existing password preserved.\n");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(() => {
  process.stderr.write(
    "Admin seed failed. Check required environment variables, roles and database.\n",
  );
  process.exitCode = 1;
});
