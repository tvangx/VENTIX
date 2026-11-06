import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import request from "supertest";
import { createLogger } from "@ticketing/common";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";
import { CheckoutService } from "../../src/checkout/checkout.service";
import { CheckoutRepository } from "../../src/checkout/checkout.repository";
import { SeatHoldRedisClient } from "../../src/seat-hold/seat-hold-redis";
import { startBookingDb } from "./booking-db";
import { startBookingRedis } from "./booking-redis";
import { handleEventLifecycle } from "../../src/messaging/event-lifecycle.handler";
import { fromPgClient } from "@ticketing/outbox-inbox";
import { lifecycleData } from "./lifecycle";
import { newMessage, parseMessage } from "@ticketing/event-contracts";
import { CheckoutDto } from "../../src/checkout/checkout.dto";

export async function checkoutFixture() {
  const db = await startBookingDb();
  const cache = await startBookingRedis();
  let calls = 0;
  let mode: "ok" | "timeout" | "invalid" = "ok";
  const server = createServer(async (req, res) => {
    calls++;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      merch_items: { sku_id: string; quantity: number }[];
    };
    if (mode === "timeout") return;
    res.setHeader("content-type", "application/json");
    const lines = body.merch_items.map((i) => ({ ...i, unit_price_vnd: 25000 }));
    res.end(
      JSON.stringify({
        lines,
        merch_amount_vnd:
          mode === "invalid" ? 1 : lines.reduce((s, i) => s + i.quantity * i.unit_price_vnd, 0),
        discount_vnd: 0,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const pair = await generateKeyPair("RS256");
  const env = envSchema.parse({
    NODE_ENV: "test",
    DATABASE_URL: db.pool.options.connectionString,
    REDIS_URL: cache.url,
    EVENT_CONSUMER_ENABLED: "false",
    REHYDRATE_ENABLED: "false",
    INTERNAL_API_KEY: "synthetic-key",
    MERCH_INTERNAL_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    MERCH_QUOTE_TIMEOUT_MS: 800,
    AUTH_ISSUER: "checkout-test",
    AUTH_AUDIENCE: "ticketing-api",
    AUTH_PUBLIC_KEY_PEM: await exportSPKI(pair.publicKey),
  });
  const app = await createApp(env, createLogger("checkout-test", { level: "silent" }));
  await app.init();
  const service = app.get(CheckoutService);
  const repository = app.get(CheckoutRepository);
  const client = app.get(SeatHoldRedisClient);
  const token = (user: string) =>
    new SignJWT({ roles: ["USER"] })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(user)
      .setIssuer("checkout-test")
      .setAudience("ticketing-api")
      .setExpirationTime("5m")
      .sign(pair.privateKey);
  return {
    db,
    cache,
    app,
    service,
    repository,
    client,
    env,
    calls: () => calls,
    mode: (value: typeof mode) => {
      mode = value;
    },
    post: async (user: string, input: CheckoutDto, key?: string): Promise<request.Response> => {
      const req = request(app.getHttpServer())
        .post("/v1/checkout")
        .set("Authorization", `Bearer ${await token(user)}`);
      if (key !== undefined) req.set("Idempotency-Key", key);
      return req.send(input);
    },
    seed: async (capacity = 100) => {
      const data = lifecycleData();
      data.ticket_classes[0].capacity = capacity;
      const ga = randomUUID();
      const classes = [
        ...data.ticket_classes,
        { ...data.ticket_classes[0], id: ga, kind: "GA" as const, price_vnd: 50000 },
      ];
      await handleEventLifecycle(
        fromPgClient(db.pool),
        parseMessage(
          newMessage("EventApproved", { ...data, ticket_classes: classes }, { version: 2 }),
        ),
      );
      const seat = randomUUID();
      await db.pool.query(
        "INSERT INTO seat_pricing(event_id,seat_id,seat_map_version,ticket_class_id) VALUES($1,$2,1,$3)",
        [data.event_id, seat, data.ticket_classes[0].id],
      );
      await db.pool.query("UPDATE event_snapshots SET pricing_ready=true WHERE event_id=$1", [
        data.event_id,
      ]);
      const user = randomUUID();
      const input = Object.assign(new CheckoutDto(), { event_id: data.event_id, seat_ids: [seat] });
      return { event: data.event_id, seat, ga, seated: data.ticket_classes[0].id, user, input };
    },
    hold: async (user: string, event: string, ids: string[]) => {
      const redis = await client.connected();
      return redis.holdSeats(
        ids.length + 1,
        `hold:{evt:${event}}:${user}`,
        ...ids.map((id) => `seat:{evt:${event}}:${id}`),
        `H:${user}`,
        60,
        1000,
        Date.now(),
        ...ids,
      );
    },
    close: async () => {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await cache.close();
      await db.close();
    },
  };
}
export type CheckoutFixture = Awaited<ReturnType<typeof checkoutFixture>>;
