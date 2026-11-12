import { createHmac, timingSafeEqual } from "node:crypto";

export function totp(
  secret: Buffer,
  seconds: number,
  algorithm: "sha1" | "sha256" | "sha512" = "sha1",
  digits: 6 | 8 = 6,
): string {
  if (!Number.isSafeInteger(seconds) || seconds < 0 || secret.length === 0)
    throw new Error("INVALID_TOTP_INPUT");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds / 30)));
  const digest = createHmac(algorithm, secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function verifyTotp(secret: Buffer, token: string, seconds: number): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  let matched = false;
  for (const delta of [-30, 0, 30]) {
    if (seconds + delta < 0) continue;
    matched =
      timingSafeEqual(Buffer.from(totp(secret, seconds + delta)), Buffer.from(token)) || matched;
  }
  return matched;
}
