import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { newMessage, parseMessage } from "@ticketing/event-contracts";
import { fixture } from "../support/ticket";
import { offlineFixture } from "../support/offline";
import { OfflineKeys } from "../../src/modules/offline/offline-keys";
import { totp } from "../../src/modules/tickets/totp";

describe("S-403 signed offline sync", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture();
  });
  afterAll(async () => {
    await context?.close();
  });

  it("binds enrollment to an owned package/public key, encrypts the HMAC secret and replays enrollment", async () => {
    const setup = await offlineFixture(context);
    expect(setup.signingKey).toHaveLength(32);
    const { server_time: replayTime, ...replayed } = (
      await setup.register(setup.registrationKey).expect(201)
    ).body;
    const { server_time: initialTime, ...original } = setup.device;
    expect(replayed).toEqual(original);
    expect(Date.parse(replayTime)).toBeGreaterThanOrEqual(Date.parse(initialTime));
    const row = (
      await context.repo.pool.query("SELECT secret_enc,key_id FROM offline_devices WHERE id=$1", [
        setup.device.device_id,
      ])
    ).rows[0];
    expect(
      context.app
        .get(OfflineKeys)
        .decrypt(setup.device.device_id, 1, { keyId: row.key_id, ciphertext: row.secret_enc }),
    ).toEqual(setup.signingKey);
    expect(() =>
      context.secrets.decrypt(setup.device.device_id, 1, {
        keyId: row.key_id,
        ciphertext: row.secret_enc,
      }),
    ).toThrow();
    const wrongPublicKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    expect(
      (
        await setup
          .register(randomUUID(), { ...setup.registration, public_key_pem: wrongPublicKey })
          .expect(409)
      ).body.code,
    ).toBe("PACKAGE_KEY_MISMATCH");
    await setup
      .register(randomUUID(), { ...setup.registration, package_id: randomUUID() })
      .expect(404);
    await setup
      .register(
        randomUUID(),
        setup.registration,
        await context.token(randomUUID(), ["STAFF"], setup.organizerId),
      )
      .expect(403);
    await setup.register(randomUUID(), setup.registration, setup.managerToken).expect(403);
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM outbox_events WHERE message_key=$1 AND payload->'data'->>'action'='OFFLINE_DEVICE_REGISTERED'",
          [setup.device.device_id],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("rejects a wrong HMAC before writing batch/log/state, then accepts the unchanged signed batch", async () => {
    const setup = await offlineFixture(context);
    const batch = await setup.makeBatch();
    expect(
      (await setup.sync({ ...batch, signature: Buffer.alloc(32).toString("base64") }).expect(403))
        .body.code,
    ).toBe("INVALID_OFFLINE_SIGNATURE");
    expect(
      (
        await context.repo.pool.query("SELECT id FROM offline_sync_batches WHERE id=$1", [
          batch.batch_id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await context.repo.pool.query("SELECT id FROM checkin_logs WHERE device_id=$1", [
          setup.device.device_id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await context.repo.pool.query("SELECT status FROM tickets WHERE id=$1", [
          batch.scans[0].ticket_id,
        ])
      ).rows[0].status,
    ).toBe("ACTIVE");
    const good = await setup.sync(batch).expect(200);
    expect(good.body.batch.items[0].result).toBe("ACCEPTED");
    expect(good.headers["cache-control"]).toBe("private, no-store");
    expect(good.body.revocations.revoked_ticket_ids).toContain(batch.scans[0].ticket_id);
    const published = (
      await context.repo.pool.query(
        "SELECT payload FROM outbox_events WHERE event_type='TicketCheckedIn' AND message_key=$1",
        [batch.scans[0].ticket_id],
      )
    ).rows;
    expect(published).toHaveLength(1);
    expect(parseMessage(published[0].payload)).toMatchObject({
      type: "TicketCheckedIn",
      data: { offline: true, scanned_at: batch.scans[0].scanned_at },
    });
    expect(JSON.stringify(good.body)).not.toMatch(/"token"|secret_enc|encrypted_key/);
  });

  it("replays both batch and source scan IDs and rejects validly signed changes to their content", async () => {
    const setup = await offlineFixture(context);
    const batch = await setup.makeBatch();
    const first = await setup.sync(batch).expect(200);
    expect((await setup.sync(batch).expect(200)).body.batch).toEqual(first.body.batch);
    const next = setup.signed({ ...batch, batch_id: randomUUID() });
    expect((await setup.sync(next).expect(200)).body.batch.items).toEqual(first.body.batch.items);
    expect(
      (
        await context.repo.pool.query("SELECT id FROM checkin_logs WHERE device_id=$1", [
          setup.device.device_id,
        ])
      ).rowCount,
    ).toBe(1);
    const changedToken = batch.scans[0].token === "999999" ? "999998" : "999999";
    const changed = setup.signed({ ...batch, scans: [{ ...batch.scans[0], token: changedToken }] });
    expect((await setup.sync(changed).expect(409)).body.code).toBe("OFFLINE_BATCH_ID_REUSED");
    expect(
      (await setup.sync(setup.signed({ ...changed, batch_id: randomUUID() })).expect(409)).body
        .code,
    ).toBe("OFFLINE_SCAN_ID_REUSED");
    await setup.sync(batch, setup.staffToken, randomUUID()).expect(400);
  });

  it("records the second device's scan as DUPLICATE", async () => {
    const first = await offlineFixture(context);
    const second = await offlineFixture(context, first);
    expect(first.device.device_id).not.toBe(second.device.device_id);
    expect(first.signingKey.equals(second.signingKey)).toBe(false);
    expect((await first.sync(await first.makeBatch()).expect(200)).body.batch.conflict_count).toBe(
      0,
    );
    const duplicate = await second.sync(await second.makeBatch()).expect(200);
    expect(duplicate.body.batch.conflict_count).toBe(1);
    expect(duplicate.body.batch.items[0].result).toBe("DUPLICATE");
  });

  it("validates array input, package/time context and current staff assignment", async () => {
    const setup = await offlineFixture(context);
    const batch = await setup.makeBatch();
    await request(setup.server).post("/v1/offline-sync").send(batch).expect(401);
    await setup.sync({ ...batch, scans: [null] } as unknown as typeof batch).expect(400);
    await setup.sync({ ...batch, scans: [] }).expect(400);
    await setup.sync({ ...batch, scans: [batch.scans[0], batch.scans[0]] }).expect(400);
    await setup.sync(setup.signed({ ...batch, gate_id: randomUUID() })).expect(409);
    for (const scanned_at of [
      new Date(Date.parse(setup.device.issued_at) - 1).toISOString(),
      setup.device.expires_at,
      new Date(Date.now() + 120000).toISOString(),
    ]) {
      const outside = setup.signed({ ...batch, scans: [{ ...batch.scans[0], scanned_at }] });
      expect((await setup.sync(outside).expect(400)).body.code).toBe("OFFLINE_SCAN_OUTSIDE_WINDOW");
    }
    await setup
      .sync(batch, await context.token(randomUUID(), ["STAFF"], setup.organizerId))
      .expect(404);
    await setup.sync(batch).expect(200);
    await setup
      .post(`/${setup.gate.id}/staff/revoke`, { staff_user_id: setup.staffId })
      .expect(201);
    await setup.sync(batch).expect(403);
    await setup.delta().expect(403);
  });

  it("accepts queued scans after expiry when their signed timestamp was inside the scan window", async () => {
    const setup = await offlineFixture(context);
    const batch = await setup.makeBatch();
    const now = (await context.repo.pool.query<{ now: Date }>("SELECT clock_timestamp() AS now"))
      .rows[0].now;
    await context.repo.pool.query(
      "UPDATE offline_devices SET issued_at=$2,expires_at=$3 WHERE id=$1",
      [setup.device.device_id, new Date(now.getTime() - 61000), new Date(now.getTime() - 1000)],
    );
    const scanned_at = new Date(now.getTime() - 2000).toISOString();
    const row = (
      await context.repo.pool.query(
        "SELECT key_id,secret_enc FROM ticket_secrets WHERE ticket_id=$1 AND version=$2",
        [batch.scans[0].ticket_id, batch.scans[0].secret_version],
      )
    ).rows[0];
    const secret = context.secrets.decrypt(
      batch.scans[0].ticket_id,
      batch.scans[0].secret_version,
      { keyId: row.key_id, ciphertext: row.secret_enc },
    );
    let token: string;
    try {
      token = totp(secret, Math.floor(Date.parse(scanned_at) / 1000));
    } finally {
      secret.fill(0);
    }
    const queued = setup.signed({ ...batch, scans: [{ ...batch.scans[0], token, scanned_at }] });
    expect((await setup.sync(queued).expect(200)).body.batch.items[0].result).toBe("ACCEPTED");
    await context.repo.pool.query(
      "UPDATE ticket_requests SET response=jsonb_set(response,'{expires_at}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE actor_id=$1 AND response->>'package_id'=$2 AND scope=$3",
      [setup.staffId, setup.device.package_id, `gate-package:${setup.gate.id}`],
    );
    await setup.register().expect(409);
  });

  it("returns fresh paginated revocations on replay and distinguishes rotated ACTIVE versions", async () => {
    const setup = await offlineFixture(context);
    const batch = await setup.makeBatch();
    await setup.sync(batch).expect(200);
    const id = setup.ticketIds[1];
    const encrypted = context.secrets.encrypt(id, 2, randomBytes(20));
    await context.repo.db.transaction(async (executor) => {
      await executor.query(
        "UPDATE ticket_secrets SET revoked_at=now() WHERE ticket_id=$1 AND version=1",
        [id],
      );
      await executor.query(
        "INSERT INTO ticket_secrets (id,ticket_id,version,key_id,secret_enc) VALUES ($1,$2,2,$3,$4)",
        [randomUUID(), id, encrypted.keyId, encrypted.ciphertext],
      );
      await executor.query(
        "UPDATE tickets SET secret_version=2,version=version+1,updated_at=now() WHERE id=$1",
        [id],
      );
    });
    const fresh = await setup.sync(batch).expect(200);
    expect(fresh.body.revocations.ticket_updates).toContainEqual({
      ticket_id: id,
      status: "ACTIVE",
      secret_version: 2,
      revoked: false,
    });
    expect(fresh.body.revocations.revoked_ticket_ids).not.toContain(id);
    const page = await setup.delta("?limit=1").expect(200);
    expect(page.body.ticket_updates).toHaveLength(1);
    const next = await setup.delta(`?limit=1&cursor=${page.body.next_cursor}`).expect(200);
    expect(next.body.ticket_updates).toHaveLength(1);
    expect(next.body.next_cursor).toBeNull();
    await context.deliver(
      newMessage("OrderCancelled", {
        order_id: setup.order.data.order_id,
        event_id: setup.order.data.event_id,
        reason: "USER_CANCELLED",
      }),
    );
    expect(
      (await setup.sync(batch).expect(200)).body.revocations.revoked_ticket_ids.sort(),
    ).toEqual(setup.ticketIds.slice(0, 2).sort());
  });

  it("allows revoked-event sync to return revocations while recording scans as INVALID", async () => {
    const setup = await offlineFixture(context);
    const batch = await setup.makeBatch();
    await context.deliver(
      newMessage("EventCancelled", {
        event_id: setup.order.data.event_id,
        organizer_id: setup.organizerId,
        reason: "Synthetic cancellation",
      }),
    );
    const result = await setup.sync(batch).expect(200);
    expect(result.body.batch.items[0].result).toBe("INVALID");
    expect(result.body.revocations.revoked_ticket_ids.sort()).toEqual(
      setup.ticketIds.slice(0, 2).sort(),
    );
    await setup.delta().expect(200);
  });

  it.each([
    {
      table: "outbox_events",
      constraint: "synthetic_offline_outbox_failure",
      check: "event_type<>'TicketCheckedIn'",
    },
    {
      table: "offline_sync_batches",
      constraint: "synthetic_offline_receipt_failure",
      check: "record_count<0",
    },
  ])(
    "rolls back the entire batch when $table rejects its insert",
    async ({ table, constraint, check }) => {
      const setup = await offlineFixture(context);
      const batch = await setup.makeBatch();
      await context.admin.query(
        `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK (${check}) NOT VALID`,
      );
      try {
        await setup.sync(batch).expect(500);
      } finally {
        await context.admin.query(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
      }
      expect(
        (
          await context.repo.pool.query("SELECT id FROM offline_sync_batches WHERE id=$1", [
            batch.batch_id,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await context.repo.pool.query("SELECT id FROM checkin_logs WHERE device_id=$1", [
            setup.device.device_id,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await context.repo.pool.query(
            "SELECT id FROM outbox_events WHERE event_type='TicketCheckedIn' AND message_key=$1",
            [batch.scans[0].ticket_id],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await context.repo.pool.query("SELECT status FROM tickets WHERE id=$1", [
            batch.scans[0].ticket_id,
          ])
        ).rows[0].status,
      ).toBe("ACTIVE");
      await setup.sync(batch).expect(200);
    },
  );

  it("handles the maximum 500-record batch through the default HTTP entry point", async () => {
    const setup = await offlineFixture(context);
    const initial = await setup.makeBatch();
    const scans = Array.from({ length: 500 }, () => ({
      ...initial.scans[0],
      scan_id: randomUUID(),
    }));
    const batch = setup.signed({ ...initial, scans });
    const result = await setup.sync(batch).expect(200);
    expect(result.body.batch.record_count).toBe(500);
    expect(result.body.batch.conflict_count).toBe(499);
    expect(result.body.batch.items).toHaveLength(500);
    await setup
      .sync(
        setup.signed({
          ...batch,
          batch_id: randomUUID(),
          scans: [...scans, { ...scans[0], scan_id: randomUUID() }],
        }),
      )
      .expect(400);
  });

  it("fails closed when a signing key is damaged and isolates keys between devices", async () => {
    const first = await offlineFixture(context);
    const second = await offlineFixture(context, first);
    const foreign = await second.makeBatch();
    await first.sync(first.signed(foreign)).expect(403);
    const batch = await first.makeBatch();
    await context.repo.pool.query(
      "UPDATE offline_devices SET secret_enc=set_byte(secret_enc,12,get_byte(secret_enc,12) # 1) WHERE id=$1",
      [first.device.device_id],
    );
    expect((await first.sync(batch).expect(503)).body.code).toBe("OFFLINE_KEY_UNAVAILABLE");
    expect(
      (
        await context.repo.pool.query("SELECT id FROM offline_sync_batches WHERE id=$1", [
          batch.batch_id,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("enforces append-only batches at the DB boundary", async () => {
    const setup = await offlineFixture(context);
    const batch = await setup.makeBatch();
    await setup.sync(batch).expect(200);
    const privileges = (
      await context.repo.pool.query<{
        table_update: boolean;
        id_update: boolean;
        data_update: boolean;
      }>(
        "SELECT has_table_privilege(current_user,'offline_sync_batches','UPDATE') AS table_update,has_column_privilege(current_user,'offline_sync_batches','id','UPDATE') AS id_update,has_column_privilege(current_user,'offline_sync_batches','conflict_count','UPDATE') AS data_update",
      )
    ).rows[0];
    expect(privileges).toEqual({ table_update: false, id_update: true, data_update: false });
    await expect(
      context.repo.pool.query("UPDATE offline_sync_batches SET id=id WHERE id=$1", [
        batch.batch_id,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      context.repo.pool.query("UPDATE offline_sync_batches SET conflict_count=1 WHERE id=$1", [
        batch.batch_id,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      context.admin.query("DELETE FROM offline_sync_batches WHERE id=$1", [batch.batch_id]),
    ).rejects.toMatchObject({ code: "55000" });
  });
});
