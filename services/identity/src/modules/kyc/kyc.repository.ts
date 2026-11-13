import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { Prisma } from "../../../generated/client";
import { PrismaService } from "../../db/prisma.service";
import { KycCrypto } from "./kyc-crypto";
import { KycStatus } from "./kyc.dto";

@Injectable()
export class KycRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: KycCrypto,
  ) {}

  async recipient(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { kycProfile: true },
    });
    if (!user || user.status !== "ACTIVE")
      throw new ProblemException("UNAUTHORIZED", 401, "Tài khoản không hoạt động");
    return user;
  }

  async status(userId: string): Promise<KycStatus> {
    const user = await this.recipient(userId);
    return {
      verified: Boolean(user.kycProfile?.verifiedAt),
      kycHash: user.kycProfile?.verifiedAt ? user.kycProfile.idNumberHmac : null,
    };
  }

  async finalize(
    tx: Prisma.TransactionClient,
    userId: string,
    email: string,
    identityNumber: string,
    name: string,
  ): Promise<{ hash: string; changed: boolean }> {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE" || user.email !== email)
      throw new ProblemException(
        "KYC_ACCOUNT_CHANGED",
        409,
        "Tài khoản đã thay đổi, hãy yêu cầu mã mới",
      );
    const hash = this.crypto.hash(identityNumber);
    const profile = await tx.kycProfile.findUnique({ where: { userId } });
    if (profile?.verifiedAt) {
      if (profile.idNumberHmac !== hash)
        throw new ProblemException(
          "KYC_IDENTITY_IMMUTABLE",
          409,
          "Thông tin định danh đã được xác minh",
        );
      return { hash, changed: false };
    }
    const identity = this.crypto.encrypt(userId, "id_number", identityNumber);
    const fullName = this.crypto.encrypt(userId, "full_name", name);
    const data = {
      idNumberEnc: identity.ciphertext,
      idNumberHmac: hash,
      fullNameEnc: fullName.ciphertext,
      keyId: identity.keyId,
      verifiedAt: new Date(),
      version: { increment: 1 },
    };
    if (profile) {
      const result = await tx.kycProfile.updateMany({
        where: { userId, verifiedAt: null, version: profile.version },
        data,
      });
      if (result.count !== 1)
        throw new ProblemException("KYC_VERSION_CONFLICT", 409, "Hồ sơ đã thay đổi");
    } else {
      await tx.kycProfile.create({ data: { ...data, userId, version: 1 } });
    }
    if (!user.emailVerifiedAt)
      await tx.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date(), version: { increment: 1 } },
      });
    return { hash, changed: true };
  }
}
