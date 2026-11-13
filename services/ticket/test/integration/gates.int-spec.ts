import { generateKeyPairSync, randomUUID } from "node:crypto";
import request from "supertest";
import { newMessage } from "@ticketing/event-contracts";
import { fixture } from "../support/ticket";
import { decryptVerificationPackage, devicePublicKey, gateFixture } from "../support/gates";

describe("S-401 gate packages with real PostgreSQL", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture();
  });
  afterAll(async () => {
    await context?.close();
  });

  it("enforces role, event tenant and active gate assignment on every download", async () => {
    const setup = await gateFixture(context);
    await request(setup.server)
      .post(`/v1/gates/${setup.gate.id}/verification-packages`)
      .send({ public_key_pem: devicePublicKey })
      .expect(401);
    await setup.download(randomUUID(), await context.token(setup.staffId)).expect(403);
    await setup
      .download(randomUUID(), await context.token(randomUUID(), ["STAFF"], setup.organizerId))
      .expect(403);
    await setup
      .download(randomUUID(), await context.token(setup.staffId, ["STAFF"], randomUUID()))
      .expect(403);
    await setup.download(randomUUID(), await context.token(setup.staffId, ["STAFF"])).expect(403);
    await setup
      .post(
        "",
        { event_id: setup.order.data.event_id, name: "wrong tenant" },
        randomUUID(),
        await context.token(randomUUID(), ["ORGANIZER"], randomUUID()),
      )
      .expect(403);
    await setup.post("", { event_id: randomUUID(), name: "unknown" }).expect(409);
    const key = randomUUID();
    await setup.download(key).expect(201);
    await setup
      .post(`/${setup.gate.id}/staff/revoke`, { staff_user_id: setup.staffId })
      .expect(201);
    await setup.download(key).expect(403);
    expect(
      (
        await request(setup.server)
          .get("/v1/gates/me")
          .auth(setup.staffToken, { type: "bearer" })
          .expect(200)
      ).body.items,
    ).toEqual([]);
  });

  it("returns only assigned gate ACTIVE secrets, authenticated metadata and TTL; replay is exact", async () => {
    const setup = await gateFixture(context);
    const key = randomUUID();
    const first = await setup.download(key).set("X-Request-Id", "gate-package-trace").expect(201);
    const second = await setup.download(key).expect(201);
    expect(second.body).toEqual(first.body);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    expect(Date.parse(first.body.expires_at) - Date.parse(first.body.issued_at)).toBe(600000);
    const payload = await decryptVerificationPackage(first.body);
    expect(payload.event_id).toBe(setup.order.data.event_id);
    expect(payload.gate_id).toBe(setup.gate.id);
    expect(payload.tickets.map((ticket) => ticket.ticket_id)).toEqual(setup.ticketIds.slice(0, 2));
    for (const ticket of payload.tickets) {
      const row = (
        await context.repo.pool.query(
          "SELECT key_id,secret_enc FROM ticket_secrets WHERE ticket_id=$1 AND version=$2",
          [ticket.ticket_id, ticket.secret_version],
        )
      ).rows[0];
      expect(Buffer.from(ticket.secret, "base64")).toEqual(
        context.secrets.decrypt(ticket.ticket_id, ticket.secret_version, {
          keyId: row.key_id,
          ciphertext: row.secret_enc,
        }),
      );
    }
    expect(JSON.stringify(first.body)).not.toMatch(/secret_version|owner_user_id|secret_enc/);
    const audit = await context.repo.pool.query(
      "SELECT payload FROM outbox_events WHERE message_key=$1 AND payload->'data'->>'action'='GATE_PACKAGE_ISSUED'",
      [setup.gate.id],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].payload.trace_id).toBe("gate-package-trace");
    expect(JSON.stringify(audit.rows[0])).not.toContain(payload.tickets[0].secret);
    await context.repo.pool.query("UPDATE tickets SET status='FROZEN' WHERE id=$1", [
      setup.ticketIds[0],
    ]);
    const filtered = await decryptVerificationPackage((await setup.download().expect(201)).body);
    expect(filtered.tickets.map((ticket) => ticket.ticket_id)).toEqual([setup.ticketIds[1]]);
  });

  it("supports cursor listing, idempotent mutations and rejects altered key payloads", async () => {
    const setup = await gateFixture(context);
    const key = randomUUID();
    const body = { event_id: setup.order.data.event_id, name: "South" };
    const first = await setup.post("", body, key).expect(201);
    expect((await setup.post("", body, key).expect(201)).body).toEqual(first.body);
    expect((await setup.post("", { ...body, name: "West" }, key).expect(409)).body.code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );
    await setup.post("", body).expect(409);
    await setup.post(`/${first.body.id}/staff`, { staff_user_id: setup.staffId }).expect(201);
    const page = await request(setup.server)
      .get("/v1/gates/me?limit=1")
      .auth(setup.staffToken, { type: "bearer" })
      .expect(200);
    expect(page.body.items).toHaveLength(1);
    const next = await request(setup.server)
      .get(`/v1/gates/me?limit=1&cursor=${page.body.next_cursor}`)
      .auth(setup.staffToken, { type: "bearer" })
      .expect(200);
    expect(next.body.items).toHaveLength(1);
    expect(next.body.next_cursor).toBeNull();
    expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
    const packageKey = randomUUID();
    await setup.download(packageKey).expect(201);
    const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    expect(
      (
        await setup
          .post(
            `/${setup.gate.id}/verification-packages`,
            { public_key_pem: otherKey },
            packageKey,
            setup.staffToken,
          )
          .expect(409)
      ).body.code,
    ).toBe("IDEMPOTENCY_KEY_REUSED");
    await setup
      .post(
        `/${setup.gate.id}/verification-packages`,
        { public_key_pem: "invalid".repeat(30) },
        packageKey,
        setup.staffToken,
      )
      .expect(400);
    await request(setup.server)
      .post("/v1/gates")
      .auth(setup.managerToken, { type: "bearer" })
      .send({ event_id: setup.order.data.event_id, name: "Missing key" })
      .expect(400);
  });

  it("enforces cross-event DB foreign keys and single gate assignment without partial writes", async () => {
    const first = await gateFixture(context);
    const second = await gateFixture(context);
    const south = (
      await first.post("", { event_id: first.order.data.event_id, name: "South" }).expect(201)
    ).body;
    await first
      .post(`/${south.id}/tickets`, { ticket_ids: [first.ticketIds[2], first.ticketIds[0]] })
      .expect(409);
    expect(
      (
        await context.repo.pool.query("SELECT gate_id FROM tickets WHERE id=$1", [
          first.ticketIds[2],
        ])
      ).rows[0].gate_id,
    ).toBeNull();
    await first.post(`/${south.id}/tickets`, { ticket_ids: [second.ticketIds[0]] }).expect(409);
    await expect(
      context.repo.pool.query("UPDATE tickets SET gate_id=$1 WHERE id=$2", [
        first.gate.id,
        second.ticketIds[2],
      ]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      context.repo.pool.query(
        "INSERT INTO staff_assignments (id,gate_id,event_id,staff_user_id,organizer_id) VALUES ($1,$2,$3,$4,$5)",
        [randomUUID(), first.gate.id, second.order.data.event_id, randomUUID(), second.organizerId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("fails closed for revoked, missing or corrupted secrets and expired cached responses", async () => {
    const setup = await gateFixture(context);
    await context.repo.pool.query("UPDATE ticket_secrets SET revoked_at=now() WHERE ticket_id=$1", [
      setup.ticketIds[0],
    ]);
    expect((await setup.download().expect(503)).body.code).toBe("TICKET_SECRET_UNAVAILABLE");
    await context.repo.pool.query("UPDATE tickets SET status='REVOKED' WHERE id=$1", [
      setup.ticketIds[0],
    ]);
    const key = randomUUID();
    const good = await setup.download(key).expect(201);
    expect((await decryptVerificationPackage(good.body)).tickets).toHaveLength(1);
    await context.repo.pool.query(
      "UPDATE ticket_requests SET response=jsonb_set(response,'{expires_at}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE request_key=$1",
      [key],
    );
    expect((await setup.download(key).expect(409)).body.code).toBe("PACKAGE_EXPIRED");
    await context.repo.pool.query(
      "UPDATE ticket_secrets SET secret_enc=set_byte(secret_enc,12,get_byte(secret_enc,12) # 1) WHERE ticket_id=$1",
      [setup.ticketIds[1]],
    );
    await setup.download().expect(503);
  });

  it("rolls back gate and idempotency receipt when the Audit Outbox insert fails", async () => {
    const setup = await gateFixture(context);
    const key = randomUUID();
    await context.admin.query(
      "ALTER TABLE outbox_events ADD CONSTRAINT synthetic_gate_audit_failure CHECK (event_type<>'AuditRecorded') NOT VALID",
    );
    try {
      await setup
        .post("", { event_id: setup.order.data.event_id, name: "Rollback" }, key)
        .expect(500);
    } finally {
      await context.admin.query(
        "ALTER TABLE outbox_events DROP CONSTRAINT synthetic_gate_audit_failure",
      );
    }
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM gates WHERE event_id=$1 AND name='Rollback'",
          [setup.order.data.event_id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (await context.repo.pool.query("SELECT id FROM ticket_requests WHERE request_key=$1", [key]))
        .rowCount,
    ).toBe(0);
    await setup
      .post("", { event_id: setup.order.data.event_id, name: "Rollback" }, key)
      .expect(201);
  });

  it("deduplicates lifecycle, preserves source version/tenant and keeps cancellation terminal", async () => {
    const setup = await gateFixture(context);
    expect(await context.deliver(setup.lifecycle)).toBe("duplicate");
    const updated = newMessage("EventUpdated", {
      event_id: setup.order.data.event_id,
      organizer_id: setup.organizerId,
      event_version: 3,
    });
    await context.deliver(updated);
    await context.deliver({
      ...updated,
      message_id: randomUUID(),
      data: { ...updated.data, event_version: 2 },
    });
    expect(
      (
        await context.repo.pool.query("SELECT source_version FROM ticket_events WHERE id=$1", [
          setup.order.data.event_id,
        ])
      ).rows[0].source_version,
    ).toBe(3);
    expect(
      await context.deliver({
        ...updated,
        message_id: randomUUID(),
        data: { ...updated.data, organizer_id: randomUUID() },
      }),
    ).toBe("dead-lettered");
    expect(
      await context.deliver({ ...updated, message_id: randomUUID(), tenant_id: randomUUID() }),
    ).toBe("dead-lettered");
    await context.deliver(
      newMessage("EventCancelled", {
        event_id: setup.order.data.event_id,
        organizer_id: setup.organizerId,
        reason: "Synthetic cancellation",
      }),
    );
    await context.deliver({
      ...updated,
      message_id: randomUUID(),
      data: { ...updated.data, event_version: 4 },
    });
    expect((await setup.download().expect(409)).body.code).toBe("EVENT_CANCELLED");
    await setup
      .post("", { event_id: setup.order.data.event_id, name: "After cancellation" })
      .expect(409);
  });

  it("honors the configured package size limit", async () => {
    const limited = await fixture({ TICKET_PACKAGE_MAX_TICKETS: 1 });
    try {
      const setup = await gateFixture(limited);
      expect((await setup.download().expect(409)).body.code).toBe("PACKAGE_TOO_LARGE");
    } finally {
      await limited.close();
    }
  });
});
