import request from "supertest";
import { randomUUID } from "node:crypto";
import { NftRepository } from "../../src/modules/nft/nft.repository";
import { NftRunner } from "../../src/modules/nft/nft-runner";
import { MockMinter } from "../../src/modules/nft/minter";
import { fixture } from "../support/ticket";
import { issuedTicket, nftInbox } from "../support/nft";

describe("S-503 public ticket verification", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  let ticketId: string;
  beforeAll(async () => {
    context = await fixture({ VERIFY_RATE_PER_PEER: 100, VERIFY_RATE_TOTAL: 1000 });
    const { message } = await issuedTicket(context);
    ticketId = message.data.ticket_id;
  });
  afterAll(async () => {
    await context?.close();
  });
  beforeEach(async () => {
    await context.repo.pool.query("UPDATE tickets SET status='ACTIVE' WHERE id=$1", [ticketId]);
  });

  it("allows anonymous lookup, returns only public fields and keeps auth on private routes", async () => {
    const response = await request(context.app.getHttpServer())
      .get(`/v1/public/tickets/${ticketId}`)
      .expect(200);
    expect(response.body).toEqual({
      ticket_id: ticketId,
      status: "ACTIVE",
      active: true,
      nft: { status: "NOT_REQUESTED", provider: null, token_id: null, tx_hash: null },
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toContain("noindex");
    await request(context.app.getHttpServer()).get("/v1/whoami").expect(401);
  });
  it.each(["FROZEN", "CHECKED_IN", "REVOKED", "REFUNDED"])(
    "reads current %s state without cached ACTIVE validity",
    async (status) => {
      await context.repo.pool.query("UPDATE tickets SET status=$2 WHERE id=$1", [ticketId, status]);
      const response = await request(context.app.getHttpServer())
        .get(`/v1/public/tickets/${ticketId}`)
        .expect(200);
      expect(response.body.status).toBe(status);
      expect(response.body.active).toBe(false);
    },
  );
  it("distinguishes mocked mint from a blockchain transaction", async () => {
    const { message } = await issuedTicket(context);
    await nftInbox(context).deliver(message);
    const path = `/v1/public/tickets/${message.data.ticket_id}`;
    expect((await request(context.app.getHttpServer()).get(path).expect(200)).body.nft.status).toBe(
      "PENDING",
    );
    await new NftRunner(new NftRepository(context.repo), new MockMinter(), {
      maxAttempts: 1,
      leaseMs: 30000,
      timeoutMs: 1000,
      retryBaseMs: 100,
      retryMaxMs: 1000,
    }).runOnce();
    const response = await request(context.app.getHttpServer()).get(path).expect(200);
    expect(response.body.nft).toMatchObject({ status: "MINTED", provider: "MOCK", tx_hash: null });
    const html = await request(context.app.getHttpServer())
      .get(`/v1/verify?ticket_id=${message.data.ticket_id}`)
      .expect(200);
    expect(html.text).toContain("Mô phỏng local");
    expect(html.text).not.toContain("polygonscan");
  });
  it("keeps an active ticket active when mint failed", async () => {
    const { message } = await issuedTicket(context);
    await nftInbox(context).deliver(message);
    await new NftRunner(
      new NftRepository(context.repo),
      {
        mint: async () => {
          throw new Error("down");
        },
      },
      { maxAttempts: 1, leaseMs: 30000, timeoutMs: 1000, retryBaseMs: 100, retryMaxMs: 1000 },
    ).runOnce();
    const response = await request(context.app.getHttpServer())
      .get(`/v1/public/tickets/${message.data.ticket_id}`)
      .expect(200);
    expect(response.body.active).toBe(true);
    expect(response.body.nft.status).toBe("FAILED");
  });
  it("validates UUID and returns problem JSON for unknown tickets", async () => {
    await request(context.app.getHttpServer())
      .get("/v1/public/tickets/not-a-uuid")
      .expect(400)
      .expect("Content-Type", /problem\+json/);
    await request(context.app.getHttpServer())
      .get(`/v1/public/tickets/${randomUUID()}`)
      .expect(404)
      .expect("Content-Type", /problem\+json/);
  });
  it("renders a usable no-script form and does not reflect HTML payloads", async () => {
    const empty = await request(context.app.getHttpServer()).get("/v1/verify").expect(200);
    expect(empty.text).toContain('name="ticket_id"');
    expect(empty.text).toContain("Tra cứu vé");
    expect(empty.headers["content-security-policy"]).toBeDefined();
    const invalid = await request(context.app.getHttpServer())
      .get("/v1/verify")
      .query({ ticket_id: '<script>alert("xss")</script>' })
      .expect(400);
    expect(invalid.text).not.toContain("<script>");
  });
});
