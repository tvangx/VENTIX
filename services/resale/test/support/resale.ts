import "reflect-metadata";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Pool } from "pg";
import { exportSPKI, generateKeyPair, jwtVerify, SignJWT } from "jose";
import { createLogger } from "@ticketing/common";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";
import { ListingRepository } from "../../src/modules/listings/listing.repository";

export async function fixture(overrides: Record<string, unknown> = {}) {
  const container = await new PostgreSqlContainer("postgres:16")
    .withUsername("resale_migrator")
    .withPassword("synthetic_test")
    .withDatabase("resale_db")
    .start();
  const admin = new Pool({ connectionString: container.getConnectionUri() });
  await admin.query(
    "CREATE ROLE resale_user LOGIN PASSWORD 'synthetic_test' NOSUPERUSER NOCREATEDB NOCREATEROLE; GRANT USAGE,CREATE ON SCHEMA public TO resale_user",
  );
  const databaseUrl = new URL(container.getConnectionUri());
  databaseUrl.username = "resale_user";
  const migration = new Pool({ connectionString: databaseUrl.toString() });
  const directory = resolve(__dirname, "../../prisma/migrations");
  for (const entry of readdirSync(directory).sort())
    if (!entry.endsWith(".toml"))
      await migration.query(readFileSync(resolve(directory, entry, "migration.sql"), "utf8"));
  await migration.end();
  const pair = await generateKeyPair("RS256");
  const tickets: {
    id: string;
    event_id: string;
    status: string;
    unit_price_vnd: string;
    owner: string;
  }[] = [];
  const upstream = { mode: "ok", requests: 0 };
  const server = createServer(async (req, res) => {
    upstream.requests++;
    if (upstream.mode === "hang") return;
    if (upstream.mode === "error") {
      res.writeHead(500);
      res.end();
      return;
    }
    if (upstream.mode === "redirect") {
      res.writeHead(302, { Location: "/different-host" });
      res.end();
      return;
    }
    if (upstream.mode === "invalid") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    try {
      const result = await jwtVerify(req.headers.authorization?.slice(7) ?? "", pair.publicKey, {
        algorithms: ["RS256"],
        issuer: "resale-test",
        audience: "api",
      });
      const cursor = new URL(req.url ?? "/", "http://localhost").searchParams.get("cursor");
      const owned = tickets
        .filter((ticket) => ticket.owner === result.payload.sub && (!cursor || ticket.id > cursor))
        .sort((first, second) => first.id.localeCompare(second.id));
      const items = owned.slice(0, 100).map(({ owner: _owner, ...ticket }) => ticket);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items, next_cursor: owned.length > 100 ? items[99].id : null }));
    } catch {
      res.writeHead(401);
      res.end();
    }
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  const env = envSchema.parse({
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl.toString(),
    AUTH_ISSUER: "resale-test",
    AUTH_AUDIENCE: "api",
    AUTH_PUBLIC_KEY_PEM: await exportSPKI(pair.publicKey),
    TICKET_SERVICE_URL: `http://127.0.0.1:${address.port}`,
    ...overrides,
  });
  const app = await createApp(env, createLogger("resale-test", { level: "silent" }));
  await app.init();
  const repo = app.get(ListingRepository);
  const token = (userId: string) =>
    new SignJWT({ roles: ["USER"] })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(userId)
      .setIssuer("resale-test")
      .setAudience("api")
      .setExpirationTime("5m")
      .sign(pair.privateKey);
  const insert = (ticketId = randomUUID(), sellerId = randomUUID(), price = 120) =>
    repo.pool.query(
      "INSERT INTO listings (id,ticket_id,seller_id,event_id,original_price_vnd,ask_price_vnd,status) VALUES ($1,$2,$3,$4,100,$5,'ACTIVE') RETURNING id",
      [randomUUID(), ticketId, sellerId, randomUUID(), price],
    );
  return {
    app,
    repo,
    admin,
    tickets,
    upstream,
    token,
    insert,
    close: async () => {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((accept) => server.close(() => accept()));
      await admin.end();
      await container.stop();
    },
  };
}
