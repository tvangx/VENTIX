import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export interface EncryptedPii {
  keyId: string;
  ciphertext: Buffer;
}

export class KycCrypto {
  constructor(
    private readonly keys: Record<string, string>,
    private readonly activeKeyId: string,
    private readonly pepper: string,
  ) {}

  hash(identityNumber: string): string {
    return this.mac("identity-number-v1", identityNumber);
  }

  mac(purpose: string, value: string): string {
    const key = Buffer.from(this.pepper, "base64");
    if (key.length !== 32) throw new Error("KYC_PEPPER_UNAVAILABLE");
    return createHmac("sha256", key)
      .update(JSON.stringify([purpose, value]))
      .digest("hex");
  }

  private key(keyId: string): Buffer {
    const value = Object.hasOwn(this.keys, keyId) ? this.keys[keyId] : undefined;
    if (!value) throw new Error("KYC_KEY_UNAVAILABLE");
    const key = Buffer.from(value, "base64");
    if (key.length !== 32) throw new Error("KYC_KEY_INVALID");
    return key;
  }

  encrypt(userId: string, field: string, plaintext: string): EncryptedPii {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(this.activeKeyId), nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(["kyc-v1", userId, field, this.activeKeyId])));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      keyId: this.activeKeyId,
      ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]),
    };
  }

  decrypt(userId: string, field: string, value: EncryptedPii): string {
    if (value.ciphertext.length < 29) throw new Error("KYC_CIPHERTEXT_INVALID");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(value.keyId),
      value.ciphertext.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(JSON.stringify(["kyc-v1", userId, field, value.keyId])));
    decipher.setAuthTag(value.ciphertext.subarray(12, 28));
    return Buffer.concat([
      decipher.update(value.ciphertext.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  }
}
