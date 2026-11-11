import "reflect-metadata";
import { createLogger, loadEnv } from "@ticketing/common";
import { randomUUID } from "node:crypto";
import { SignJWT, exportSPKI, generateKeyPair } from "jose";
import request from "supertest";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";
import { testDatabase } from "./database";

export const VENUES = "/v1/organizer/venues";
export const EVENTS = "/v1/organizer/events";
export const venueInput = { name: "Test venue", address: "Test address", capacity: 100 };

export function eventInput(venueId: string) {
  return {
    venue_id: venueId,
    title: "Test event",
    description: "Test description",
    start_at: "2030-01-01T18:00:00Z",
    end_at: "2030-01-01T20:00:00Z",
  };
}

export async function organizerApp({
  kafkaBrokers,
  redisUrl,
  internalApiKey,
}: { kafkaBrokers?: string[]; redisUrl?: string; internalApiKey?: string } = {}) {
  const db = await testDatabase();
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const env = loadEnv(envSchema, {
    NODE_ENV: "test",
    ...(kafkaBrokers && { KAFKA_BROKERS: kafkaBrokers.join(","), EVENT_OUTBOX_ENABLED: "true" }),
    DATABASE_URL: db.url,
    ...(redisUrl && { REDIS_URL: redisUrl }),
    ...(internalApiKey && { INTERNAL_API_KEY: internalApiKey }),
    AUTH_ISSUER: "https://identity.test",
    AUTH_AUDIENCE: "ticketing-api",
    AUTH_PUBLIC_KEY_PEM: await exportSPKI(publicKey),
  });
  const app = await createApp(env, createLogger("test", { level: "silent" }));
  await app.listen(0, "127.0.0.1");
  return {
    db,
    nest: app,
    http: request(await app.getUrl()),
    token(organizerId?: string, roles = ["ORGANIZER"]) {
      return new SignJWT({ roles, organizer_id: organizerId })
        .setProtectedHeader({ alg: "RS256" })
        .setSubject(randomUUID())
        .setIssuer(env.AUTH_ISSUER)
        .setAudience(env.AUTH_AUDIENCE)
        .setExpirationTime("5m")
        .sign(privateKey);
    },
    async close() {
      await app.close();
      await db.close();
    },
  };
}
