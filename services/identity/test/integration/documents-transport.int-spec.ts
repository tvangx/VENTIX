import { createServer } from "node:http";
import { envSchema } from "../../src/config/env.schema";
import { DocumentsStorage } from "../../src/modules/organizers/documents.storage";

describe("S-105 storage transport deadline", () => {
  it("aborts a stalled upstream and returns a retryable 503", async () => {
    const server = createServer((_req, _res) => {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test listener unavailable");
      const storage = new DocumentsStorage(
        envSchema.parse({
          DATABASE_URL: "postgresql://test@localhost/test",
          AUTH_ISSUER: "test",
          AUTH_AUDIENCE: "test",
          AUTH_JWKS_URI: "http://localhost/jwks",
          MINIO_ENDPOINT: `http://127.0.0.1:${address.port}`,
          MINIO_ACCESS_KEY: "test-key",
          MINIO_SECRET_KEY: "test-secret",
        }),
      );
      const buffer = Buffer.from("%PDF-1.7\n");
      await expect(
        storage.put("organizers/test/license.pdf", {
          buffer,
          size: buffer.length,
          mimetype: "application/pdf",
        }),
      ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15000);
});
