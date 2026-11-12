import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  keyId: string;
  ciphertext: Buffer;
}

export class TicketSecrets {
  constructor(
    private readonly keys: Record<string, string>,
    private readonly activeKeyId: string,
    private readonly purpose = "ticket-secret-v1",
  ) {}

  private key(keyId: string): Buffer {
    const encoded = Object.hasOwn(this.keys, keyId) ? this.keys[keyId] : undefined;
    if (!encoded) throw new Error("TICKET_KEY_UNAVAILABLE");
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) throw new Error("TICKET_KEY_INVALID");
    return key;
  }

  private context(ticketId: string, version: number, keyId: string): Buffer {
    return Buffer.from(JSON.stringify([this.purpose, ticketId, version, keyId]));
  }

  encrypt(ticketId: string, version: number, secret: Buffer): EncryptedSecret {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(this.activeKeyId), nonce);
    cipher.setAAD(this.context(ticketId, version, this.activeKeyId));
    const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
    return {
      keyId: this.activeKeyId,
      ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]),
    };
  }

  decrypt(ticketId: string, version: number, encrypted: EncryptedSecret): Buffer {
    if (encrypted.ciphertext.length < 29) throw new Error("TICKET_CIPHERTEXT_INVALID");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(encrypted.keyId),
      encrypted.ciphertext.subarray(0, 12),
    );
    decipher.setAAD(this.context(ticketId, version, encrypted.keyId));
    decipher.setAuthTag(encrypted.ciphertext.subarray(12, 28));
    return Buffer.concat([decipher.update(encrypted.ciphertext.subarray(28)), decipher.final()]);
  }
}
