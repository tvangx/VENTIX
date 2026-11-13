import { randomUUID } from "node:crypto";
import request from "supertest";
import { fixture } from "../support/resale";

describe("S-304 listing schema and quote API", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture();
  });
  afterAll(async () => {
    await context?.close();
  });

  it("uses the owned ticket server price and rejects prices over 120 percent", async () => {
    const owner = randomUUID();
    const ticket = {
      id: randomUUID(),
      event_id: randomUUID(),
      status: "ACTIVE",
      unit_price_vnd: "101",
      owner,
    };
    context.tickets.push(ticket);
    const token = await context.token(owner);
    const quote = (body: Record<string, unknown>) =>
      request(context.app.getHttpServer())
        .post("/v1/listings/quote")
        .auth(token, { type: "bearer" })
        .send(body);
    await request(context.app.getHttpServer())
      .post("/v1/listings/quote")
      .send({ ticket_id: ticket.id, ask_price_vnd: 121 })
      .expect(401);
    const allowed = await quote({ ticket_id: ticket.id, ask_price_vnd: 121 }).expect(200);
    expect(allowed.body).toMatchObject({
      original_price_vnd: "101",
      maximum_price_vnd: "121",
      max_percent: 120,
    });
    expect(allowed.headers["cache-control"]).toBe("private, no-store");
    await quote({ ticket_id: ticket.id, ask_price_vnd: 122 }).expect(422);
    await quote({ ticket_id: ticket.id, ask_price_vnd: 120, original_price_vnd: 999999 }).expect(
      400,
    );
    await quote({ ticket_id: ticket.id, ask_price_vnd: -1 }).expect(400);
    await quote({ ticket_id: ticket.id, ask_price_vnd: 1.5 }).expect(400);
    const stranger = await context.token(randomUUID());
    await request(context.app.getHttpServer())
      .post("/v1/listings/quote")
      .auth(stranger, { type: "bearer" })
      .send({ ticket_id: ticket.id, ask_price_vnd: 100 })
      .expect(404);
    ticket.status = "FROZEN";
    await quote({ ticket_id: ticket.id, ask_price_vnd: 100 }).expect(409);
    expect((await context.repo.pool.query("SELECT * FROM listings")).rowCount).toBe(0);
  });

  it("follows Ticket pagination and applies a stricter event price cap", async () => {
    const owner = randomUUID();
    const tickets = Array.from({ length: 101 }, () => ({
      id: randomUUID(),
      event_id: randomUUID(),
      status: "ACTIVE",
      unit_price_vnd: "100",
      owner,
    })).sort((first, second) => first.id.localeCompare(second.id));
    context.tickets.push(...tickets);
    const ticket = tickets[100];
    await context.repo.pool.query(
      "INSERT INTO price_cap_rules (event_id,max_percent) VALUES ($1,110)",
      [ticket.event_id],
    );
    const token = await context.token(owner);
    const count = context.upstream.requests;
    await request(context.app.getHttpServer())
      .post("/v1/listings/quote")
      .auth(token, { type: "bearer" })
      .send({ ticket_id: ticket.id, ask_price_vnd: 111 })
      .expect(422);
    expect(context.upstream.requests - count).toBe(2);
  });

  it("fails closed on upstream errors, redirects, invalid payload and timeout", async () => {
    const token = await context.token(randomUUID());
    try {
      for (const mode of ["error", "redirect", "invalid", "hang"]) {
        context.upstream.mode = mode;
        const response = await request(context.app.getHttpServer())
          .post("/v1/listings/quote")
          .auth(token, { type: "bearer" })
          .send({ ticket_id: randomUUID(), ask_price_vnd: 100 })
          .expect(503);
        expect(response.body.code).toBe("TICKET_SERVICE_UNAVAILABLE");
        expect(JSON.stringify(response.body)).not.toContain(token);
      }
    } finally {
      context.upstream.mode = "ok";
    }
  });

  it("enforces schema checks and seller-only cursor pagination", async () => {
    await expect(context.insert(randomUUID(), randomUUID(), 121)).rejects.toMatchObject({
      code: "23514",
    });
    const seller = randomUUID();
    await context.insert(randomUUID(), seller);
    await context.insert(randomUUID(), seller);
    await context.insert();
    const token = await context.token(seller);
    const first = await request(context.app.getHttpServer())
      .get("/v1/listings/me?limit=1")
      .auth(token, { type: "bearer" })
      .expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.next_cursor).toBe(first.body.items[0].id);
    const second = await request(context.app.getHttpServer())
      .get(`/v1/listings/me?limit=1&cursor=${first.body.next_cursor}`)
      .auth(token, { type: "bearer" })
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.next_cursor).toBeNull();
    await request(context.app.getHttpServer())
      .get("/v1/listings/me?limit=101")
      .auth(token, { type: "bearer" })
      .expect(400);
    await expect(
      context.repo.pool.query(
        "INSERT INTO price_cap_rules (event_id,max_percent) VALUES ($1,121)",
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
