import { randomUUID } from "node:crypto";
import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";
import { Client } from "minio";
import { envSchema } from "../../src/config/env.schema";
import { DocumentsStorage } from "../../src/modules/organizers/documents.storage";

describe("S-105 real MinIO private documents", () => {
  let container: StartedTestContainer;
  let client: Client;
  let storage: DocumentsStorage;
  beforeAll(async () => {
    container = await new GenericContainer("cgr.dev/chainguard/minio:latest")
      .withEnvironment({
        MINIO_ROOT_USER: "testaccess",
        MINIO_ROOT_PASSWORD: "test-secret-for-minio",
      })
      .withCommand(["server", "/data"])
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp("/minio/health/ready", 9000))
      .start();
    const host = container.getHost(),
      port = container.getMappedPort(9000);
    client = new Client({
      endPoint: host,
      port,
      useSSL: false,
      accessKey: "testaccess",
      secretKey: "test-secret-for-minio",
    });
    await client.makeBucket("organizer-docs");
    storage = new DocumentsStorage(
      envSchema.parse({
        DATABASE_URL: "postgresql://unused@localhost/test",
        AUTH_ISSUER: "test",
        AUTH_AUDIENCE: "test",
        AUTH_JWKS_URI: "http://localhost/jwks",
        MINIO_ENDPOINT: `http://${host}:${port}`,
        MINIO_ACCESS_KEY: "testaccess",
        MINIO_SECRET_KEY: "test-secret-for-minio",
      }),
    );
  });
  afterAll(async () => {
    await container?.stop();
  });
  it("persists exact bytes privately and allows only signed attachment downloads", async () => {
    const key = `organizers/${randomUUID()}/license.pdf`;
    const buffer = Buffer.from("%PDF-1.7\nlicense-test\n%%EOF");
    await storage.put(key, { buffer, mimetype: "application/pdf", size: buffer.length });
    const stream = await client.getObject("organizer-docs", key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(buffer);
    const signed = await storage.download(key);
    const response = await fetch(signed);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect((await fetch(signed.split("?")[0])).status).toBe(403);
  });
});
