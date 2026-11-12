import {
  constants,
  createCipheriv,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { ProblemException } from "@ticketing/common";

export interface PackageMetadata {
  package_id: string;
  event_id: string;
  gate_id: string;
  issued_at: string;
  expires_at: string;
}

export function packageKey(pem: string) {
  try {
    if (!pem.startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error("SPKI_PUBLIC_KEY_REQUIRED");
    const key = createPublicKey(pem);
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (key.asymmetricKeyType !== "rsa" || bits < 2048 || bits > 4096)
      throw new Error("INVALID_RSA_KEY");
    return key;
  } catch {
    throw new ProblemException("INVALID_PACKAGE_KEY", 400, "RSA public key must be 2048–4096 bits");
  }
}

export function encryptPackage(metadata: PackageMetadata, plaintext: Buffer, publicKeyPem: string) {
  const publicKey = packageKey(publicKeyPem);
  const key = randomBytes(32);
  try {
    const nonce = randomBytes(12);
    const aad = Buffer.from(
      JSON.stringify([
        "ticket-verification-v1",
        metadata.package_id,
        metadata.event_id,
        metadata.gate_id,
        metadata.issued_at,
        metadata.expires_at,
      ]),
    );
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return {
      ...metadata,
      format: "ticket-verification-v1" as const,
      algorithm: "RSA-OAEP-256+A256GCM" as const,
      encrypted_key: publicEncrypt(
        { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
        key,
      ).toString("base64"),
      nonce: nonce.toString("base64"),
      aad: aad.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  } finally {
    key.fill(0);
  }
}
