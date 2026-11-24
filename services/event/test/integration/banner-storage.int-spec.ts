import { loadEnv } from "@ticketing/common";
import { envSchema } from "../../src/config/env.schema";
import { BannerStorage } from "../../src/modules/banners/banner.storage";
import { PNG_BYTES, startFakeS3, type FakeS3 } from "../helpers/fake-s3";

const KEY = "events/0b9b7a3e-4c1d-4e2f-9a6b-1d2c3e4f5a6b/7f1d6c2a-3b4e-4a5f-8c9d-0e1f2a3b4c5d.png";

function env(endpoint: string, keys = true) {
  return loadEnv(envSchema, {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://u:p@localhost:5432/d",
    AUTH_ISSUER: "https://identity.test",
    AUTH_AUDIENCE: "ticketing-api",
    AUTH_JWKS_URI: "http://localhost:3001/.well-known/jwks.json",
    MINIO_ENDPOINT: endpoint,
    ...(keys && { MINIO_ACCESS_KEY: "test-access", MINIO_SECRET_KEY: "test-secret" }),
  });
}

/** Không cần Docker: dùng S3 giả trong tiến trình để chạy đúng AWS SDK thật. */
describe("S-201b BannerStorage against a fake S3", () => {
  let s3: FakeS3;
  let storage: BannerStorage;

  beforeAll(async () => {
    s3 = await startFakeS3();
    storage = new BannerStorage(env(s3.endpoint));
  });
  afterAll(async () => {
    storage.onModuleDestroy();
    await s3.close();
  });

  it("presigns a PUT that signs content-type and content-length and expires", async () => {
    const { url, headers } = await storage.presignUpload(KEY, "image/png", PNG_BYTES.length);
    const parsed = new URL(url);
    expect(parsed.origin).toBe(s3.endpoint);
    expect(parsed.pathname).toBe(`/event-banners/${KEY}`);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("300");
    const signed = (parsed.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
    expect(signed).toEqual(expect.arrayContaining(["content-type", "content-length", "host"]));
    expect(headers).toEqual({ "Content-Type": "image/png" });

    const put = await fetch(url, { method: "PUT", headers, body: PNG_BYTES });
    expect(put.status).toBe(200);
    expect(s3.has("event-banners", KEY)).toBe(true);
  });

  it("inspects size, content-type and only the first 12 bytes", async () => {
    const stored = await storage.inspect(KEY);
    expect(stored).toEqual({
      size: PNG_BYTES.length,
      contentType: "image/png",
      head: PNG_BYTES.subarray(0, 12),
    });
  });

  it("returns null for a missing object and removes an existing one", async () => {
    await expect(storage.inspect(KEY.replace("7f1d", "8a2e"))).resolves.toBeNull();
    await storage.remove(KEY);
    expect(s3.has("event-banners", KEY)).toBe(false);
    await expect(storage.inspect(KEY)).resolves.toBeNull();
    await expect(storage.remove(KEY)).resolves.toBeUndefined();
  });

  it("maps an unreachable store to 503 STORAGE_UNAVAILABLE and swallows cleanup errors", async () => {
    const dead = await startFakeS3();
    const endpoint = dead.endpoint;
    await dead.close();
    const offline = new BannerStorage(env(endpoint));
    await expect(offline.inspect(KEY)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    await expect(offline.remove(KEY)).resolves.toBeUndefined();
    offline.onModuleDestroy();
  });

  it("fails with 503 STORAGE_NOT_CONFIGURED when keys are absent", async () => {
    const unconfigured = new BannerStorage(env(s3.endpoint, false));
    await expect(unconfigured.presignUpload(KEY, "image/png", 10)).rejects.toMatchObject({
      code: "STORAGE_NOT_CONFIGURED",
    });
    await expect(unconfigured.inspect(KEY)).rejects.toMatchObject({
      code: "STORAGE_NOT_CONFIGURED",
    });
    await expect(unconfigured.remove(KEY)).resolves.toBeUndefined();
  });
});
