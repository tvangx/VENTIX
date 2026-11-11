import { createLogger, loadEnv } from "@ticketing/common";
import { createApp, buildOpenApi } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";

describe("S-106 OpenAPI contract export", () => {
  it("describes request/response types, auth boundaries, multipart, cookie and problem errors", async () => {
    const app = await createApp(
      loadEnv(envSchema, {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://unused@localhost:1/unused",
        AUTH_ISSUER: "test",
        AUTH_AUDIENCE: "test",
        AUTH_JWKS_URI: "http://localhost/jwks",
      }),
      createLogger("test", { level: "silent" }),
    );
    try {
      await app.init();
      const doc = buildOpenApi(app);
      expect(doc.paths["/v1/auth/login"].post?.responses[200]).toMatchObject({
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/AccessTokenDto" } },
        },
      });
      expect(doc.paths["/v1/auth/me"].get?.security).toEqual([{ bearer: [] }]);
      expect(doc.paths["/v1/auth/register"].post?.security).toBeUndefined();
      expect(doc.paths["/.well-known/jwks.json"].get?.responses[200]).toBeDefined();
      expect(
        doc.paths["/v1/organizer-applications/{organizerId}/documents"].post?.requestBody,
      ).toMatchObject({
        content: { "multipart/form-data": { schema: { required: ["doc_type", "file"] } } },
      });
      expect(doc.paths["/v1/auth/refresh"].post?.responses.default).toMatchObject({
        content: {
          "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } },
        },
      });
      expect(doc.paths["/v1/auth/google/callback"].get?.responses[302]).toBeDefined();
      expect(doc.components?.schemas?.ApplicationListDto).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
