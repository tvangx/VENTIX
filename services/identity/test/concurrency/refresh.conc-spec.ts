import { randomUUID } from "node:crypto";
import request from "supertest";
import { testApp } from "../helpers/app";
import { responseCookie } from "../helpers/cookies";

describe("S-102 refresh family contention", () => {
  let context: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => {
    context = await testApp();
    await context.app.listen(0, "127.0.0.1");
  });
  afterAll(async () => {
    await context?.close();
  });
  it("50 simultaneous rotations produce one winner and revoke its token on replay", async () => {
    const http = context.app.getHttpServer();
    const credentials = { email: "fifty@example.test", password: "Password-for-fifty-requests!" };
    await request(http)
      .post("/v1/auth/register")
      .set("Idempotency-Key", randomUUID())
      .send(credentials)
      .expect(201);
    const login = await request(http).post("/v1/auth/login").send(credentials).expect(200);
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        request(http).post("/v1/auth/refresh").set("Cookie", responseCookie(login)),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(49);
    await request(http)
      .post("/v1/auth/refresh")
      .set("Cookie", responseCookie(results.find((r) => r.status === 200)!))
      .expect(401);
    expect(
      (
        await context.db.pool.query(
          "SELECT count(*)::int AS count FROM refresh_tokens WHERE revoked_at IS NULL",
        )
      ).rows[0].count,
    ).toBe(0);
  });
});
