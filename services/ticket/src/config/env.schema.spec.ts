import { loadEnv } from "@ticketing/common";
import { envSchema } from "./env.schema";
import { randomBytes } from "node:crypto";

const base = {
  DATABASE_URL: "postgresql://svc_user:svc_dev@localhost:5432/svc_db",
  AUTH_ISSUER: "https://identity.test",
  AUTH_AUDIENCE: "ticketing-api",
  AUTH_JWKS_URI: "http://localhost:3001/.well-known/jwks.json",
  PORT: "3099",
};

describe("envSchema", () => {
  it("validates NFT timeouts, retries and provider independently from ticket secrets", () => {
    expect(envSchema.parse({ ...base, NFT_WORKER_ENABLED: "true" }).NFT_PROVIDER).toBe("MOCK");
    for (const invalid of [
      { NFT_MAX_ATTEMPTS: 0 },
      { NFT_MAX_ATTEMPTS: 21 },
      { NFT_POLL_MS: 0 },
      { NFT_TIMEOUT_MS: 30000, NFT_LEASE_MS: 30000 },
      { NFT_RETRY_BASE_MS: 1000, NFT_RETRY_MAX_MS: 100 },
      { NFT_PROVIDER: "AMOY" },
    ])
      expect(() => envSchema.parse({ ...base, ...invalid })).toThrow();
  });
  it("requires an active 256-bit key before enabling ticket issuance", () => {
    expect(() => envSchema.parse({ ...base, TICKET_WORKERS_ENABLED: "true" })).toThrow();
    const keys = JSON.stringify({ local: randomBytes(32).toString("base64") });
    expect(
      envSchema.parse({
        ...base,
        TICKET_WORKERS_ENABLED: "true",
        TICKET_ENCRYPTION_KEYS: keys,
        TICKET_ACTIVE_KEY_ID: "local",
      }).TICKET_ACTIVE_KEY_ID,
    ).toBe("local");
    expect(() =>
      envSchema.parse({ ...base, TICKET_ENCRYPTION_KEYS: keys, TICKET_ACTIVE_KEY_ID: "missing" }),
    ).toThrow();
    for (const invalid of ["not-json", JSON.stringify({ local: "short" }), "{}", "[]"]) {
      expect(() =>
        envSchema.parse({
          ...base,
          TICKET_ENCRYPTION_KEYS: invalid,
          TICKET_ACTIVE_KEY_ID: "local",
        }),
      ).toThrow();
    }
  });
  it("accepts a valid configuration and applies defaults", () => {
    const env = loadEnv(envSchema, base);
    expect(env.PORT).toBe(3099);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it("fails fast when DATABASE_URL is missing", () => {
    expect(() => loadEnv(envSchema, { ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it("requires JWKS or a public key", () => {
    expect(() => loadEnv(envSchema, { ...base, AUTH_JWKS_URI: undefined })).toThrow(
      /AUTH_JWKS_URI/,
    );
  });

  it("rejects AUTH_PUBLIC_KEY_PEM in production", () => {
    expect(() =>
      loadEnv(envSchema, {
        ...base,
        NODE_ENV: "production",
        AUTH_PUBLIC_KEY_PEM: "pem",
        AUTH_JWKS_URI: undefined,
      }),
    ).toThrow(/AUTH_PUBLIC_KEY_PEM/);
  });
});
