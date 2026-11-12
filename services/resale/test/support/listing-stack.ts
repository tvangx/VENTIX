import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { InboxProcessor, DeadLetter } from "@ticketing/outbox-inbox";
import { ENV } from "../../../ticket/src/app.tokens";
import { Env } from "../../../ticket/src/config/env.schema";
import { confirmedOrder, fixture as ticketFixture } from "../../../ticket/test/support/ticket";
import { fixture as resaleFixture } from "./resale";
import { ListingHandler } from "../../src/messaging/listing.handler";

export async function listingStack(overrides: Record<string, unknown> = {}) {
  const key = "synthetic_s404_internal_key";
  const ticket = await ticketFixture({ INTERNAL_API_KEY: key });
  await ticket.app.listen(0, "127.0.0.1");
  const target = await ticket.app.getUrl();
  const upstream = { mode: "ok" };
  const proxy = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await fetch(`${target}${req.url}`, {
        method: req.method,
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Key": req.headers["x-internal-key"]?.toString() ?? "",
          "Idempotency-Key": req.headers["idempotency-key"]?.toString() ?? "",
          "X-Request-Id": req.headers["x-request-id"]?.toString() ?? randomUUID(),
        },
        body: Buffer.concat(chunks).toString(),
        redirect: "error",
      });
      const body = await response.text();
      if (
        (upstream.mode === "drop-freeze" && req.url?.endsWith("/freeze")) ||
        (upstream.mode === "drop-unfreeze" && req.url?.endsWith("/unfreeze"))
      ) {
        res.destroy();
        return;
      }
      res.writeHead(response.status, { "Content-Type": "application/json" });
      res.end(body);
    } catch {
      res.destroy();
    }
  });
  await new Promise<void>((accept) => proxy.listen(0, "127.0.0.1", accept));
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("Missing proxy address");
  const auth = ticket.app.get<Env>(ENV);
  const resale = await resaleFixture({
    INTERNAL_API_KEY: key,
    AUTH_ISSUER: auth.AUTH_ISSUER,
    AUTH_AUDIENCE: auth.AUTH_AUDIENCE,
    AUTH_PUBLIC_KEY_PEM: auth.AUTH_PUBLIC_KEY_PEM,
    TICKET_SERVICE_URL: `http://127.0.0.1:${address.port}`,
    ...overrides,
  });
  await resale.app.listen(0, "127.0.0.1");
  const handler = resale.app.get(ListingHandler);
  const dead: DeadLetter[] = [];
  const inbox = new InboxProcessor({
    db: resale.repo.db,
    consumerName: "resale-listings-v1",
    handler: (executor, message) => handler.handle(executor, message),
    maxAttempts: 1,
    deadLetter: async (letter) => {
      dead.push(letter);
    },
  });
  const deliver = (message: unknown) =>
    inbox.process({
      topic: "ticket.events",
      partition: 0,
      offset: "0",
      key: null,
      value: Buffer.from(JSON.stringify(message)),
    });
  async function setup() {
    const order = confirmedOrder();
    await ticket.deliver(order);
    const rows = await ticket.repo.pool.query<{ id: string }>(
      "SELECT id FROM tickets WHERE order_id=$1 AND item_type='TICKET_SEAT'",
      [order.data.order_id],
    );
    const id = rows.rows[0].id;
    const token = await ticket.token(order.data.user_id);
    const create = (ask = 120, requestKey = randomUUID(), body: Record<string, unknown> = {}) =>
      request(resale.app.getHttpServer())
        .post("/v1/listings")
        .auth(token, { type: "bearer" })
        .set("Idempotency-Key", requestKey)
        .send({ ticket_id: id, ask_price_vnd: ask, ...body });
    const cancel = (listingId: string, requestKey = randomUUID()) =>
      request(resale.app.getHttpServer())
        .post(`/v1/listings/${listingId}/cancel`)
        .auth(token, { type: "bearer" })
        .set("Idempotency-Key", requestKey)
        .send();
    const status = async () =>
      (await ticket.repo.pool.query("SELECT status FROM tickets WHERE id=$1", [id])).rows[0]
        .status as string;
    return { id, order, token, create, cancel, status };
  }
  return {
    ticket,
    resale,
    upstream,
    setup,
    deliver,
    dead,
    close: async () => {
      await resale.close();
      proxy.closeAllConnections();
      await new Promise<void>((accept) => proxy.close(() => accept()));
      await ticket.close();
    },
  };
}
