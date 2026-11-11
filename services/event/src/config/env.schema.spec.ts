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
  it("accepts a valid configuration and applies defaults", () => {
    const env = loadEnv(envSchema, base);
    expect(env.PORT).toBe(3099);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
  });

  it("uses the relay by default outside tests and parses multiple brokers", () => {
    expect(loadEnv(envSchema, base).EVENT_OUTBOX_ENABLED).toBe(true);
    expect(loadEnv(envSchema, { ...base, NODE_ENV: "test" }).EVENT_OUTBOX_ENABLED).toBe(false);
    const config = loadEnv(envSchema, {
      ...base,
      NODE_ENV: "test",
      EVENT_OUTBOX_ENABLED: "true",
      KAFKA_BROKERS: "broker:9092, [::1]:9093",
    });
    expect(config.EVENT_OUTBOX_ENABLED).toBe(true);
    expect(config.KAFKA_BROKERS).toEqual(["broker:9092", "[::1]:9093"]);
  });

  it("rejects invalid Kafka brokers", () => {
    expect(() => loadEnv(envSchema, { ...base, KAFKA_BROKERS: "broker:65536" })).toThrow(
      /KAFKA_BROKERS/,
    );
  });

  it("accepts the local Redis port and rejects malformed URLs", () => {
    expect(loadEnv(envSchema, { ...base, REDIS_URL: "redis://localhost:16379" }).REDIS_URL).toBe(
      "redis://localhost:16379",
    );
    expect(() => loadEnv(envSchema, { ...base, REDIS_URL: "not-a-url" })).toThrow(/REDIS_URL/);
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
