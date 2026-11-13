import { randomBytes, randomUUID } from "node:crypto";
import { KycCrypto } from "./kyc-crypto";

describe("S-305 KYC encryption and lookup", () => {
  const keys = {
    first: randomBytes(32).toString("base64"),
    second: randomBytes(32).toString("base64"),
  };
  const pepper = randomBytes(32).toString("base64");
  const cipher = new KycCrypto(keys, "first", pepper);
  const userId = randomUUID();
  const identityNumber = "001099000001";

  it("produces a stable secret-keyed identity hash", () => {
    expect(cipher.hash(identityNumber)).toMatch(/^[a-f0-9]{64}$/);
    expect(cipher.hash(identityNumber)).toBe(cipher.hash(identityNumber));
    expect(cipher.hash(identityNumber)).not.toBe(
      new KycCrypto(keys, "first", randomBytes(32).toString("base64")).hash(identityNumber),
    );
    expect(cipher.hash(identityNumber)).not.toContain(identityNumber);
  });
  it("authenticates user, field and key, and uses fresh nonces", () => {
    const encrypted = cipher.encrypt(userId, "id_number", identityNumber);
    expect(cipher.decrypt(userId, "id_number", encrypted)).toBe(identityNumber);
    expect(cipher.encrypt(userId, "id_number", identityNumber).ciphertext).not.toEqual(
      encrypted.ciphertext,
    );
    expect(() => cipher.decrypt(randomUUID(), "id_number", encrypted)).toThrow();
    expect(() => cipher.decrypt(userId, "full_name", encrypted)).toThrow();
    expect(() => cipher.decrypt(userId, "id_number", { ...encrypted, keyId: "second" })).toThrow();
    const corrupted = Buffer.from(encrypted.ciphertext);
    corrupted[corrupted.length - 1] ^= 1;
    expect(() =>
      cipher.decrypt(userId, "id_number", { ...encrypted, ciphertext: corrupted }),
    ).toThrow();
  });
  it("reads previous key data after selecting a new active key", () => {
    const encrypted = cipher.encrypt(userId, "full_name", "Synthetic Test Person");
    const rotated = new KycCrypto(keys, "second", pepper);
    expect(rotated.decrypt(userId, "full_name", encrypted)).toBe("Synthetic Test Person");
    expect(rotated.hash(identityNumber)).toBe(cipher.hash(identityNumber));
    expect(rotated.encrypt(userId, "full_name", "Synthetic Test Person").keyId).toBe("second");
  });
});
