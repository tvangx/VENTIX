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
  const enabledKyc = () => ({
    ...base,
    KYC_ENABLED: "true",
    KYC_REDIS_URL: "redis://127.0.0.1:6379",
    KYC_ENCRYPTION_KEYS: JSON.stringify({ local: randomBytes(32).toString("base64") }),
    KYC_ACTIVE_KEY_ID: "local",
    KYC_HMAC_PEPPER: randomBytes(32).toString("base64"),
    KYC_SMTP_HOST: "127.0.0.1",
    KYC_SMTP_FROM: "identity@ventix.test",
  });
  it("requires KYC crypto, Redis and SMTP configuration when enabled", () => {
    expect(() => envSchema.parse({ ...base, KYC_ENABLED: "true" })).toThrow();
    expect(envSchema.parse(enabledKyc()).KYC_OTP_TTL_SECONDS).toBe(300);
    expect(() => envSchema.parse({ ...enabledKyc(), KYC_ACTIVE_KEY_ID: "missing" })).toThrow();
    expect(() => envSchema.parse({ ...enabledKyc(), KYC_HMAC_PEPPER: "short" })).toThrow();
    expect(() => envSchema.parse({ ...enabledKyc(), KYC_SMTP_PASSWORD: "only-one" })).toThrow();
    expect(() =>
      envSchema.parse({ ...enabledKyc(), KYC_REDIS_URL: "https://example.com" }),
    ).toThrow();
  });
  it("requires SMTP TLS in production", () => {
    expect(() =>
      envSchema.parse({
        ...enabledKyc(),
        NODE_ENV: "production",
        JWT_PRIVATE_KEY_PEM: "synthetic-key",
      }),
    ).toThrow(/TLS/);
    expect(
      envSchema.parse({
        ...enabledKyc(),
        NODE_ENV: "production",
        JWT_PRIVATE_KEY_PEM: "synthetic-key",
        KYC_SMTP_REQUIRE_TLS: "true",
      }).KYC_ENABLED,
    ).toBe("true");
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

  it("requires a persistent signing key in production", () => {
    expect(() => loadEnv(envSchema, { ...base, NODE_ENV: "production" })).toThrow(
      /JWT_PRIVATE_KEY_PEM/,
    );
  });
});
