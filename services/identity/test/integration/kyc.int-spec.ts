import { randomUUID } from "node:crypto";
import request from "supertest";
import { parseMessage } from "@ticketing/event-contracts";
import { kycFixture } from "../helpers/kyc";
import { AuthKeys } from "../../src/modules/auth/auth-keys";

describe("S-305 KYC via PostgreSQL, Redis and Mailpit SMTP", () => {
  let context: Awaited<ReturnType<typeof kycFixture>>;
  beforeAll(async () => {
    context = await kycFixture();
  });
  afterAll(async () => {
    await context?.close();
  });

  it("sends real SMTP to account email, encrypts PII, writes audit atomically and replays safely", async () => {
    const user = await context.user();
    const identityNumber = "001099000101";
    const key = randomUUID();
    await request(context.app.getHttpServer())
      .post("/v1/kyc/challenges")
      .send({ id_number: identityNumber, full_name: "Synthetic Test Person" })
      .expect(401);
    const created = await context.challenge(user.token, identityNumber, key).expect(201);
    expect(created.headers["cache-control"]).toContain("no-store");
    expect(JSON.stringify(created.body)).not.toMatch(/001099000101|Synthetic|code|email/);
    const duplicate = await context.challenge(user.token, identityNumber, key).expect(201);
    expect(duplicate.body).toEqual(created.body);
    await context.challenge(user.token, "001099000102", key).expect(409);
    await context.challenge(user.token, identityNumber).expect(429);
    const code = await context.latestCode(user.email);
    const rawRedis = await context.redis.hgetall(`kyc:otp:{usr:${user.id}}`);
    expect(JSON.stringify(rawRedis)).not.toContain(identityNumber);
    expect(JSON.stringify(rawRedis)).not.toContain("Synthetic Test Person");
    expect(Object.values(rawRedis)).not.toContain(code);
    const proofKey = randomUUID();
    const verified = await context
      .verify(user.token, created.body.challenge_id, code, proofKey)
      .set("X-Request-Id", "kyc-verify-synthetic-trace")
      .expect(200);
    expect(verified.body).toEqual({ verified: true, kycHash: context.crypto.hash(identityNumber) });
    const row = (await context.pool.query("SELECT * FROM kyc_profiles WHERE user_id=$1", [user.id]))
      .rows[0];
    expect(row.id_number_enc.toString("utf8")).not.toContain(identityNumber);
    expect(
      context.crypto.decrypt(user.id, "id_number", {
        keyId: row.key_id,
        ciphertext: row.id_number_enc,
      }),
    ).toBe(identityNumber);
    expect(
      context.crypto.decrypt(user.id, "full_name", {
        keyId: row.key_id,
        ciphertext: row.full_name_enc,
      }),
    ).toBe("Synthetic Test Person");
    const audit = await context.pool.query(
      "SELECT * FROM outbox_events WHERE event_type='AuditRecorded' AND message_key=$1",
      [user.id],
    );
    expect(audit.rowCount).toBe(1);
    expect(parseMessage(audit.rows[0].payload).type).toBe("AuditRecorded");
    expect(audit.rows[0].payload.trace_id).toBe("kyc-verify-synthetic-trace");
    expect(JSON.stringify(audit.rows[0].payload)).not.toMatch(/001099000101|Synthetic|kycHash/);
    const changedJwtFingerprint = jest
      .spyOn(context.app.get(AuthKeys), "fingerprint")
      .mockResolvedValue("synthetic-changed-jwt-key-fingerprint");
    try {
      expect(
        (await context.verify(user.token, created.body.challenge_id, code, proofKey).expect(200))
          .body,
      ).toEqual(verified.body);
    } finally {
      changedJwtFingerprint.mockRestore();
    }
    const replay = await context.verify(user.token, created.body.challenge_id, code).expect(409);
    expect(replay.body.code).toBe("OTP_ALREADY_USED");
    await request(context.app.getHttpServer())
      .get("/v1/kyc/me")
      .auth(user.token, { type: "bearer" })
      .expect(200, verified.body);
    await request(context.app.getHttpServer()).get(`/v1/internal/users/${user.id}/kyc`).expect(401);
    await request(context.app.getHttpServer())
      .get(`/v1/internal/users/${user.id}/kyc`)
      .set("X-Internal-Key", context.env.INTERNAL_API_KEY!)
      .expect(200, verified.body);
  });

  it("rejects wrong-user, wrong, expired and locked OTPs", async () => {
    const user = await context.user();
    const stranger = await context.user();
    const created = await context.challenge(user.token, "001099000103").expect(201);
    const code = await context.latestCode(user.email);
    await context.verify(stranger.token, created.body.challenge_id, code).expect(400);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt++)
      await context.verify(user.token, created.body.challenge_id, wrong).expect(400);
    await context.verify(user.token, created.body.challenge_id, code).expect(429);
    const expiryUser = await context.user();
    const expiry = await context.challenge(expiryUser.token, "001099000104").expect(201);
    const expiryCode = await context.latestCode(expiryUser.email);
    await context.redis.pexpire(`kyc:otp:{usr:${expiryUser.id}}`, 1);
    const deadline = Date.now() + 2000;
    while (await context.redis.exists(`kyc:otp:{usr:${expiryUser.id}}`)) {
      if (Date.now() > deadline) throw new Error("OTP did not expire");
      await new Promise((accept) => setTimeout(accept, 10));
    }
    await context.verify(expiryUser.token, expiry.body.challenge_id, expiryCode).expect(400);
  });

  it("enforces CCCD uniqueness and rolls back profile/proof when Outbox insertion fails", async () => {
    const first = await context.user();
    const second = await context.user();
    const identityNumber = "001099000105";
    const created = await context.challenge(first.token, identityNumber).expect(201);
    const code = await context.latestCode(first.email);
    await context.admin.query(
      "ALTER TABLE outbox_events ADD CONSTRAINT synthetic_kyc_failure CHECK(event_type<>'AuditRecorded') NOT VALID",
    );
    try {
      await context.verify(first.token, created.body.challenge_id, code).expect(500);
    } finally {
      await context.admin.query("ALTER TABLE outbox_events DROP CONSTRAINT synthetic_kyc_failure");
    }
    expect(
      (await context.pool.query("SELECT * FROM kyc_profiles WHERE user_id=$1", [first.id]))
        .rowCount,
    ).toBe(0);
    await context.verify(first.token, created.body.challenge_id, code).expect(200);
    const other = await context.challenge(second.token, identityNumber).expect(201);
    const rejected = await context
      .verify(second.token, other.body.challenge_id, await context.latestCode(second.email))
      .expect(409);
    expect(rejected.body.code).toBe("KYC_IDENTITY_ALREADY_LINKED");
    expect(
      (await context.pool.query("SELECT * FROM kyc_profiles WHERE user_id=$1", [second.id]))
        .rowCount,
    ).toBe(0);
  });

  it("binds challenges to the account email and fails closed on SMTP errors", async () => {
    const user = await context.user();
    const created = await context.challenge(user.token, "001099000106").expect(201);
    const code = await context.latestCode(user.email);
    await context.pool.query("UPDATE users SET email=$2 WHERE id=$1", [
      user.id,
      `changed-${user.email}`,
    ]);
    await context.verify(user.token, created.body.challenge_id, code).expect(409);
    const failedUser = await context.user();
    await context.stopMail();
    await context.challenge(failedUser.token, "001099000107").expect(503);
    expect(await context.redis.exists(`kyc:otp:{usr:${failedUser.id}}`)).toBe(0);
  });
});
