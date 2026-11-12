import { randomUUID } from "node:crypto";
import request from "supertest";
import { fixture } from "./ticket";
import { gateFixture } from "./gates";
import { totp } from "../../src/modules/tickets/totp";

export async function scanFixture(context: Awaited<ReturnType<typeof fixture>>) {
  const setup = await gateFixture(context);
  const input = async (ticketId = setup.ticketIds[0]) => {
    const row = (
      await context.repo.pool.query(
        "SELECT t.secret_version,s.key_id,s.secret_enc FROM tickets t JOIN ticket_secrets s ON s.ticket_id=t.id AND s.version=t.secret_version WHERE t.id=$1",
        [ticketId],
      )
    ).rows[0];
    const secret = context.secrets.decrypt(ticketId, row.secret_version, {
      keyId: row.key_id,
      ciphertext: row.secret_enc,
    });
    try {
      return {
        event_id: setup.order.data.event_id,
        gate_id: setup.gate.id,
        qr: {
          version: 1,
          ticket_id: ticketId,
          secret_version: row.secret_version as number,
          token: totp(secret, Math.floor(Date.now() / 1000)),
        },
      };
    } finally {
      secret.fill(0);
    }
  };
  const scan = (
    body: Awaited<ReturnType<typeof input>>,
    key = randomUUID(),
    token = setup.staffToken,
  ) =>
    request(setup.server)
      .post("/v1/check-ins")
      .auth(token, { type: "bearer" })
      .set("Idempotency-Key", key)
      .send(body);
  return { ...setup, input, scan };
}
