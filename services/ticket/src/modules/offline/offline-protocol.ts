import { createHmac, timingSafeEqual } from "node:crypto";
import { OfflineBatchInput, OfflineDeviceView, OfflineScan } from "./offline.dto";

export function offlineScanPayload(scan: OfflineScan): unknown[] {
  return [
    scan.scan_id.toLowerCase(),
    scan.ticket_id.toLowerCase(),
    scan.secret_version,
    scan.token,
    new Date(scan.scanned_at).toISOString(),
  ];
}

export function offlineSigningPayload(batch: OfflineBatchInput): Buffer {
  return Buffer.from(
    JSON.stringify([
      "ticket-offline-sync-v1",
      batch.batch_id.toLowerCase(),
      batch.device_id.toLowerCase(),
      batch.event_id.toLowerCase(),
      batch.gate_id.toLowerCase(),
      batch.package_id.toLowerCase(),
      batch.scans.map(offlineScanPayload),
    ]),
  );
}

export function signOfflineBatch(key: Buffer, batch: OfflineBatchInput): string {
  if (key.length !== 32) throw new Error("INVALID_OFFLINE_HMAC_KEY");
  return createHmac("sha256", key).update(offlineSigningPayload(batch)).digest("base64");
}

export function verifyOfflineSignature(key: Buffer, batch: OfflineBatchInput): boolean {
  const signature = Buffer.from(batch.signature, "base64");
  if (signature.length !== 32 || signature.toString("base64") !== batch.signature) return false;
  return timingSafeEqual(signature, Buffer.from(signOfflineBatch(key, batch), "base64"));
}

export function offlineKeyLabel(
  device: Pick<
    OfflineDeviceView,
    "device_id" | "package_id" | "event_id" | "gate_id" | "issued_at" | "expires_at"
  >,
  staffId: string,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      "ticket-offline-device-v1",
      device.device_id,
      staffId,
      device.event_id,
      device.gate_id,
      device.package_id,
      device.issued_at,
      device.expires_at,
    ]),
  );
}
