import "reflect-metadata";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import request from "supertest";
import { createLogger } from "@ticketing/common";
import { InboxProcessor, InboxRecord } from "@ticketing/outbox-inbox";
import { newMessage, Topics } from "@ticketing/event-contracts";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";
import { PaymentRepository } from "../../src/modules/payments/payment.repository";
import { PaymentService } from "../../src/modules/payments/payment.service";
import { PaymentWorker } from "../../src/messaging/payment-worker";
import { payableHandler } from "../../src/messaging/payable.handler";

export async function fixture(overrides: Record<string, unknown> = {}) {
  const pg = await new PostgreSqlContainer("postgres:16")
    .withUsername("payment_user")
    .withPassword("payment_test")
    .withDatabase("payment_db")
    .start();
  const pool = new Pool({ connectionString: pg.getConnectionUri() });
  const migrations = resolve(__dirname, "../../prisma/migrations");
  for (const dir of readdirSync(migrations).sort()) {
    if (!dir.endsWith(".toml"))
      await pool.query(readFileSync(resolve(migrations, dir, "migration.sql"), "utf8"));
  }
  await pool.end();
  const pair = await generateKeyPair("RS256");
  const rawEnv = {
    NODE_ENV: "test",
    PAYMENT_WORKERS_ENABLED: "false",
    DATABASE_URL: pg.getConnectionUri(),
    AUTH_ISSUER: "payment-test",
    AUTH_AUDIENCE: "api",
    AUTH_PUBLIC_KEY_PEM: await exportSPKI(pair.publicKey),
    MOCK_DELAY_MS: 0,
    MOCK_MAX_DELAY_MS: 0,
    MOCK_OUTCOME: "SUCCESS",
    MOCK_DUPLICATE_IPN: "true",
    VNPAY_ENABLED: "true",
    VNPAY_TMN_CODE: "TESTCODE",
    VNPAY_HASH_SECRET: "synthetic-test-secret",
    VNPAY_RETURN_URL: "https://example.test/return",
    VNPAY_IPN_URL: "https://example.test/ipn",
    ...overrides,
  };
  const env = envSchema.parse(rawEnv);
  const app = await createApp(env, createLogger("payment-test", { level: "silent" }));
  await app.init();
  const repo = app.get(PaymentRepository);
  const service = app.get(PaymentService);
  const worker = app.get(PaymentWorker);
  const dead: unknown[] = [];
  const inbox = new InboxProcessor({
    db: repo.db,
    consumerName: "payment-payables",
    handler: payableHandler,
    deadLetter: async (letter) => {
      dead.push(letter);
    },
  });
  const token = (user: string, roles: string[] = ["USER"], organizerId?: string) =>
    new SignJWT({ roles, ...(organizerId ? { organizer_id: organizerId } : {}) })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(user)
      .setIssuer("payment-test")
      .setAudience("api")
      .setExpirationTime("5m")
      .sign(pair.privateKey);
  const record = (message: unknown, topic: string = Topics.BOOKING_ORDERS): InboxRecord => ({
    topic,
    partition: 0,
    offset: "0",
    key: null,
    value: Buffer.from(JSON.stringify(message)),
  });
  return {
    app,
    repo,
    service,
    worker,
    env,
    rawEnv,
    inbox,
    dead,
    record,
    token,
    seedResale: async (
      seconds = 900,
      refId: string = randomUUID(),
      buyerId: string = randomUUID(),
    ) => {
      const message = newMessage("ResaleOrderAwaitingPayment", {
        resale_order_id: refId,
        listing_id: randomUUID(),
        buyer_id: buyerId,
        event_id: randomUUID(),
        amount_vnd: 125000,
        expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
      });
      const result = await inbox.process(record(message, Topics.RESALE_EVENTS));
      expect(result).toBe("processed");
      return { user: buyerId, order: refId, event: message.data.event_id, message };
    },
    postResale: async (
      user: string,
      order: string,
      key: string = randomUUID(),
    ): Promise<request.Response> =>
      request(app.getHttpServer())
        .post("/v1/payments")
        .set("Authorization", `Bearer ${await token(user)}`)
        .set("Idempotency-Key", key)
        .send({ resale_order_id: order, provider: "MOCK" }),
    seed: async (seconds = 900) => {
      const user = randomUUID(),
        order = randomUUID(),
        event = randomUUID();
      const message = newMessage("OrderAwaitingPayment", {
        order_id: order,
        user_id: user,
        event_id: event,
        amount_vnd: 100000,
        expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
      });
      await inbox.process(record(message));
      return { user, order, event, message };
    },
    post: async (
      user: string,
      order: string,
      key?: string,
      provider: "MOCK" | "VNPAY" = "MOCK",
    ): Promise<request.Response> => {
      const req = request(app.getHttpServer())
        .post("/v1/payments")
        .set("Authorization", `Bearer ${await token(user)}`);
      if (key !== undefined) req.set("Idempotency-Key", key);
      return req.send({ order_id: order, provider });
    },
    row: async (order: string) =>
      (
        await repo.pool.query("SELECT * FROM payments WHERE ref_id=$1 ORDER BY created_at DESC", [
          order,
        ])
      ).rows[0],
    close: async () => {
      await app.close();
      await pg.stop();
    },
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
