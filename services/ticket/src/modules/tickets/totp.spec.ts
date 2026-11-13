import { totp, verifyTotp } from "./totp";

describe("RFC 6238 Appendix B", () => {
  const vectors = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ] as const;
  const keys = {
    sha1: Buffer.from("12345678901234567890"),
    sha256: Buffer.from("12345678901234567890123456789012"),
    sha512: Buffer.from("1234567890123456789012345678901234567890123456789012345678901234"),
  };
  it.each(vectors)("matches all algorithms at time %s", (seconds, sha1, sha256, sha512) => {
    expect(totp(keys.sha1, seconds, "sha1", 8)).toBe(sha1);
    expect(totp(keys.sha256, seconds, "sha256", 8)).toBe(sha256);
    expect(totp(keys.sha512, seconds, "sha512", 8)).toBe(sha512);
  });
  it("accepts only the configured adjacent steps and preserves leading zeros", () => {
    const seconds = 1111111110;
    expect(totp(keys.sha1, 1111111109)).toBe("081804");
    for (const delta of [-30, 0, 30])
      expect(verifyTotp(keys.sha1, totp(keys.sha1, seconds + delta), seconds)).toBe(true);
    for (const delta of [-60, 60])
      expect(verifyTotp(keys.sha1, totp(keys.sha1, seconds + delta), seconds)).toBe(false);
    expect(totp(keys.sha1, 59)).not.toBe(totp(keys.sha1, 60));
    expect(verifyTotp(keys.sha1, "12345", seconds)).toBe(false);
    expect(verifyTotp(keys.sha1, "abcdef", seconds)).toBe(false);
    expect(verifyTotp(keys.sha1, totp(keys.sha1, 0), 0)).toBe(true);
  });
  it("rejects invalid time and empty secrets", () => {
    for (const seconds of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => totp(keys.sha1, seconds)).toThrow();
    expect(() => totp(Buffer.alloc(0), 59)).toThrow();
  });
});
