import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import Redis from "ioredis";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { KycOtp } from "./kyc-otp";

@Injectable()
export class KycRuntime implements OnApplicationShutdown {
  private redis?: Redis;
  private state?: KycOtp;
  constructor(@Inject(ENV) private readonly env: Env) {}
  get otp(): KycOtp {
    if (this.env.KYC_ENABLED !== "true")
      throw new ProblemException("KYC_UNAVAILABLE", 503, "KYC chưa được cấu hình");
    if (!this.state) {
      this.redis = new Redis(this.env.KYC_REDIS_URL!, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
        commandTimeout: 3000,
      });
      this.redis.on("error", () => undefined);
      this.state = new KycOtp(
        this.redis,
        this.env.KYC_OTP_TTL_SECONDS,
        this.env.KYC_OTP_COOLDOWN_SECONDS,
        this.env.KYC_OTP_MAX_ATTEMPTS,
      );
    }
    return this.state;
  }
  onApplicationShutdown(): void {
    this.redis?.disconnect();
  }
}
