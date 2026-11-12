import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Redis from "ioredis";

type OtpRedis = Redis & {
  kycCreateChallenge(...args: (string | number)[]): Promise<string[]>;
  kycVerifyChallenge(...args: (string | number)[]): Promise<string[]>;
};

export interface ChallengeInput {
  userId: string;
  requestKey: string;
  fingerprint: string;
  challengeId: string;
  codeHash: string;
  encryptedPayload: string;
}

export class KycOtp {
  private readonly client: OtpRedis;
  constructor(
    redis: Redis,
    private readonly ttl: number,
    private readonly cooldown: number,
    private readonly maxAttempts: number,
  ) {
    redis.defineCommand("kycCreateChallenge", {
      numberOfKeys: 2,
      lua: readFileSync(join(__dirname, "lua/create-challenge.lua"), "utf8"),
    });
    redis.defineCommand("kycVerifyChallenge", {
      numberOfKeys: 1,
      lua: readFileSync(join(__dirname, "lua/verify-challenge.lua"), "utf8"),
    });
    this.client = redis as OtpRedis;
  }

  key(userId: string): string {
    return `kyc:otp:{usr:${userId}}`;
  }

  async create(input: ChallengeInput): Promise<string[]> {
    return this.client.kycCreateChallenge(
      this.key(input.userId),
      `kyc:cooldown:{usr:${input.userId}}`,
      input.requestKey,
      input.fingerprint,
      input.challengeId,
      input.codeHash,
      input.encryptedPayload,
      this.ttl,
      this.cooldown,
    );
  }

  async verify(userId: string, challengeId: string, codeHash: string): Promise<string[]> {
    return this.client.kycVerifyChallenge(
      this.key(userId),
      challengeId,
      codeHash,
      this.maxAttempts,
    );
  }
}
