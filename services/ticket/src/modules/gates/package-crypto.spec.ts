import { generateKeyPairSync, webcrypto } from "node:crypto";
import { encryptPackage, packageKey } from "./package-crypto";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const metadata = {
  package_id: "package",
  event_id: "event",
  gate_id: "gate",
  issued_at: "issued",
  expires_at: "expires",
};

describe("verification package encryption", () => {
  it("decrypts through browser-compatible WebCrypto and rejects modified AAD/ciphertext", async () => {
    const result = encryptPackage(metadata, Buffer.from('{"tickets":[]}'), publicPem);
    const privateKey = await webcrypto.subtle.importKey(
      "pkcs8",
      pair.privateKey.export({ type: "pkcs8", format: "der" }),
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["decrypt"],
    );
    const raw = await webcrypto.subtle.decrypt(
      "RSA-OAEP",
      privateKey,
      Buffer.from(result.encrypted_key, "base64"),
    );
    const key = await webcrypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const params = {
      name: "AES-GCM",
      iv: Buffer.from(result.nonce, "base64"),
      additionalData: Buffer.from(result.aad, "base64"),
      tagLength: 128,
    };
    const plaintext = await webcrypto.subtle.decrypt(
      params,
      key,
      Buffer.from(result.ciphertext, "base64"),
    );
    expect(Buffer.from(plaintext).toString()).toBe('{"tickets":[]}');
    await expect(
      webcrypto.subtle.decrypt(
        { ...params, additionalData: Buffer.from("other-gate") },
        key,
        Buffer.from(result.ciphertext, "base64"),
      ),
    ).rejects.toThrow();
    const tampered = Buffer.from(result.ciphertext, "base64");
    tampered[0] ^= 1;
    await expect(webcrypto.subtle.decrypt(params, key, tampered)).rejects.toThrow();
    expect(JSON.parse(Buffer.from(result.aad, "base64").toString())).toEqual([
      "ticket-verification-v1",
      ...Object.values(metadata),
    ]);
  });

  it("rejects malformed, non-RSA and weak keys", () => {
    expect(() => packageKey("invalid")).toThrow();
    const weak = generateKeyPairSync("rsa", { modulusLength: 1024 });
    expect(() =>
      packageKey(weak.publicKey.export({ type: "spki", format: "pem" }).toString()),
    ).toThrow();
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    expect(() =>
      packageKey(ec.publicKey.export({ type: "spki", format: "pem" }).toString()),
    ).toThrow();
  });
});
