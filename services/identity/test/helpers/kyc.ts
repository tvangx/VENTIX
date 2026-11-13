import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import { Pool } from "pg";
import Redis from "ioredis";
import { exportPKCS8, exportSPKI, generateKeyPair, SignJWT } from "jose";
import { z } from "zod";
import request from "supertest";
import { createLogger } from "@ticketing/common";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";
import { KycCrypto } from "../../src/modules/kyc/kyc-crypto";

const mailList = z.object({
  messages: z.array(z.object({ ID: z.string(), To: z.array(z.object({ Address: z.string() })) })),
});
const mailBody = z.object({ Text: z.string() });

export async function kycFixture(overrides: Record<string, unknown> = {}) {
  const database = await new PostgreSqlContainer("postgres:16")
    .withUsername("identity_migrator")
    .withPassword("synthetic_test")
    .withDatabase("identity_db")
    .start();
  const admin = new Pool({ connectionString: database.getConnectionUri() });
  await admin.query(
    "CREATE ROLE identity_user LOGIN PASSWORD 'synthetic_test' NOSUPERUSER NOCREATEDB NOCREATEROLE; GRANT USAGE,CREATE ON SCHEMA public TO identity_user",
  );
  const databaseUrl = new URL(database.getConnectionUri());
  databaseUrl.username = "identity_user";
  const pool = new Pool({ connectionString: databaseUrl.toString(), max: 10 });
  const directory = resolve(__dirname, "../../prisma/migrations");
  for (const entry of readdirSync(directory).sort())
    if (!entry.endsWith(".toml"))
      await pool.query(readFileSync(resolve(directory, entry, "migration.sql"), "utf8"));
  const redisContainer = await new GenericContainer("redis:7.4-alpine")
    .withExposedPorts(6379)
    .start();
  const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const mailpit = await new GenericContainer(
    process.env.KYC_TEST_MAILPIT_IMAGE ?? "axllent/mailpit:v1.33.0",
  )
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp("/livez", 8025))
    .start();
  const mailUrl = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`;
  let mailpitStopped = false;
  const stopMail = async () => {
    if (!mailpitStopped) {
      await mailpit.stop();
      mailpitStopped = true;
    }
  };
  const pair = await generateKeyPair("RS256");
  const env = envSchema.parse({
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl.toString(),
    AUTH_ISSUER: "https://identity.test",
    AUTH_AUDIENCE: "ticketing-api",
    AUTH_PUBLIC_KEY_PEM: await exportSPKI(pair.publicKey),
    JWT_PRIVATE_KEY_PEM: await exportPKCS8(pair.privateKey),
    KYC_ENABLED: "true",
    KYC_REDIS_URL: redisUrl,
    KYC_ENCRYPTION_KEYS: JSON.stringify({ test: randomBytes(32).toString("base64") }),
    KYC_ACTIVE_KEY_ID: "test",
    KYC_HMAC_PEPPER: randomBytes(32).toString("base64"),
    KYC_SMTP_HOST: mailpit.getHost(),
    KYC_SMTP_PORT: mailpit.getMappedPort(1025),
    KYC_SMTP_FROM: "identity@ventix.test",
    INTERNAL_API_KEY: "synthetic-internal-key-kyc",
    ...overrides,
  });
  const app = await createApp(env, createLogger("kyc-test", { level: "silent" }));
  await app.init();
  const token = (userId: string) =>
    new SignJWT({ roles: ["USER"] })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(userId)
      .setIssuer("https://identity.test")
      .setAudience("ticketing-api")
      .setExpirationTime("10m")
      .sign(pair.privateKey);
  const user = async () => {
    const id = randomUUID();
    const email = `kyc-${id}@ventix.test`;
    await pool.query(
      "INSERT INTO users (id,email,status,updated_at) VALUES ($1,$2,'ACTIVE',now())",
      [id, email],
    );
    return { id, email, token: await token(id) };
  };
  const latestCode = async (email: string): Promise<string> => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const messages = mailList.parse(
        await (await fetch(`${mailUrl}/api/v1/messages`)).json(),
      ).messages;
      const message = messages.find((entry) =>
        entry.To.some((recipient) => recipient.Address === email),
      );
      if (message) {
        const body = mailBody.parse(
          await (await fetch(`${mailUrl}/api/v1/message/${message.ID}`)).json(),
        );
        const code = body.Text.match(/\b\d{6}\b/)?.[0];
        if (code) return code;
      }
      await new Promise((accept) => setTimeout(accept, 25));
    }
    throw new Error("No synthetic OTP received in Mailpit");
  };
  const challenge = (userToken: string, identityNumber: string, key = randomUUID()) =>
    request(app.getHttpServer())
      .post("/v1/kyc/challenges")
      .auth(userToken, { type: "bearer" })
      .set("Idempotency-Key", key)
      .send({ id_number: identityNumber, full_name: "Synthetic Test Person" });
  const verify = (userToken: string, challengeId: string, code: string, key = randomUUID()) =>
    request(app.getHttpServer())
      .post("/v1/kyc/verify")
      .auth(userToken, { type: "bearer" })
      .set("Idempotency-Key", key)
      .send({ challenge_id: challengeId, code });
  return {
    app,
    admin,
    pool,
    redis,
    env,
    mailUrl,
    mailpit,
    stopMail,
    user,
    token,
    latestCode,
    challenge,
    verify,
    crypto: app.get(KycCrypto),
    close: async () => {
      await app.close();
      await redis.quit();
      await pool.end();
      await admin.end();
      await stopMail();
      await redisContainer.stop();
      await database.stop();
    },
  };
}
