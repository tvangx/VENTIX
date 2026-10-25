import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { PrismaService } from "../../db/prisma.service";
import { tokenHash } from "./auth.repository";
import type { GoogleIdentity } from "./google.provider";

@Injectable()
export class GoogleRepository {
  constructor(private readonly prisma: PrismaService) {}
  createState(state: string, cookie: string, linkUserId?: string) {
    return this.prisma.googleOauthState.create({
      data: {
        stateHash: tokenHash(state),
        cookieHash: tokenHash(cookie),
        linkUserId,
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
  }
  async consumeState(state: string, cookie: string) {
    const where = {
      stateHash: tokenHash(state),
      cookieHash: tokenHash(cookie),
      usedAt: null,
      expiresAt: { gt: new Date() },
    };
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.googleOauthState.updateMany({
        where,
        data: { usedAt: new Date() },
      });
      return count === 1
        ? tx.googleOauthState.findUnique({ where: { stateHash: where.stateHash } })
        : null;
    });
  }
  async resolve(profile: GoogleIdentity, linkUserId?: string | null) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"google:" + profile.sub},0))::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"email:" + profile.email},0))::text`;
      const account = await tx.oauthAccount.findUnique({
        where: { provider_providerUid: { provider: "google", providerUid: profile.sub } },
        include: { user: true },
      });
      if (account) {
        if ((linkUserId && account.userId !== linkUserId) || account.user.status !== "ACTIVE")
          throw new ProblemException(
            "GOOGLE_ACCOUNT_UNAVAILABLE",
            409,
            "Tài khoản Google không khả dụng",
          );
        return account.userId;
      }
      const existing = await tx.user.findUnique({ where: { email: profile.email } });
      if (linkUserId) {
        if (existing?.id !== linkUserId || existing.status !== "ACTIVE")
          throw new ProblemException(
            "GOOGLE_LINK_MISMATCH",
            409,
            "Email Google phải trùng tài khoản đang liên kết",
          );
        await tx.oauthAccount.create({
          data: { userId: existing.id, provider: "google", providerUid: profile.sub },
        });
        await tx.user.update({
          where: { id: existing.id },
          data: { emailVerifiedAt: new Date(), version: { increment: 1 } },
        });
        return existing.id;
      }
      if (existing)
        throw new ProblemException(
          "ACCOUNT_LINK_REQUIRED",
          409,
          "Hãy đăng nhập bằng email rồi liên kết Google",
        );
      const user = await tx.user.create({
        data: {
          email: profile.email,
          emailVerifiedAt: new Date(),
          oauthAccounts: { create: { provider: "google", providerUid: profile.sub } },
          userRoles: { create: { role: { connect: { code: "USER" } } } },
        },
      });
      return user.id;
    });
  }
}
