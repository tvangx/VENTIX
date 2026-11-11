import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/client";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../db/prisma.service";

export const tokenHash = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

@Injectable()
export class AuthRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}
  byEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async newRefresh(tx: Prisma.TransactionClient, userId: string, familyId: string = randomUUID()) {
    const raw = randomBytes(32).toString("hex");
    await tx.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: tokenHash(raw),
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });
    return raw;
  }
  async session(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.status !== "ACTIVE") return null;
      return {
        userId,
        raw: await this.newRefresh(tx, userId),
        roles: await this.globalRoles(tx, userId),
      };
    });
  }
  private async globalRoles(tx: Prisma.TransactionClient, userId: string) {
    const rows = await tx.userRole.findMany({
      where: { userId, organizerId: null },
      include: { role: true },
    });
    return rows.map((row) => row.role.code);
  }

  async rotate(raw: string) {
    const hash = tokenHash(raw);
    const original = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!original) return null;
    return this.prisma.$transaction(async (tx) => {
      // Khóa cả family để replay đồng thời cũng thu hồi token mới sinh của request thắng.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${original.familyId}, 0))::text`;
      const token = await tx.refreshToken.findUniqueOrThrow({
        where: { id: original.id },
        include: { user: true },
      });
      if (token.revokedAt || token.expiresAt <= new Date() || token.user.status !== "ACTIVE") {
        await tx.refreshToken.updateMany({
          where: { familyId: token.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        // Trả null để COMMIT thu hồi; ném 401 bên ngoài transaction.
        return null;
      }
      await tx.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
      return {
        userId: token.userId,
        roles: await this.globalRoles(tx, token.userId),
        raw: await this.newRefresh(tx, token.userId, token.familyId),
      };
    });
  }

  async logout(raw: string) {
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: tokenHash(raw) },
    });
    if (!token) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${token.familyId}, 0))::text`;
      await tx.refreshToken.updateMany({
        where: { familyId: token.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}
