import { randomBytes } from "node:crypto";
import { PrismaService } from "../../src/db/prisma.service";
import { KycCrypto } from "../../src/modules/kyc/kyc-crypto";
import { rotateKycKeys } from "../../src/tools/rotate-kyc-keys";
import { kycFixture } from "../helpers/kyc";

describe("S-504 KYC key rotation", () => {
  let context: Awaited<ReturnType<typeof kycFixture>>;

  beforeAll(async () => {
    context = await kycFixture();
  });

  afterAll(async () => {
    await context?.close();
  });

  it("retains readable identity data and the HMAC after rotation, including retries", async () => {
    const db = context.app.get(PrismaService);
    const { id } = await context.user();
    const number = "001099000101";
    const name = "Synthetic Test Person";
    const oldNumber = context.crypto.encrypt(id, "id_number", number);
    const oldName = context.crypto.encrypt(id, "full_name", name);
    const before = await db.kycProfile.create({
      data: {
        userId: id,
        idNumberEnc: oldNumber.ciphertext,
        idNumberHmac: context.crypto.hash(number),
        fullNameEnc: oldName.ciphertext,
        keyId: oldNumber.keyId,
        verifiedAt: new Date(),
      },
    });
    const next = randomBytes(32).toString("base64");
    const pepper = context.env.KYC_HMAC_PEPPER!;
    const nextOnly = new KycCrypto({ next }, "next", pepper);
    const crypto = new KycCrypto({ ...context.env.KYC_ENCRYPTION_KEYS, next }, "next", pepper);
    const profile = () => db.kycProfile.findUniqueOrThrow({ where: { userId: id } });

    await expect(rotateKycKeys(db, nextOnly, "next", true)).rejects.toThrow("KYC_KEY_UNAVAILABLE");
    expect(await rotateKycKeys(db, crypto, "next", false)).toEqual({
      checked: 1,
      rotated: 0,
      conflicts: 0,
    });
    expect(await profile()).toEqual(before);
    expect(await rotateKycKeys(db, crypto, "next", true)).toEqual({
      checked: 1,
      rotated: 1,
      conflicts: 0,
    });
    const after = await profile();
    expect(after.keyId).toBe("next");
    expect(after.idNumberHmac).toBe(before.idNumberHmac);
    expect(after.verifiedAt).toEqual(before.verifiedAt);
    expect(after.version).toBe(before.version + 1);
    expect(
      nextOnly.decrypt(id, "id_number", { keyId: after.keyId, ciphertext: after.idNumberEnc }),
    ).toBe(number);
    expect(
      nextOnly.decrypt(id, "full_name", { keyId: after.keyId, ciphertext: after.fullNameEnc }),
    ).toBe(name);
    expect(await rotateKycKeys(db, nextOnly, "next", true)).toEqual({
      checked: 0,
      rotated: 0,
      conflicts: 0,
    });
  });
});
