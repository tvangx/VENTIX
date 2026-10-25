import "reflect-metadata";
import { createLogger, loadEnv } from "@ticketing/common";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";
import { testDatabase } from "./database";

export async function testApp(overrides: Record<string, string> = {}) {
  const db = await testDatabase();
  db.seed();
  const pair = await generateKeyPair("RS256");
  const env = loadEnv(envSchema, {
    NODE_ENV: "test",
    DATABASE_URL: db.url,
    AUTH_ISSUER: "https://identity.test",
    AUTH_AUDIENCE: "ticketing-api",
    AUTH_PUBLIC_KEY_PEM: await exportSPKI(pair.publicKey),
    JWT_PRIVATE_KEY_PEM: await exportPKCS8(pair.privateKey),
    ...overrides,
  });
  const app = await createApp(env, createLogger("test", { level: "silent" }));
  await app.init();
  return {
    app,
    db,
    env,
    async close() {
      await app.close();
      await db.close();
    },
  };
}
