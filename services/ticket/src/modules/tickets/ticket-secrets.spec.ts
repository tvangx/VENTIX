import { randomBytes, randomUUID } from "node:crypto";
import { TicketSecrets } from "./ticket-secrets";

describe("ticket secret encryption", () => {
  const firstKey = randomBytes(32).toString("base64");
  const secondKey = randomBytes(32).toString("base64");
  const ticketId = randomUUID();
  const secret = randomBytes(20);
  const cipher = new TicketSecrets({ first: firstKey, second: secondKey }, "first");

  it("encrypts with a fresh nonce and authenticates ticket/version/key context", () => {
    const encrypted = cipher.encrypt(ticketId, 1, secret);
    expect(encrypted.keyId).toBe("first");
    expect(encrypted.ciphertext.includes(secret)).toBe(false);
    expect(cipher.decrypt(ticketId, 1, encrypted)).toEqual(secret);
    expect(cipher.encrypt(ticketId, 1, secret).ciphertext).not.toEqual(encrypted.ciphertext);
    expect(() => cipher.decrypt(randomUUID(), 1, encrypted)).toThrow();
    expect(() => cipher.decrypt(ticketId, 2, encrypted)).toThrow();
    expect(() => cipher.decrypt(ticketId, 1, { ...encrypted, keyId: "second" })).toThrow();
  });

  it("rejects tampering, truncation and unavailable key ids", () => {
    const encrypted = cipher.encrypt(ticketId, 1, secret);
    const tampered = Buffer.from(encrypted.ciphertext);
    tampered[tampered.length - 1] ^= 1;
    expect(() => cipher.decrypt(ticketId, 1, { ...encrypted, ciphertext: tampered })).toThrow();
    expect(() =>
      cipher.decrypt(ticketId, 1, { ...encrypted, ciphertext: Buffer.alloc(5) }),
    ).toThrow();
    expect(() => cipher.decrypt(ticketId, 1, { ...encrypted, keyId: "missing" })).toThrow();
  });

  it("reads old ciphertext after switching the active key", () => {
    const encrypted = cipher.encrypt(ticketId, 1, secret);
    const rotated = new TicketSecrets({ first: firstKey, second: secondKey }, "second");
    expect(rotated.decrypt(ticketId, 1, encrypted)).toEqual(secret);
    expect(rotated.encrypt(ticketId, 1, secret).keyId).toBe("second");
  });
});
