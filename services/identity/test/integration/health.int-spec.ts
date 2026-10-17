import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createLogger, loadEnv } from "@ticketing/common";
import { SignJWT, exportSPKI, generateKeyPair, KeyLike } from "jose";
import request from "supertest";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";

describe("service template (integration, Postgres via Testcontainers)", () => {
  let pg: StartedPostgreSqlContainer;
  let app: INestApplication;
  let privateKey: KeyLike;
  let dbStopped = false;

  const sign = () =>
    new SignJWT({ roles: ["USER"] })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject("11111111-1111-4111-8111-111111111111")
      .setIssuer("https://identity.test")
      .setAudience("ticketing-api")
      .setExpirationTime("5m")
      .sign(privateKey);

  beforeAll(async () => {
    pg = await new PostgreSqlContainer("postgres:16").start();
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    const env = loadEnv(envSchema, {
      NODE_ENV: "test",
      PORT: "3999", // app không listen trong test; chỉ cần giá trị hợp lệ
      DATABASE_URL: pg.getConnectionUri(),
      AUTH_ISSUER: "https://identity.test",
      AUTH_AUDIENCE: "ticketing-api",
      AUTH_PUBLIC_KEY_PEM: await exportSPKI(pair.publicKey),
    });
    app = await createApp(env, createLogger("test", { level: "silent" }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (!dbStopped) await pg?.stop();
  });

  it("GET /health/live → 200", async () => {
    await request(app.getHttpServer()).get("/health/live").expect(200, { status: "ok" });
  });

  it("GET /health/ready → 200 when DB is reachable", async () => {
    await request(app.getHttpServer()).get("/health/ready").expect(200, { status: "ok" });
  });

  it("echoes X-Request-Id and rejects missing token with problem+json carrying request_id", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/whoami")
      .set("X-Request-Id", "rid-int-1")
      .expect(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.headers["x-request-id"]).toBe("rid-int-1");
    expect(res.body).toMatchObject({ status: 401, code: "UNAUTHORIZED", request_id: "rid-int-1" });
  });

  it("GET /v1/whoami with a valid RS256 token → 200", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/whoami")
      .set("Authorization", `Bearer ${await sign()}`)
      .expect(200);
    expect(res.body).toEqual({ userId: "11111111-1111-4111-8111-111111111111", roles: ["USER"] });
  });

  it("GET /metrics exposes Prometheus metrics", async () => {
    const res = await request(app.getHttpServer()).get("/metrics").expect(200);
    expect(res.text).toContain("http_request_duration_seconds");
  });

  it("GET /docs serves Swagger UI", async () => {
    await request(app.getHttpServer()).get("/docs").expect(200);
  });

  it("GET /health/ready → 503 problem+json once the DB is gone", async () => {
    await pg.stop();
    dbStopped = true;
    const res = await request(app.getHttpServer()).get("/health/ready").expect(503);
    expect(res.body).toMatchObject({ code: "NOT_READY", status: 503 });
  });
});
