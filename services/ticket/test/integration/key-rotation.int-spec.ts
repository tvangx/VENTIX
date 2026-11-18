import { randomBytes } from "node:crypto";
import { TicketSecrets } from "../../src/modules/tickets/ticket-secrets";
import { rotateTicketKeys } from "../../src/tools/rotate-ticket-keys";
import { offlineFixture } from "../support/offline";
import { fixture } from "../support/ticket";

describe("S-504 Ticket key rotation", () => {
  const keys = {
    before: randomBytes(32).toString("base64"),
    next: randomBytes(32).toString("base64"),
  };
  let context: Awaited<ReturnType<typeof fixture>>;

  beforeAll(async () => {
    context = await fixture({
      TICKET_ENCRYPTION_KEYS: JSON.stringify(keys),
      TICKET_ACTIVE_KEY_ID: "before",
    });
  });

  afterAll(async () => {
    await context?.close();
  });

  it("preserves ticket secrets, versions and enrolled device HMAC material", async () => {
    const setup = await offlineFixture(context);
    const pool = context.repo.pool;
    const ticketSecrets = async () =>
      (
        await pool.query<{
          id: string;
          ticket_id: string;
          version: number;
          key_id: string;
          secret_enc: Buffer;
        }>("SELECT id,ticket_id,version,key_id,secret_enc FROM ticket_secrets ORDER BY id")
      ).rows;
    const before = await ticketSecrets();
    expect(before.length).toBeGreaterThan(0);
    const nextOnly = { next: keys.next };
    await expect(rotateTicketKeys(pool, nextOnly, "next", true)).rejects.toThrow(
      "TICKET_KEY_UNAVAILABLE",
    );
    expect(await rotateTicketKeys(pool, keys, "next", false)).toEqual({
      checked: before.length + 1,
      rotated: 0,
      conflicts: 0,
    });
    expect(await ticketSecrets()).toEqual(before);
    expect(await rotateTicketKeys(pool, keys, "next", true)).toEqual({
      checked: before.length + 1,
      rotated: before.length + 1,
      conflicts: 0,
    });
    const next = new TicketSecrets(nextOnly, "next");
    const after = await ticketSecrets();
    expect(after).toHaveLength(before.length);
    for (const [index, row] of after.entries()) {
      const old = before[index];
      expect(row).toMatchObject({ id: old.id, version: old.version, key_id: "next" });
      expect(
        next.decrypt(row.ticket_id, row.version, { keyId: row.key_id, ciphertext: row.secret_enc }),
      ).toEqual(
        context.secrets.decrypt(old.ticket_id, old.version, {
          keyId: old.key_id,
          ciphertext: old.secret_enc,
        }),
      );
    }
    const { rows } = await pool.query<{ key_id: string; secret_enc: Buffer }>(
      "SELECT key_id,secret_enc FROM offline_devices WHERE id=$1::uuid",
      [setup.device.device_id],
    );
    const offline = new TicketSecrets(nextOnly, "next", "ticket-offline-device-v1");
    expect(rows[0].key_id).toBe("next");
    expect(
      offline.decrypt(setup.device.device_id, 1, {
        keyId: rows[0].key_id,
        ciphertext: rows[0].secret_enc,
      }),
    ).toEqual(setup.signingKey);
    expect(await rotateTicketKeys(pool, nextOnly, "next", true)).toEqual({
      checked: 0,
      rotated: 0,
      conflicts: 0,
    });
  });
});
