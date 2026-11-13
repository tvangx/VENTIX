import { loadEnv } from "@ticketing/common";
import { envSchema } from "./env.schema";

const base = {
  DATABASE_URL: "postgresql://svc_user:svc_dev@localhost:5432/svc_db",
  AUTH_ISSUER: "https://identity.test",
  AUTH_AUDIENCE: "ticketing-api",
  AUTH_JWKS_URI: "http://localhost:3001/.well-known/jwks.json",
  PORT: "3099",
};

describe("envSchema", () => {
  it("validates invoice retry and lease bounds and defaults worker off", () => {
    expect(loadEnv(envSchema, base).INVOICE_WORKER_ENABLED).toBe("false");
    expect(() => loadEnv(envSchema, { ...base, INVOICE_LEASE_MS: "5000" })).toThrow(
      /INVOICE_LEASE_MS/,
    );
    expect(() => loadEnv(envSchema, { ...base, INVOICE_RETRY_MAX_MS: "10" })).toThrow(
      /INVOICE_RETRY_MAX_MS/,
    );
    expect(() => loadEnv(envSchema, { ...base, INVOICE_MAX_ATTEMPTS: "0" })).toThrow(
      /INVOICE_MAX_ATTEMPTS/,
    );
  });
  it("từ chối VAT-exclusive theo quyết định T-402, không coi chuỗi false là truthy", () => {
    expect(() => loadEnv(envSchema, { ...base, PRICES_INCLUDE_VAT: "false" })).toThrow(
      /PRICES_INCLUDE_VAT/,
    );
    expect(() => loadEnv(envSchema, { ...base, VAT_RATE_TICKET: "0.12345" })).toThrow(
      /VAT_RATE_TICKET/,
    );
    expect(() => loadEnv(envSchema, { ...base, FINANCE_WORKERS_ENABLED: "true" })).toThrow(
      /INTERNAL_API_KEY/,
    );
    expect(loadEnv(envSchema, base).PRICES_INCLUDE_VAT).toBe("true");
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
