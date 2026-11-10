import "reflect-metadata";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { createLogger } from "@ticketing/common";
import { InboxProcessor, InboxRecord } from "@ticketing/outbox-inbox";
import { newMessage } from "@ticketing/event-contracts";
import { envSchema } from "../../src/config/env.schema";
import { createApp } from "../../src/bootstrap";
import { FinanceRepository } from "../../src/modules/finance.repository";
import { FinanceHandler } from "../../src/messaging/finance.handler";
import { AuditService } from "../../src/modules/audit/audit.service";

export async function fixture(runtimeOwnsSchema = false, overrides: Record<string, unknown> = {}) {
  // Bootstrap/migration riêng; mọi code service và kiểm chứng trực tiếp dùng role NOSUPERUSER.
  const container = await new PostgreSqlContainer("postgres:16")
    .withUsername("finance_migrator")
    .withPassword("synthetic_test")
    .withDatabase("finance_db")
    .start();
  const admin = new Pool({ connectionString: container.getConnectionUri() });
  await admin.query(
    "CREATE ROLE finance_user LOGIN PASSWORD 'finance_test' NOSUPERUSER NOCREATEDB NOCREATEROLE",
  );
  if (runtimeOwnsSchema) {
    await admin.query("GRANT USAGE,CREATE ON SCHEMA public TO finance_user");
    await admin.query("SET ROLE finance_user");
  }
  const directory = resolve(__dirname, "../../prisma/migrations");
  for (const dir of readdirSync(directory).sort()) {
    if (!dir.endsWith(".toml"))
      await admin.query(readFileSync(resolve(directory, dir, "migration.sql"), "utf8"));
  }
  if (runtimeOwnsSchema) await admin.query("RESET ROLE");
  await admin.query(
    "GRANT USAGE ON SCHEMA public TO finance_user; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO finance_user; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO finance_user",
  );
  await admin.query("REVOKE UPDATE,DELETE,TRUNCATE ON ledger_entries,audit_logs FROM finance_user");
  const url = new URL(container.getConnectionUri());
  url.username = "finance_user";
  url.password = "finance_test";
  const pair = await generateKeyPair("RS256");
  const env = envSchema.parse({
    NODE_ENV: "test",
    DATABASE_URL: url.toString(),
    AUTH_ISSUER: "finance-test",
    AUTH_AUDIENCE: "api",
    AUTH_PUBLIC_KEY_PEM: await exportSPKI(pair.publicKey),
    FINANCE_WORKERS_ENABLED: "false",
    ...overrides,
  });
  const app = await createApp(env, createLogger("finance-test", { level: "silent" }));
  await app.init();
  const repo = app.get(FinanceRepository),
    handler = app.get(FinanceHandler),
    audit = app.get(AuditService);
  const dead: unknown[] = [];
  const inbox = new InboxProcessor({
    db: repo.db,
    consumerName: "finance-v1",
    handler: (e, m) => handler.handle(e, m),
    maxAttempts: 1,
    deadLetter: async (letter) => {
      dead.push(letter);
    },
  });
  const record = (message: unknown): InboxRecord => ({
    topic: "booking.orders",
    partition: 0,
    offset: "0",
    key: null,
    value: Buffer.from(JSON.stringify(message)),
  });
  const deliver = async (message: unknown) => {
    const outcome = await inbox.process(record(message));
    if (outcome === "dead-lettered")
      throw new Error(
        `Unexpected DLQ: ${String((dead[dead.length - 1] as { error: string }).error)}`,
      );
    return outcome;
  };
  const token = (roles: string[], organizerId?: string) =>
    new SignJWT({ roles, organizer_id: organizerId })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(randomUUID())
      .setIssuer("finance-test")
      .setAudience("api")
      .setExpirationTime("5m")
      .sign(pair.privateKey);
  const seed = async (seated = false) => {
    const event = randomUUID(),
      organizer = randomUUID(),
      ticketClass = randomUUID(),
      seat = randomUUID();
    await deliver(
      newMessage(
        "EventApproved",
        {
          event_id: event,
          organizer_id: organizer,
          title: "Synthetic",
          start_at: "2027-01-01T00:00:00.000Z",
          end_at: "2027-01-02T00:00:00.000Z",
          event_version: 1,
          seat_map_version: 1,
          ticket_classes: [
            {
              id: ticketClass,
              name: "A",
              price_vnd: 110,
              capacity: 1000,
              kind: seated ? "SEATED" : "GA",
            },
          ],
          sale_phases: [],
        },
        { version: 2 },
      ),
    );
    const order = newMessage("OrderConfirmed", {
      order_id: randomUUID(),
      user_id: randomUUID(),
      event_id: event,
      payment_id: randomUUID(),
      items: [
        {
          order_item_id: randomUUID(),
          item_type: seated ? "TICKET_SEAT" : "TICKET_GA",
          ref_id: seated ? seat : ticketClass,
          quantity: 1,
          unit_price_vnd: 110,
        },
        {
          order_item_id: randomUUID(),
          item_type: "MERCH",
          ref_id: randomUUID(),
          quantity: 2,
          unit_price_vnd: 55,
        },
      ],
      ticket_amount_vnd: 110,
      merch_amount_vnd: 110,
      total_amount_vnd: 220,
      confirmed_at: "2026-11-10T00:00:00.000Z",
    });
    const refund = (amount = 220) =>
      newMessage("RefundCompleted", {
        refund_id: randomUUID(),
        payment_id: order.data.payment_id,
        order_id: order.data.order_id,
        amount_vnd: amount,
      });
    return { event, organizer, ticketClass, seat, order, refund };
  };
  return {
    app,
    repo,
    handler,
    audit,
    admin,
    container,
    env,
    inbox,
    record,
    deliver,
    dead,
    token,
    seed,
    close: async () => {
      await app.close();
      await admin.end();
      await container.stop();
    },
  };
}
