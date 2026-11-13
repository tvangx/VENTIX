import { randomUUID, webcrypto } from "node:crypto";
import request from "supertest";
import { fixture } from "./ticket";
import { scanFixture } from "./checkin";
import { devicePair, devicePublicKey } from "./gates";
import {
  OfflineBatchInput,
  OfflineDeviceView,
  OfflineScan,
} from "../../src/modules/offline/offline.dto";
import { offlineKeyLabel, signOfflineBatch } from "../../src/modules/offline/offline-protocol";

export async function unwrapOfflineKey(view: OfflineDeviceView, staffId: string): Promise<Buffer> {
  const label = offlineKeyLabel(view, staffId);
  expect(Buffer.from(view.oaep_label, "base64")).toEqual(label);
  const privateKey = await webcrypto.subtle.importKey(
    "pkcs8",
    devicePair.privateKey.export({ type: "pkcs8", format: "der" }),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
  return Buffer.from(
    await webcrypto.subtle.decrypt(
      { name: "RSA-OAEP", label },
      privateKey,
      Buffer.from(view.encrypted_key, "base64"),
    ),
  );
}

export async function offlineFixture(
  context: Awaited<ReturnType<typeof fixture>>,
  existing?: Awaited<ReturnType<typeof scanFixture>>,
) {
  const setup = existing ?? (await scanFixture(context));
  const verificationPackage = (await setup.download().expect(201)).body as {
    package_id: string;
    issued_at: string;
    expires_at: string;
  };
  const registration = {
    gate_id: setup.gate.id,
    package_id: verificationPackage.package_id,
    public_key_pem: devicePublicKey,
  };
  const register = (
    key = randomUUID(),
    body: Record<string, unknown> = registration,
    token = setup.staffToken,
  ) =>
    request(setup.server)
      .post("/v1/offline-devices")
      .auth(token, { type: "bearer" })
      .set("Idempotency-Key", key)
      .send(body);
  const registrationKey = randomUUID();
  const device = (await register(registrationKey).expect(201)).body as OfflineDeviceView;
  const clockOffset = Date.parse(device.server_time) - Date.now();
  const signingKey = await unwrapOfflineKey(device, setup.staffId);
  const makeBatch = async (scans?: OfflineScan[]): Promise<OfflineBatchInput> => {
    const input = await setup.input();
    const batch: OfflineBatchInput = {
      batch_id: randomUUID(),
      device_id: device.device_id,
      package_id: device.package_id,
      event_id: device.event_id,
      gate_id: device.gate_id,
      scans: scans ?? [
        {
          scan_id: randomUUID(),
          ticket_id: input.qr.ticket_id,
          secret_version: input.qr.secret_version,
          token: input.qr.token,
          scanned_at: new Date(Date.now() + clockOffset).toISOString(),
        },
      ],
      signature: "",
    };
    batch.signature = signOfflineBatch(signingKey, batch);
    return batch;
  };
  const signed = (batch: OfflineBatchInput): OfflineBatchInput => ({
    ...batch,
    signature: signOfflineBatch(signingKey, batch),
  });
  const sync = (batch: OfflineBatchInput, token = setup.staffToken, key = batch.batch_id) =>
    request(setup.server)
      .post("/v1/offline-sync")
      .auth(token, { type: "bearer" })
      .set("Idempotency-Key", key)
      .send(batch);
  const delta = (query = "", token = setup.staffToken) =>
    request(setup.server)
      .get(`/v1/offline-devices/${device.device_id}/revocations${query}`)
      .auth(token, { type: "bearer" });
  return {
    ...setup,
    device,
    signingKey,
    verificationPackage,
    registration,
    registrationKey,
    register,
    makeBatch,
    signed,
    sync,
    delta,
  };
}
