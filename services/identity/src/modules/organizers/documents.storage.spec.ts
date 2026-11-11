import { S3Client } from "@aws-sdk/client-s3";
import { envSchema } from "../../config/env.schema";
import { DocumentsStorage, licenseExtension, MAX_DOCUMENT_BYTES } from "./documents.storage";

describe("S-105 license files and storage failures", () => {
  it.each([
    ["application/pdf", Buffer.from("%PDF-1.7\n"), "pdf"],
    ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "png"],
    ["image/jpeg", Buffer.from([255, 216, 255, 224]), "jpg"],
  ])("accepts %s with matching magic bytes", (mimetype, buffer, extension) => {
    expect(licenseExtension({ mimetype, buffer, size: buffer.length })).toBe(extension);
  });
  it("rejects missing, empty, oversized and forged MIME files", () => {
    expect(() => licenseExtension()).toThrow();
    for (const buffer of [
      Buffer.alloc(0),
      Buffer.alloc(MAX_DOCUMENT_BYTES + 1),
      Buffer.from("<script>bad</script>"),
    ])
      expect(() =>
        licenseExtension({ buffer, mimetype: "application/pdf", size: buffer.length }),
      ).toThrow();
  });
  it("maps storage SDK failures to a safe 503", async () => {
    const env = envSchema.parse({
      DATABASE_URL: "postgresql://test@localhost/test",
      AUTH_ISSUER: "test",
      AUTH_AUDIENCE: "test",
      AUTH_JWKS_URI: "http://localhost/jwks",
      MINIO_ACCESS_KEY: "test-key",
      MINIO_SECRET_KEY: "test-secret",
    });
    const storage = new DocumentsStorage(env);
    const put = jest
      .spyOn(S3Client.prototype, "send")
      .mockImplementation(() => Promise.reject(new Error("private upstream error")));
    try {
      await expect(
        storage.put("key", { buffer: Buffer.from("%PDF-1"), mimetype: "application/pdf", size: 6 }),
      ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    } finally {
      put.mockRestore();
      storage.onModuleDestroy();
    }
  });
  it("signs an attachment GET with a 60-second expiry without network access", async () => {
    const storage = new DocumentsStorage(
      envSchema.parse({
        DATABASE_URL: "postgresql://test@localhost/test",
        AUTH_ISSUER: "test",
        AUTH_AUDIENCE: "test",
        AUTH_JWKS_URI: "http://localhost/jwks",
        MINIO_ACCESS_KEY: "test-key",
        MINIO_SECRET_KEY: "test-secret",
      }),
    );
    try {
      const url = new URL(await storage.download("organizers/test/license.pdf"));
      expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
      expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
      expect(url.searchParams.get("response-content-disposition")).toBe("attachment");
    } finally {
      storage.onModuleDestroy();
    }
  });
});
