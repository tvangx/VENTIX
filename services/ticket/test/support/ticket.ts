import "reflect-metadata";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { createLogger } from "@ticketing/common";
import { newMessage } from "@ticketing/event-contracts";
import { DeadLetter, InboxProcessor } from "@ticketing/outbox-inbox";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";
import { TicketRepository } from "../../src/modules/tickets/ticket.repository";
import { TicketSecrets } from "../../src/modules/tickets/ticket-secrets";
import { TicketHandler } from "../../src/messaging/ticket.handler";

export function confirmedOrder() {
  return newMessage(
    "OrderConfirmed",
    {
      order_id: randomUUID(),
      user_id: randomUUID(),
      event_id: randomUUID(),
      payment_id: randomUUID(),
      items: [
        {
          order_item_id: randomUUID(),
          item_type: "TICKET_SEAT" as const,
          ref_id: randomUUID(),
          quantity: 1,
          unit_price_vnd: 100,
        },
        {
          order_item_id: randomUUID(),
          item_type: "TICKET_GA" as const,
          ref_id: randomUUID(),
          quantity: 3,
          unit_price_vnd: 50,
        },
        {
          order_item_id: randomUUID(),
          item_type: "MERCH" as const,
          ref_id: randomUUID(),
          quantity: 2,
          unit_price_vnd: 25,
        },
      ],
      ticket_amount_vnd: 250,
      merch_amount_vnd: 50,
      total_amount_vnd: 300,
      confirmed_at: "2026-11-11T00:00:00.000Z",
    },
    { trace_id: "s301-synthetic-trace", tenant_id: randomUUID() },
  );
}

export async function fixture(overrides: Record<string, unknown> = {}) {
  const container = await new PostgreSqlContainer("postgres:16")
    .withUsername("ticket_migrator")
    .withPassword("synthetic_test")
    .withDatabase("ticket_db")
    .start();
  const admin = new Pool({ connectionString: container.getConnectionUri() });
  await admin.query(
    "CREATE ROLE ticket_user LOGIN PASSWORD 'synthetic_test' NOSUPERUSER NOCREATEDB NOCREATEROLE",
  );
  await admin.query("GRANT USAGE, CREATE ON SCHEMA public TO ticket_user");
  const databaseUrl = new URL(container.getConnectionUri());
  databaseUrl.username = "ticket_user";
  const migrationPool = new Pool({ connectionString: databaseUrl.toString() });
  const directory = resolve(__dirname, "../../prisma/migrations");
  for (const entry of readdirSync(directory).sort()) {
    if (!entry.endsWith(".toml"))
      await migrationPool.query(readFileSync(resolve(directory, entry, "migration.sql"), "utf8"));
  }
  await migrationPool.end();
  const pair = await generateKeyPair("RS256");
  const env = envSchema.parse({
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl.toString(),
    AUTH_ISSUER: "ticket-test",
    AUTH_AUDIENCE: "api",
    AUTH_PUBLIC_KEY_PEM: await exportSPKI(pair.publicKey),
    TICKET_ENCRYPTION_KEYS: JSON.stringify({ test: randomBytes(32).toString("base64") }),
    TICKET_ACTIVE_KEY_ID: "test",
    TICKET_WORKERS_ENABLED: "false",
    ...overrides,
  });
  const app = await createApp(env, createLogger("ticket-test", { level: "silent" }));
  await app.init();
  const repo = app.get(TicketRepository);
  const handler = app.get(TicketHandler);
  const secrets = app.get(TicketSecrets);
  const dead: DeadLetter[] = [];
  const inbox = new InboxProcessor({
    db: repo.db,
    consumerName: "ticket-issuance-v1",
    handler: (executor, message) => handler.handle(executor, message),
    maxAttempts: 1,
    deadLetter: async (letter) => {
      dead.push(letter);
    },
  });
  const deliver = (message: unknown) =>
    inbox.process({
      topic: "booking.orders",
      partition: 0,
      offset: "0",
      key: null,
      value: Buffer.from(JSON.stringify(message)),
    });
  return {
    app,
    repo,
    handler,
    secrets,
    dead,
    deliver,
    admin,
    token: (userId: string, roles = ["USER"], organizerId?: string) =>
      new SignJWT({ roles, ...(organizerId ? { organizer_id: organizerId } : {}) })
        .setProtectedHeader({ alg: "RS256" })
        .setSubject(userId)
        .setIssuer("ticket-test")
        .setAudience("api")
        .setExpirationTime("5m")
        .sign(pair.privateKey),
    close: async () => {
      await app.close();
      await admin.end();
      await container.stop();
    },
  };
}
