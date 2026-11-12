import { randomUUID } from "node:crypto";
import request from "supertest";
import { parseMessage } from "@ticketing/event-contracts";
import { fixture } from "../support/ticket";
import { scanFixture } from "../support/checkin";
import { totp } from "../../src/modules/tickets/totp";

describe("S-402 online check-in", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture();
  });
  afterAll(async () => {
    await context?.close();
  });

  it("accepts once, records duplicate scans, replays the same request and publishes the existing contract", async () => {
    const setup = await scanFixture(context);
    const body = await setup.input();
    const key = randomUUID();
    const first = await setup
      .scan(body, key)
      .set("X-Request-Id", "online-checkin-trace")
      .expect(200);
    expect(first.body.result).toBe("ACCEPTED");
    expect(first.headers["cache-control"]).toBe("private, no-store");
    expect((await setup.scan(body).expect(200)).body.result).toBe("DUPLICATE");
    expect((await setup.scan(body, key).expect(200)).body).toEqual(first.body);
    expect(
      (await setup.scan({ ...body, qr: { ...body.qr, secret_version: 2 } }, key).expect(409)).body
        .code,
    ).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(
      (await context.repo.pool.query("SELECT status FROM tickets WHERE id=$1", [body.qr.ticket_id]))
        .rows[0].status,
    ).toBe("CHECKED_IN");
    expect(
      (
        await context.repo.pool.query("SELECT id FROM checkin_logs WHERE ticket_id=$1", [
          body.qr.ticket_id,
        ])
      ).rowCount,
    ).toBe(2);
    const events = await context.repo.pool.query(
      "SELECT payload FROM outbox_events WHERE event_type='TicketCheckedIn' AND message_key=$1",
      [body.qr.ticket_id],
    );
    expect(events.rowCount).toBe(1);
    expect(parseMessage(events.rows[0].payload)).toMatchObject({
      type: "TicketCheckedIn",
      trace_id: "online-checkin-trace",
      tenant_id: setup.organizerId,
      data: {
        ticket_id: body.qr.ticket_id,
        event_id: body.event_id,
        gate_id: body.gate_id,
        offline: false,
        scanned_at: first.body.scanned_at,
      },
    });
    expect(JSON.stringify(first.body)).not.toContain(body.qr.token);
    expect(JSON.stringify(events.rows)).not.toContain('"token"');
  });

  it("checks current staff role, tenant and assignment before every request and replay", async () => {
    const setup = await scanFixture(context);
    const body = await setup.input();
    await request(setup.server).post("/v1/check-ins").send(body).expect(401);
    await setup.scan(body, randomUUID(), setup.managerToken).expect(403);
    await setup
      .scan(body, randomUUID(), await context.token(randomUUID(), ["STAFF"], setup.organizerId))
      .expect(403);
    await setup
      .scan(body, randomUUID(), await context.token(setup.staffId, ["STAFF"], randomUUID()))
      .expect(403);
    const key = randomUUID();
    await setup.scan(body, key).expect(200);
    await setup
      .post(`/${setup.gate.id}/staff/revoke`, { staff_user_id: setup.staffId })
      .expect(201);
    await setup.scan(body, key).expect(403);
  });

  it("distinguishes wrong event, wrong gate and unknown ticket without accepting them", async () => {
    const first = await scanFixture(context);
    const second = await scanFixture(context);
    const foreign = await second.input();
    expect(
      (
        await first
          .scan({ ...foreign, event_id: first.order.data.event_id, gate_id: first.gate.id })
          .expect(200)
      ).body.result,
    ).toBe("WRONG_EVENT");
    const wrongGate = await first.input(first.ticketIds[2]);
    expect((await first.scan(wrongGate).expect(200)).body.result).toBe("WRONG_GATE");
    const unknown = { ...wrongGate, qr: { ...wrongGate.qr, ticket_id: randomUUID() } };
    const invalid = await first.scan(unknown).expect(200);
    expect(invalid.body.result).toBe("INVALID");
    expect(
      (
        await context.repo.pool.query(
          "SELECT ticket_id,scanned_ticket_id FROM checkin_logs WHERE id=$1",
          [invalid.body.scan_id],
        )
      ).rows[0],
    ).toEqual({ ticket_id: null, scanned_ticket_id: unknown.qr.ticket_id });
    expect((await first.scan({ ...wrongGate, event_id: randomUUID() }).expect(409)).body.code).toBe(
      "GATE_EVENT_MISMATCH",
    );
  });

  it.each(["FROZEN", "REVOKED", "REFUNDED"])("rejects %s tickets", async (status) => {
    const setup = await scanFixture(context);
    const body = await setup.input();
    await context.repo.pool.query("UPDATE tickets SET status=$2 WHERE id=$1", [
      body.qr.ticket_id,
      status,
    ]);
    expect((await setup.scan(body).expect(200)).body.result).toBe("INVALID");
    expect(
      (await context.repo.pool.query("SELECT status FROM tickets WHERE id=$1", [body.qr.ticket_id]))
        .rows[0].status,
    ).toBe(status);
  });

  it("rejects stale secret versions and damaged/missing current secrets; validates QR input", async () => {
    const setup = await scanFixture(context);
    const body = await setup.input();
    expect(
      (
        await setup
          .scan({ ...body, qr: { ...body.qr, secret_version: body.qr.secret_version + 1 } })
          .expect(200)
      ).body.result,
    ).toBe("INVALID");
    await setup.scan({ ...body, qr: { ...body.qr, token: "12345" } }).expect(400);
    await setup.scan({ ...body, qr: { ...body.qr, version: 2 } }).expect(400);
    await context.repo.pool.query(
      "UPDATE ticket_secrets SET secret_enc=set_byte(secret_enc,12,get_byte(secret_enc,12) # 1) WHERE ticket_id=$1",
      [body.qr.ticket_id],
    );
    expect((await setup.scan(body).expect(503)).body.code).toBe("TICKET_SECRET_UNAVAILABLE");
    await context.repo.pool.query("UPDATE ticket_secrets SET revoked_at=now() WHERE ticket_id=$1", [
      body.qr.ticket_id,
    ]);
    await setup.scan(body).expect(503);
  });

  it("rejects a well-formed incorrect TOTP and missing QR/request keys", async () => {
    const setup = await scanFixture(context);
    const body = await setup.input();
    const row = (
      await context.repo.pool.query(
        "SELECT secret_enc,key_id FROM ticket_secrets WHERE ticket_id=$1 AND version=$2",
        [body.qr.ticket_id, body.qr.secret_version],
      )
    ).rows[0];
    const secret = context.secrets.decrypt(body.qr.ticket_id, body.qr.secret_version, {
      keyId: row.key_id,
      ciphertext: row.secret_enc,
    });
    let invalidToken: string;
    try {
      const seconds = Math.floor(Date.now() / 1000);
      const valid = new Set([-60, -30, 0, 30, 60].map((delta) => totp(secret, seconds + delta)));
      invalidToken = Array.from({ length: 8 }, (_, index) => String(index).padStart(6, "0")).find(
        (token) => !valid.has(token),
      )!;
    } finally {
      secret.fill(0);
    }
    expect(
      (await setup.scan({ ...body, qr: { ...body.qr, token: invalidToken } }).expect(200)).body
        .result,
    ).toBe("INVALID");
    expect(
      (await context.repo.pool.query("SELECT status FROM tickets WHERE id=$1", [body.qr.ticket_id]))
        .rows[0].status,
    ).toBe("ACTIVE");
    await request(setup.server)
      .post("/v1/check-ins")
      .auth(setup.staffToken, { type: "bearer" })
      .set("Idempotency-Key", randomUUID())
      .send({ event_id: body.event_id, gate_id: body.gate_id })
      .expect(400);
    await request(setup.server)
      .post("/v1/check-ins")
      .auth(setup.staffToken, { type: "bearer" })
      .send(body)
      .expect(400);
  });

  it("rolls back status, log and receipt if TicketCheckedIn Outbox fails", async () => {
    const setup = await scanFixture(context);
    const body = await setup.input();
    const key = randomUUID();
    await context.admin.query(
      "ALTER TABLE outbox_events ADD CONSTRAINT synthetic_checkin_failure CHECK (event_type<>'TicketCheckedIn') NOT VALID",
    );
    try {
      await setup.scan(body, key).expect(500);
    } finally {
      await context.admin.query(
        "ALTER TABLE outbox_events DROP CONSTRAINT synthetic_checkin_failure",
      );
    }
    expect(
      (await context.repo.pool.query("SELECT status FROM tickets WHERE id=$1", [body.qr.ticket_id]))
        .rows[0].status,
    ).toBe("ACTIVE");
    expect(
      (
        await context.repo.pool.query("SELECT id FROM checkin_logs WHERE scanned_ticket_id=$1", [
          body.qr.ticket_id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (await context.repo.pool.query("SELECT id FROM ticket_requests WHERE request_key=$1", [key]))
        .rowCount,
    ).toBe(0);
    expect((await setup.scan(body, key).expect(200)).body.result).toBe("ACCEPTED");
  });

  it("enforces accepted uniqueness and append-only logs at the database boundary", async () => {
    const setup = await scanFixture(context);
    const result = await setup.scan(await setup.input()).expect(200);
    await expect(
      context.repo.pool.query(
        "INSERT INTO checkin_logs (id,ticket_id,scanned_ticket_id,gate_id,event_id,organizer_id,staff_user_id,result,offline,scanned_at) SELECT $1,ticket_id,scanned_ticket_id,gate_id,event_id,organizer_id,staff_user_id,result,offline,scanned_at FROM checkin_logs WHERE id=$2",
        [randomUUID(), result.body.scan_id],
      ),
    ).rejects.toMatchObject({ code: "23505", constraint: "uq_checkin_accepted" });
    await expect(
      context.repo.pool.query("UPDATE checkin_logs SET result='INVALID' WHERE id=$1", [
        result.body.scan_id,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      context.repo.pool.query("DELETE FROM checkin_logs WHERE id=$1", [result.body.scan_id]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      context.admin.query("UPDATE checkin_logs SET result='INVALID' WHERE id=$1", [
        result.body.scan_id,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      context.admin.query("DELETE FROM checkin_logs WHERE id=$1", [result.body.scan_id]),
    ).rejects.toMatchObject({ code: "55000" });
  });
});
