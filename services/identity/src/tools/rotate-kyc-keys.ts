import "dotenv/config";
import { loadEnv } from "@ticketing/common";
import { KycProfile, PrismaClient } from "../../generated/client";
import { envSchema } from "../config/env.schema";
import { KycCrypto } from "../modules/kyc/kyc-crypto";

export async function rotateKycKeys(
  db: PrismaClient,
  crypto: KycCrypto,
  activeKeyId: string,
  apply: boolean,
) {
  const result = { checked: 0, rotated: 0, conflicts: 0 };
  let cursor: string | undefined;
  for (;;) {
    const rows: Pick<KycProfile, "userId" | "keyId" | "idNumberEnc" | "fullNameEnc" | "version">[] =
      await db.kycProfile.findMany({
        where: {
          keyId: { not: activeKeyId },
          userId: cursor ? { gt: cursor } : undefined,
        },
        select: { userId: true, keyId: true, idNumberEnc: true, fullNameEnc: true, version: true },
        orderBy: { userId: "asc" },
        take: 100,
      });
    if (!rows.length) return result;

    for (const row of rows) {
      const identityNumber = crypto.decrypt(row.userId, "id_number", {
        keyId: row.keyId,
        ciphertext: row.idNumberEnc,
      });
      const name = crypto.decrypt(row.userId, "full_name", {
        keyId: row.keyId,
        ciphertext: row.fullNameEnc,
      });
      result.checked++;
      if (!apply) continue;

      const numberEnc = crypto.encrypt(row.userId, "id_number", identityNumber);
      const nameEnc = crypto.encrypt(row.userId, "full_name", name);
      const { count } = await db.kycProfile.updateMany({
        where: { userId: row.userId, keyId: row.keyId, version: row.version },
        data: {
          idNumberEnc: numberEnc.ciphertext,
          fullNameEnc: nameEnc.ciphertext,
          keyId: numberEnc.keyId,
          version: { increment: 1 },
        },
      });
      result.rotated += count;
      result.conflicts += 1 - count;
    }
    cursor = rows[rows.length - 1].userId;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args[0] === "--apply";
  if (args.length > 1 || (args.length === 1 && !apply)) {
    process.stderr.write("Usage: pnpm keys:rotate [--apply]\n");
    process.exitCode = 1;
    return;
  }
  const env = loadEnv(envSchema);
  const keys = env.KYC_ENCRYPTION_KEYS;
  const active = env.KYC_ACTIVE_KEY_ID;
  if (!keys || !active || !Object.hasOwn(keys, active)) throw new Error("KYC_KEY_UNAVAILABLE");

  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const crypto = new KycCrypto(keys, active, env.KYC_HMAC_PEPPER ?? "");
    const result = await rotateKycKeys(db, crypto, active, apply);
    process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "check", ...result })}\n`);
    if (result.conflicts) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  void main().catch(() => {
    process.stderr.write("KYC key rotation failed. Check key rings and the Identity database.\n");
    process.exitCode = 1;
  });
}
