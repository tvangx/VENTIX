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
    expect(env.INTERNAL_API_KEY).toBeUndefined();
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

  it("validates the optional internal API key", () => {
    expect(
      loadEnv(envSchema, { ...base, INTERNAL_API_KEY: "synthetic-test-key" }).INTERNAL_API_KEY,
    ).toBe("synthetic-test-key");
    expect(() => loadEnv(envSchema, { ...base, INTERNAL_API_KEY: "" })).toThrow(/INTERNAL_API_KEY/);
  });

  it("fails fast when DATABASE_URL is missing", () => {
    expect(() => loadEnv(envSchema, { ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it("requires JWKS or a public key", () => {
    expect(() => loadEnv(envSchema, { ...base, AUTH_JWKS_URI: undefined })).toThrow(
      /AUTH_JWKS_URI/,
    );
  });

  it("applies banner storage defaults and keeps the public URL optional", () => {
    const env = loadEnv(envSchema, base);
    expect(env.MINIO_ENDPOINT).toBe("http://localhost:9000");
    expect(env.MINIO_BUCKET).toBe("event-banners");
    expect(env.UPLOAD_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(env.UPLOAD_PRESIGN_TTL_SECONDS).toBe(300);
    expect(env.PUBLIC_ASSET_BASE_URL).toBeUndefined();
  });

  it("requires MinIO access key and secret key together", () => {
    expect(() => loadEnv(envSchema, { ...base, MINIO_ACCESS_KEY: "key" })).toThrow(
      /MINIO_ACCESS_KEY/,
    );
    expect(() => loadEnv(envSchema, { ...base, MINIO_SECRET_KEY: "secret" })).toThrow(
      /MINIO_ACCESS_KEY/,
    );
    expect(
      loadEnv(envSchema, { ...base, MINIO_ACCESS_KEY: "key", MINIO_SECRET_KEY: "secret" })
        .MINIO_ACCESS_KEY,
    ).toBe("key");
  });

  it("bounds banner size, presign lifetime and public URL", () => {
    expect(() => loadEnv(envSchema, { ...base, UPLOAD_MAX_BYTES: "10" })).toThrow(
      /UPLOAD_MAX_BYTES/,
    );
    expect(() => loadEnv(envSchema, { ...base, UPLOAD_MAX_BYTES: "999999999" })).toThrow(
      /UPLOAD_MAX_BYTES/,
    );
    expect(() => loadEnv(envSchema, { ...base, UPLOAD_PRESIGN_TTL_SECONDS: "5" })).toThrow(
      /UPLOAD_PRESIGN_TTL_SECONDS/,
    );
    expect(() => loadEnv(envSchema, { ...base, UPLOAD_PRESIGN_TTL_SECONDS: "86400" })).toThrow(
      /UPLOAD_PRESIGN_TTL_SECONDS/,
    );
    expect(() => loadEnv(envSchema, { ...base, PUBLIC_ASSET_BASE_URL: "not a url" })).toThrow(
      /PUBLIC_ASSET_BASE_URL/,
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
