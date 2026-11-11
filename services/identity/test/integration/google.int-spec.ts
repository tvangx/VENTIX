import { randomUUID } from "node:crypto";
import request from "supertest";
import { GoogleProvider } from "../../src/modules/auth/google.provider";
import { testApp } from "../helpers/app";
import { responseCookie } from "../helpers/cookies";

describe("S-103 Google OAuth state and account flow", () => {
  let context: Awaited<ReturnType<typeof testApp>>;
  let exchange: jest.SpyInstance;
  beforeAll(async () => {
    context = await testApp({
      GOOGLE_CLIENT_ID: "test-client",
      GOOGLE_CLIENT_SECRET: "test-secret",
    });
    exchange = jest.spyOn(context.app.get(GoogleProvider), "exchange");
  });
  afterAll(async () => {
    exchange?.mockRestore();
    await context?.close();
  });
  const start = () => request(context.app.getHttpServer()).get("/v1/auth/google/start");
  const callback = (state: string, cookie: string) =>
    request(context.app.getHttpServer())
      .get("/v1/auth/google/callback")
      .query({ state, code: "test-code" })
      .set("Cookie", cookie);
  const identity = {
    sub: "google-user",
    email: "google@example.test",
    email_verified: true as const,
    nonce: "provider-verified",
  };

  it("uses S256 PKCE, browser cookie and nonce, then creates one account and redirects without tokens", async () => {
    const begin = await start().expect(200);
    const url = new URL(begin.body.authorization_url);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("code_verifier")).toBe(false);
    expect(url.searchParams.get("nonce")).toBeTruthy();
    exchange.mockResolvedValue(identity);
    const res = await callback(
      url.searchParams.get("state")!,
      responseCookie(begin, "ventix_oauth"),
    ).expect(302);
    expect(res.headers.location).toBe("http://localhost:5173/auth/callback?provider=google");
    expect(responseCookie(res)).toMatch(/^ventix_refresh=/);
    expect(
      (await context.db.pool.query("SELECT count(*)::int AS count FROM oauth_accounts")).rows[0]
        .count,
    ).toBe(1);
    await callback(url.searchParams.get("state")!, responseCookie(begin, "ventix_oauth")).expect(
      401,
    );
  });

  it("rejects a missing/wrong browser cookie, expired state and altered state", async () => {
    const begin = await start().expect(200);
    const state = new URL(begin.body.authorization_url).searchParams.get("state")!;
    await callback(state, "ventix_oauth=wrong").expect(401);
    await callback("wrong", responseCookie(begin, "ventix_oauth")).expect(401);
    await context.db.pool.query(
      "UPDATE google_oauth_states SET expires_at=$1 WHERE used_at IS NULL",
      [new Date(Date.now() - 1000)],
    );
    await callback(state, responseCookie(begin, "ventix_oauth")).expect(401);
  });

  it("repeated sign-in to the same Google subject keeps one user", async () => {
    exchange.mockResolvedValue(identity);
    const begin = await start().expect(200);
    await callback(
      new URL(begin.body.authorization_url).searchParams.get("state")!,
      responseCookie(begin, "ventix_oauth"),
    ).expect(302);
    expect(
      (
        await context.db.pool.query("SELECT count(*)::int AS count FROM users WHERE email=$1", [
          identity.email,
        ])
      ).rows[0].count,
    ).toBe(1);
  });

  it("requires explicit authenticated linking for an existing email", async () => {
    const credentials = { email: "existing@example.test", password: "Existing-long-password-123!" };
    await request(context.app.getHttpServer())
      .post("/v1/auth/register")
      .set("Idempotency-Key", randomUUID())
      .send(credentials)
      .expect(201);
    exchange.mockResolvedValue({ ...identity, sub: "link-subject", email: credentials.email });
    const begin = await start().expect(200);
    await callback(
      new URL(begin.body.authorization_url).searchParams.get("state")!,
      responseCookie(begin, "ventix_oauth"),
    ).expect(409);
    await request(context.app.getHttpServer()).get("/v1/auth/google/link").expect(401);
    const login = await request(context.app.getHttpServer())
      .post("/v1/auth/login")
      .send(credentials)
      .expect(200);
    const link = await request(context.app.getHttpServer())
      .get("/v1/auth/google/link")
      .set("Authorization", `Bearer ${login.body.access_token}`)
      .expect(200);
    await callback(
      new URL(link.body.authorization_url).searchParams.get("state")!,
      responseCookie(link, "ventix_oauth"),
    ).expect(302);
    expect(
      (
        await context.db.pool.query("SELECT count(*)::int AS count FROM users WHERE email=$1", [
          credentials.email,
        ])
      ).rows[0].count,
    ).toBe(1);
  });
});
