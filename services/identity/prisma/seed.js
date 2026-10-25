require("dotenv/config");
const { PrismaClient } = require("../generated/client");

const ROLES = ["USER", "ORGANIZER", "STAFF", "ADMIN"];

async function seedRoles(prisma) {
  await prisma.$transaction(
    ROLES.map((code, index) =>
      prisma.role.upsert({ where: { code }, create: { id: index + 1, code }, update: {} }),
    ),
  );
}

module.exports = { seedRoles };

if (require.main === module) {
  const prisma = new PrismaClient();
  seedRoles(prisma)
    .catch(() => {
      process.stderr.write("Role seed failed; check database connectivity and migrations.\n");
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
