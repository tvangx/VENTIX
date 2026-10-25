import { argon2id, hash } from "argon2";
import { PrismaClient } from "../../../generated/client";

/** Không reset password hoặc trạng thái khi chạy lại bootstrap. */
export async function seedAdmin(prisma: PrismaClient, email: string, password: string) {
  const passwordHash = await hash(password, {
    type: argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email },
      create: { email, passwordHash },
      update: {},
    });
    if (user.status !== "ACTIVE") throw new Error("Cannot bootstrap a suspended account");
    const role = await tx.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
    await tx.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
    return user.id;
  });
}
