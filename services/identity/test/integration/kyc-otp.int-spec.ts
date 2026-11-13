import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { KycOtp, ChallengeInput } from "../../src/modules/kyc/kyc-otp";

describe("S-305 Redis OTP core", () => {
  let container: StartedTestContainer;
  let redis: Redis;
  let otp: KycOtp;
  const input = (): ChallengeInput => ({
    userId: randomUUID(),
    requestKey: randomUUID(),
    fingerprint: "synthetic-fingerprint",
    challengeId: randomUUID(),
    codeHash: "synthetic-code-hmac",
    encryptedPayload: "synthetic-encrypted-payload",
  });
  beforeAll(async () => {
    container = await new GenericContainer("redis:7.4-alpine").withExposedPorts(6379).start();
    redis = new Redis(container.getMappedPort(6379), container.getHost(), {
      maxRetriesPerRequest: 1,
    });
    otp = new KycOtp(redis, 300, 60, 5);
  });
  afterAll(async () => {
    await redis?.quit();
    await container?.stop();
  });

  it("stores a bounded challenge, deduplicates same request and rejects mismatched reuse", async () => {
    const challenge = input();
    expect(await otp.create(challenge)).toEqual(["CREATED", challenge.challengeId]);
    expect(await otp.create({ ...challenge, challengeId: randomUUID() })).toEqual([
      "DUPLICATE",
      challenge.challengeId,
    ]);
    expect(await otp.create({ ...challenge, fingerprint: "different" })).toEqual(["CONFLICT"]);
    expect(await otp.create({ ...challenge, requestKey: randomUUID() })).toEqual(["RATE_LIMITED"]);
    expect(await redis.ttl(otp.key(challenge.userId))).toBeGreaterThan(0);
    expect(await redis.ttl(otp.key(challenge.userId))).toBeLessThanOrEqual(300);
    expect(await redis.ttl(`kyc:cooldown:{usr:${challenge.userId}}`)).toBeGreaterThan(0);
    expect(await otp.verify(challenge.userId, challenge.challengeId, challenge.codeHash)).toEqual([
      "PENDING",
    ]);
    await otp.delivery(challenge.userId, challenge.challengeId, "SENT");
    expect(await otp.verify(challenge.userId, challenge.challengeId, challenge.codeHash)).toEqual([
      "VERIFIED",
      challenge.encryptedPayload,
    ]);
  });

  it("limits attempts atomically, isolates users and rejects missing/expired challenges", async () => {
    const challenge = input();
    await otp.create(challenge);
    await otp.delivery(challenge.userId, challenge.challengeId, "SENT");
    expect(await otp.verify(randomUUID(), challenge.challengeId, challenge.codeHash)).toEqual([
      "EXPIRED",
    ]);
    expect(await otp.verify(challenge.userId, randomUUID(), challenge.codeHash)).toEqual([
      "EXPIRED",
    ]);
    for (let attempt = 0; attempt < 5; attempt++)
      expect(await otp.verify(challenge.userId, challenge.challengeId, "wrong")).toEqual([
        "INVALID",
      ]);
    expect(await otp.verify(challenge.userId, challenge.challengeId, challenge.codeHash)).toEqual([
      "LOCKED",
    ]);
    await redis.pexpire(otp.key(challenge.userId), 1);
    const deadline = Date.now() + 1000;
    while (await redis.exists(otp.key(challenge.userId))) {
      if (Date.now() > deadline) throw new Error("Challenge failed to expire");
      await new Promise((accept) => setTimeout(accept, 10));
    }
    expect(await otp.verify(challenge.userId, challenge.challengeId, challenge.codeHash)).toEqual([
      "EXPIRED",
    ]);
  });

  it("serializes 50 challenge requests and 50 invalid attempts", async () => {
    const challenge = input();
    const requests = await Promise.all(
      Array.from({ length: 50 }, () =>
        otp.create({ ...challenge, challengeId: randomUUID(), requestKey: randomUUID() }),
      ),
    );
    expect(requests.filter((result) => result[0] === "CREATED")).toHaveLength(1);
    expect(requests.filter((result) => result[0] === "RATE_LIMITED")).toHaveLength(49);
    const actualId = requests.find((result) => result[0] === "CREATED")![1];
    await otp.delivery(challenge.userId, actualId, "SENT");
    const attempts = await Promise.all(
      Array.from({ length: 50 }, () => otp.verify(challenge.userId, actualId, "wrong")),
    );
    expect(attempts.filter((result) => result[0] === "INVALID")).toHaveLength(5);
    expect(attempts.filter((result) => result[0] === "LOCKED")).toHaveLength(45);
    expect(await redis.hget(otp.key(challenge.userId), "attempts")).toBe("5");
  });
});
