import { randomUUID, generateKeyPairSync, webcrypto } from "node:crypto";
import request from "supertest";
import { newMessage } from "@ticketing/event-contracts";
import { confirmedOrder, fixture } from "./ticket";
import { VerificationPackage } from "../../src/modules/gates/gate.dto";

export const devicePair = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const devicePublicKey = devicePair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

export async function decryptVerificationPackage(envelope: VerificationPackage) {
  const privateKey = await webcrypto.subtle.importKey(
    "pkcs8",
    devicePair.privateKey.export({ type: "pkcs8", format: "der" }),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
  const raw = await webcrypto.subtle.decrypt(
    "RSA-OAEP",
    privateKey,
    Buffer.from(envelope.encrypted_key, "base64"),
  );
  const key = await webcrypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const plaintext = await webcrypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: Buffer.from(envelope.nonce, "base64"),
      additionalData: Buffer.from(envelope.aad, "base64"),
      tagLength: 128,
    },
    key,
    Buffer.from(envelope.ciphertext, "base64"),
  );
  return JSON.parse(Buffer.from(plaintext).toString()) as {
    tickets: { ticket_id: string; secret: string; secret_version: number; status: string }[];
    gate_id: string;
    event_id: string;
    expires_at: string;
  };
}

export async function gateFixture(context: Awaited<ReturnType<typeof fixture>>) {
  const order = confirmedOrder();
  const organizerId = order.tenant_id!;
  const lifecycle = newMessage(
    "EventApproved",
    {
      event_id: order.data.event_id,
      organizer_id: organizerId,
      title: "Synthetic gate event",
      start_at: "2026-11-12T00:00:00.000Z",
      end_at: "2026-11-13T00:00:00.000Z",
      event_version: 1,
      ticket_classes: [],
      sale_phases: [],
    },
    { tenant_id: organizerId },
  );
  await context.deliver(lifecycle);
  await context.deliver(order);
  const staffId = randomUUID();
  const managerToken = await context.token(randomUUID(), ["ORGANIZER"], organizerId);
  const staffToken = await context.token(staffId, ["STAFF"], organizerId);
  const server = context.app.getHttpServer();
  const post = (
    path: string,
    body: Record<string, unknown>,
    key = randomUUID(),
    token = managerToken,
  ) =>
    request(server)
      .post(`/v1/gates${path}`)
      .auth(token, { type: "bearer" })
      .set("Idempotency-Key", key)
      .send(body);
  const gate = (await post("", { event_id: order.data.event_id, name: "North" }).expect(201))
    .body as { id: string; event_id: string; name: string };
  await post(`/${gate.id}/staff`, { staff_user_id: staffId }).expect(201);
  const rows = await context.repo.pool.query<{ id: string }>(
    "SELECT id FROM tickets WHERE order_id=$1 ORDER BY id",
    [order.data.order_id],
  );
  const ticketIds = rows.rows.map((row) => row.id);
  await post(`/${gate.id}/tickets`, { ticket_ids: ticketIds.slice(0, 2) }).expect(201);
  const download = (key = randomUUID(), token = staffToken) =>
    post(`/${gate.id}/verification-packages`, { public_key_pem: devicePublicKey }, key, token);
  return {
    order,
    organizerId,
    lifecycle,
    staffId,
    staffToken,
    managerToken,
    gate,
    ticketIds,
    server,
    post,
    download,
  };
}
