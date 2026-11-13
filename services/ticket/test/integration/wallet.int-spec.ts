import { randomUUID } from "node:crypto";
import request from "supertest";
import { confirmedOrder, fixture } from "../support/ticket";
import { verifyTotp } from "../../src/modules/tickets/totp";

describe("S-302 wallet HTTP", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture();
  });
  afterAll(async () => {
    await context?.close();
  });

  it("enforces authentication and owner-only cursor pagination without leaking secrets", async () => {
    const order = confirmedOrder();
    await context.deliver(order);
    const token = await context.token(order.data.user_id);
    const server = context.app.getHttpServer();
    await request(server).get("/v1/tickets").expect(401);
    const first = await request(server)
      .get("/v1/tickets?limit=2")
      .auth(token, { type: "bearer" })
      .expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    expect(first.body.next_cursor).toBe(first.body.items[1].id);
    const second = await request(server)
      .get(`/v1/tickets?limit=2&cursor=${first.body.next_cursor}`)
      .auth(token, { type: "bearer" })
      .expect(200);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.next_cursor).toBeNull();
    expect(
      new Set([...first.body.items, ...second.body.items].map((item: { id: string }) => item.id))
        .size,
    ).toBe(4);
    expect(JSON.stringify(first.body)).not.toMatch(/secret_enc|key_id|owner_user_id/);
    const stranger = await context.token(randomUUID());
    const empty = await request(server)
      .get("/v1/tickets")
      .auth(stranger, { type: "bearer" })
      .expect(200);
    expect(empty.body.items).toEqual([]);
    await request(server)
      .get(`/v1/tickets/${first.body.items[0].id}/token`)
      .auth(stranger, { type: "bearer" })
      .expect(404);
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "cursor=invalid",
      "owner_user_id=arbitrary",
    ])
      await request(server).get(`/v1/tickets?${query}`).auth(token, { type: "bearer" }).expect(400);
  });

  it("returns a verifiable QR payload with the current secret version and expiry", async () => {
    const order = confirmedOrder();
    await context.deliver(order);
    const ticket = (
      await context.repo.pool.query(
        "SELECT ticket.id,secret.secret_enc,secret.key_id FROM tickets ticket JOIN ticket_secrets secret ON ticket.id=secret.ticket_id WHERE order_id=$1 LIMIT 1",
        [order.data.order_id],
      )
    ).rows[0];
    const token = await context.token(order.data.user_id);
    const response = await request(context.app.getHttpServer())
      .get(`/v1/tickets/${ticket.id}/token`)
      .auth(token, { type: "bearer" })
      .expect(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.token).toMatch(/^\d{6}$/);
    expect(JSON.parse(response.body.qr_payload)).toEqual({
      version: 1,
      ticket_id: ticket.id,
      secret_version: 1,
      token: response.body.token,
    });
    const seconds = Date.parse(response.body.server_time) / 1000;
    const secret = context.secrets.decrypt(ticket.id, 1, {
      keyId: ticket.key_id,
      ciphertext: ticket.secret_enc,
    });
    expect(verifyTotp(secret, response.body.token, seconds)).toBe(true);
    expect(Date.parse(response.body.expires_at) / 1000).toBe((Math.floor(seconds / 30) + 1) * 30);
    expect(JSON.stringify(response.body)).not.toMatch(/secret_enc|key_id/);
    await request(context.app.getHttpServer())
      .get("/v1/tickets/not-a-uuid/token")
      .auth(token, { type: "bearer" })
      .expect(400);
  });

  it("rejects frozen, consumed, revoked and refunded tickets and unavailable current secrets", async () => {
    const order = confirmedOrder();
    await context.deliver(order);
    const ticket = (
      await context.repo.pool.query("SELECT id FROM tickets WHERE order_id=$1 LIMIT 1", [
        order.data.order_id,
      ])
    ).rows[0];
    const token = await context.token(order.data.user_id);
    const read = () =>
      request(context.app.getHttpServer())
        .get(`/v1/tickets/${ticket.id}/token`)
        .auth(token, { type: "bearer" });
    for (const status of ["FROZEN", "CHECKED_IN", "REVOKED", "REFUNDED"]) {
      await context.repo.pool.query("UPDATE tickets SET status=$2 WHERE id=$1", [
        ticket.id,
        status,
      ]);
      const response = await read().expect(409);
      expect(response.body.code).toBe("TICKET_NOT_ACTIVE");
    }
    await context.repo.pool.query(
      "UPDATE tickets SET status='ACTIVE', secret_version=2 WHERE id=$1",
      [ticket.id],
    );
    await read().expect(503);
    await context.repo.pool.query("UPDATE tickets SET secret_version=1 WHERE id=$1", [ticket.id]);
    await context.repo.pool.query("UPDATE ticket_secrets SET revoked_at=now() WHERE ticket_id=$1", [
      ticket.id,
    ]);
    await read().expect(503);
    await context.repo.pool.query(
      "UPDATE ticket_secrets SET revoked_at=NULL, key_id='synthetic-missing-key-id' WHERE ticket_id=$1",
      [ticket.id],
    );
    const failure = await read().expect(503);
    expect(failure.body.code).toBe("TICKET_SECRET_UNAVAILABLE");
    expect(JSON.stringify(failure.body)).not.toMatch(/synthetic-missing-key-id|AES|ciphertext/);
  });
});
