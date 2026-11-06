import { loadEnv } from "@ticketing/common";
import { envSchema } from "./env.schema";

const base = {
  INTERNAL_API_KEY: "synthetic-test-key",
  DATABASE_URL: "postgresql://booking_user:booking_dev@localhost:5432/booking_db",
  AUTH_ISSUER: "https://identity.test",
  AUTH_AUDIENCE: "ticketing-api",
  AUTH_JWKS_URI: "http://localhost:3001/.well-known/jwks.json",
  PORT: "3099",
};

describe("envSchema", () => {
  it("accepts a valid configuration and applies defaults", () => {
    const env = loadEnv(envSchema, base);
    expect(env.PORT).toBe(3099);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.HOLD_TTL_SECONDS).toBe(600);
    expect(env.HOLD_MAX_SEATS).toBe(6);
    expect(env.ADMISSION_REQUIRED).toBe(false);
    expect(env.HOLDLOG_ENABLED).toBe(false);
    expect(env.REHYDRATE_ENABLED).toBe(true);
    expect(env.EVENT_CONSUMER_ENABLED).toBe(true);
    expect(env.KAFKA_BROKERS).toEqual(["localhost:9092"]);
    expect(env.ORDER_PAYMENT_WINDOW_SECONDS).toBe(900);
    expect(env.ORDER_EXPIRY_GRACE_SECONDS).toBe(30);
    expect(env.MERCH_QUOTE_TIMEOUT_MS).toBe(800);
    expect(env.MERCH_INTERNAL_URL).toBe("http://localhost:3007");
  });

  it("fails fast when DATABASE_URL is missing", () => {
    expect(() => loadEnv(envSchema, { ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it.each([undefined, ""])("requires an internal API key (%s)", (key) => {
    expect(() => loadEnv(envSchema, { ...base, INTERNAL_API_KEY: key })).toThrow(
      /INTERNAL_API_KEY/,
    );
  });

  it.each(["ftp://localhost", "http://user:password@localhost", "invalid"])(
    "rejects unsafe internal URL %s",
    (url) => {
      expect(() => loadEnv(envSchema, { ...base, EVENT_INTERNAL_URL: url })).toThrow(
        /EVENT_INTERNAL_URL/,
      );
    },
  );

  it.each([
    "postgresql://postgres:test@localhost:5432/booking_db",
    "postgresql://booking_user:test@localhost:5432/identity_db",
    "https://booking_user:test@localhost/booking_db",
  ])("rejects a database URL outside booking ownership: %s", (url) => {
    expect(() => loadEnv(envSchema, { ...base, DATABASE_URL: url })).toThrow(/DATABASE_URL/);
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

  it("parses boolean strings without treating false as truthy", () => {
    expect(
      loadEnv(envSchema, { ...base, ADMISSION_REQUIRED: "true", HOLDLOG_ENABLED: "true" }),
    ).toMatchObject({ ADMISSION_REQUIRED: true, HOLDLOG_ENABLED: true });
  });

  it.each([
    { HOLD_TTL_SECONDS: "0" },
    { HOLD_TTL_SECONDS: "1.5" },
    { HOLD_TTL_SECONDS: "86401" },
    { HOLD_MAX_SEATS: "0" },
    { HOLD_MAX_SEATS: "1001" },
    { HOLD_MAX_SEATS: "NaN" },
    { ADMISSION_REQUIRED: "yes" },
    { HOLDLOG_ENABLED: "1" },
    { REDIS_URL: "https://localhost" },
    { REHYDRATE_ENABLED: "yes" },
    { EVENT_CONSUMER_ENABLED: "1" },
    { KAFKA_BROKERS: "" },
    { KAFKA_BROKERS: "localhost:9092," },
    { EVENT_CONSUMER_GROUP_ID: "" },
    { ORDER_PAYMENT_WINDOW_SECONDS: "0" },
    { ORDER_EXPIRY_GRACE_SECONDS: "-1" },
    { MERCH_QUOTE_TIMEOUT_MS: "0" },
    { MERCH_INTERNAL_URL: "ftp://localhost" },
    { MERCH_INTERNAL_URL: "http://user:password@localhost" },
  ])("rejects invalid hold configuration %j", (config) => {
    expect(() => loadEnv(envSchema, { ...base, ...config })).toThrow();
  });
});
