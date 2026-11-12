import { randomUUID } from "node:crypto";
import { kycFixture } from "../helpers/kyc";

describe("S-305 verification race", () => {
  it("50 accounts claiming the same CCCD yield exactly one verified profile", async () => {
    const context = await kycFixture();
    try {
      const users = await Promise.all(Array.from({ length: 50 }, () => context.user()));
      const challenges = await Promise.all(
        users.map((user) => context.challenge(user.token, "001099000202")),
      );
      expect(challenges.every((response) => response.status === 201)).toBe(true);
      const codes = await Promise.all(users.map((user) => context.latestCode(user.email)));
      const results = await Promise.all(
        users.map((user, index) =>
          context.verify(user.token, challenges[index].body.challenge_id, codes[index]),
        ),
      );
      expect(results.filter((response) => response.status === 200)).toHaveLength(1);
      expect(
        results.filter(
          (response) =>
            response.status === 409 && response.body.code === "KYC_IDENTITY_ALREADY_LINKED",
        ),
      ).toHaveLength(49);
      expect(
        (
          await context.pool.query("SELECT * FROM kyc_profiles WHERE id_number_hmac=$1", [
            context.crypto.hash("001099000202"),
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (await context.pool.query("SELECT * FROM outbox_events WHERE event_type='AuditRecorded'"))
          .rowCount,
      ).toBe(1);
    } finally {
      await context.close();
    }
  });
  it("50 same-key verifications create one profile and one audit event", async () => {
    const context = await kycFixture();
    try {
      const user = await context.user();
      const challenge = await context.challenge(user.token, "001099000201").expect(201);
      const code = await context.latestCode(user.email);
      const key = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 50 }, () =>
          context.verify(user.token, challenge.body.challenge_id, code, key),
        ),
      );
      expect(responses.every((response) => response.status === 200)).toBe(true);
      expect(
        (await context.pool.query("SELECT * FROM kyc_profiles WHERE user_id=$1", [user.id]))
          .rowCount,
      ).toBe(1);
      expect(
        (await context.pool.query("SELECT * FROM outbox_events WHERE message_key=$1", [user.id]))
          .rowCount,
      ).toBe(1);
      expect(new Set(responses.map((response) => response.body.kycHash)).size).toBe(1);
    } finally {
      await context.close();
    }
  });
});
