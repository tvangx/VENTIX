import { webcrypto } from "node:crypto";
import { OfflineBatchInput } from "./offline.dto";
import {
  offlineSigningPayload,
  signOfflineBatch,
  verifyOfflineSignature,
} from "./offline-protocol";

const id = "00000000-0000-4000-8000-000000000001";
const batch: OfflineBatchInput = {
  batch_id: id,
  device_id: id,
  event_id: id,
  gate_id: id,
  package_id: id,
  signature: "",
  scans: [
    {
      scan_id: id,
      ticket_id: id,
      secret_version: 1,
      token: "123456",
      scanned_at: "2026-11-12T00:00:00.000Z",
    },
  ],
};
const key = Buffer.alloc(32, 7);

describe("offline HMAC wire protocol", () => {
  it("matches WebCrypto HMAC-SHA256 and keeps signature outside the signed payload", async () => {
    const imported = await webcrypto.subtle.importKey(
      "raw",
      key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = Buffer.from(
      await webcrypto.subtle.sign("HMAC", imported, offlineSigningPayload(batch)),
    ).toString("base64");
    expect(signOfflineBatch(key, batch)).toBe(signature);
    expect(verifyOfflineSignature(key, { ...batch, signature })).toBe(true);
    expect(JSON.parse(offlineSigningPayload(batch).toString())).toEqual([
      "ticket-offline-sync-v1",
      id,
      id,
      id,
      id,
      id,
      [[id, id, 1, "123456", "2026-11-12T00:00:00.000Z"]],
    ]);
  });

  it("rejects tampering with every context field, scan content and array order", () => {
    const second = { ...batch.scans[0], scan_id: "00000000-0000-4000-8000-000000000002" };
    const signed = { ...batch, scans: [...batch.scans, second] };
    const signature = signOfflineBatch(key, signed);
    for (const field of ["batch_id", "device_id", "event_id", "gate_id", "package_id"] as const)
      expect(verifyOfflineSignature(key, { ...signed, [field]: second.scan_id, signature })).toBe(
        false,
      );
    expect(
      verifyOfflineSignature(key, { ...signed, scans: [second, ...batch.scans], signature }),
    ).toBe(false);
    for (const scan of [
      { ...second, ticket_id: second.scan_id },
      { ...second, secret_version: 2 },
      { ...second, token: "999999" },
      { ...second, scanned_at: "2026-11-12T00:00:01.000Z" },
    ])
      expect(
        verifyOfflineSignature(key, { ...signed, scans: [...batch.scans, scan], signature }),
      ).toBe(false);
    expect(verifyOfflineSignature(Buffer.alloc(32, 8), { ...signed, signature })).toBe(false);
  });

  it("rejects malformed/noncanonical signatures and invalid key sizes", () => {
    for (const signature of [
      "",
      "bad",
      " " + signOfflineBatch(key, batch),
      Buffer.alloc(31).toString("base64"),
    ])
      expect(verifyOfflineSignature(key, { ...batch, signature })).toBe(false);
    expect(() => signOfflineBatch(Buffer.alloc(20), batch)).toThrow("INVALID_OFFLINE_HMAC_KEY");
  });
});
