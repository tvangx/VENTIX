import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { createLogger, loadEnv } from "@ticketing/common";
import { createLocalJWKSet, exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import request, { Response } from "supertest";
import { createApp } from "../../src/bootstrap";
import { envSchema } from "../../src/config/env.schema";
import { testDatabase } from "../helpers/database";

export const refreshCookie = (response: Response): string => {
  const header = response.headers["set-cookie"] as unknown as string[];
  return header.find((value) => value.startsWith("ventix_refresh="))!.split(";")[0];
};

describe("S-102 authentication over HTTP + PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  let app: INestApplication;
  const password = "A-long-password-123!";
  beforeAll(async () => {
    db = await testDatabase();
    db.seed();
    const { privateKey } = await generateKeyPair("RS256");
    app = await createApp(
      loadEnv(envSchema, {
        NODE_ENV: "test",
        DATABASE_URL: db.url,
        AUTH_ISSUER: "https://identity.test",
        AUTH_AUDIENCE: "ticketing-api",
        AUTH_JWKS_URI: "http://localhost:3001/.well-known/jwks.json",
        JWT_PRIVATE_KEY_PEM: await exportPKCS8(privateKey),
      }),
      createLogger("test", { level: "silent" }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await db?.close();
  });
  const register = (email: string, key: string = randomUUID(), pass = password) =>
    request(app.getHttpServer())
      .post("/v1/auth/register")
      .set("Idempotency-Key", key)
      .send({ email, password: pass });
  const login = (email: string) =>
    request(app.getHttpServer()).post("/v1/auth/login").send({ email, password });
  const refresh = (cookie: string) =>
    request(app.getHttpServer()).post("/v1/auth/refresh").set("Cookie", cookie);

  it("registers a normalized email, hashes with argon2id, and assigns only USER", async () => {
    const res = await register("  Son@Example.test  ").expect(201);
    expect(res.body).toMatchObject({ email: "son@example.test", id: expect.any(String) });
    expect(res.body.passwordHash).toBeUndefined();
    const { rows } = await db.pool.query("SELECT password_hash FROM users WHERE id=$1", [
      res.body.id,
    ]);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(
      (await db.pool.query("SELECT role_id FROM user_roles WHERE user_id=$1", [res.body.id])).rows,
    ).toEqual([{ role_id: 1 }]);
  });

  it("replays registration safely, rejects changed body and concurrent duplicate registration", async () => {
    const key = randomUUID();
    const first = await register("replay@example.test", key).expect(201);
    const second = await register("replay@example.test", key).expect(201);
    expect(second.body).toEqual(first.body);
    await register("other@example.test", key).expect(409);
    const concurrent = await Promise.all([
      register("race@example.test"),
      register("race@example.test"),
    ]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("validates password and Idempotency-Key; wrong credentials return generic 401", async () => {
    await register("short@example.test", randomUUID(), "short").expect(400);
    await register("nokey@example.test", "bad").expect(400);
    await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: "son@example.test", password: "wrong-password-123" })
      .expect(401);
    await login("missing@example.test").expect(401);
  });

  it("returns a verifiable RS256 access JWT and an HttpOnly cookie; JWKS has no private material", async () => {
    const res = await login("son@example.test").expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["set-cookie"][0]).toMatch(/HttpOnly/);
    expect(res.headers["set-cookie"][0]).toMatch(/SameSite=Lax/);
    expect(res.body.refreshToken).toBeUndefined();
    const jwks = (await request(app.getHttpServer()).get("/.well-known/jwks.json").expect(200))
      .body;
    expect(jwks.keys[0].d).toBeUndefined();
    const { payload, protectedHeader } = await jwtVerify(
      res.body.access_token,
      createLocalJWKSet(jwks),
      { issuer: "https://identity.test", audience: "ticketing-api", algorithms: ["RS256"] },
    );
    expect(protectedHeader.alg).toBe("RS256");
    expect(payload.roles).toEqual(["USER"]);
    const raw = refreshCookie(res).split("=")[1];
    const { rows } = await db.pool.query("SELECT token_hash FROM refresh_tokens WHERE user_id=$1", [
      payload.sub,
    ]);
    expect(
      rows.every((row) => row.token_hash !== raw && /^[a-f0-9]{64}$/.test(row.token_hash)),
    ).toBe(true);
  });

  it("rotates once and commits family revocation when the old token is reused", async () => {
    const old = refreshCookie(await login("son@example.test").expect(200));
    const next = refreshCookie(await refresh(old).expect(200));
    expect(next).not.toBe(old);
    await refresh(old).expect(401);
    await refresh(next).expect(401);
  });

  it("serializes simultaneous refresh requests; replay revokes the winning token too", async () => {
    const old = refreshCookie(await login("son@example.test").expect(200));
    const results = await Promise.all([refresh(old), refresh(old)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    await refresh(refreshCookie(results.find((r) => r.status === 200)!)).expect(401);
  });

  it("logout is repeatable and rejects refresh for that family", async () => {
    const cookie = refreshCookie(await login("son@example.test").expect(200));
    await request(app.getHttpServer()).post("/v1/auth/logout").set("Cookie", cookie).expect(204);
    await request(app.getHttpServer()).post("/v1/auth/logout").set("Cookie", cookie).expect(204);
    await refresh(cookie).expect(401);
  });

  it("rejects cross-origin session mutations and suspended accounts", async () => {
    await request(app.getHttpServer())
      .post("/v1/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: "son@example.test", password })
      .expect(403);
    const cookie = refreshCookie(await login("son@example.test").expect(200));
    await db.pool.query("UPDATE users SET status='SUSPENDED' WHERE email='son@example.test'");
    await login("son@example.test").expect(401);
    await refresh(cookie).expect(401);
  });
});
