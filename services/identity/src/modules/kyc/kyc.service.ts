import { Inject, Injectable } from "@nestjs/common";
import { ProblemException, requestContext } from "@ticketing/common";
import { newMessage } from "@ticketing/event-contracts";
import { fromPrismaTx, OutboxService } from "@ticketing/outbox-inbox";
import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "../../../generated/client";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { IdempotencyService } from "../auth/idempotency.service";
import { KycCrypto } from "./kyc-crypto";
import { KycChallengeRequest, KycChallengeResponse, KycVerifyRequest } from "./kyc.dto";
import { KycMailer } from "./kyc-mailer";
import { KycRepository } from "./kyc.repository";
import { KycRuntime } from "./kyc-runtime";

const payloadSchema = z.object({
  email: z.string().email(),
  id_number: z.string().regex(/^\d{12}$/),
  full_name: z.string().min(2).max(200),
  expires_at: z.string().datetime(),
});

@Injectable()
export class KycService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly crypto: KycCrypto,
    private readonly runtime: KycRuntime,
    private readonly repo: KycRepository,
    private readonly mailer: KycMailer,
    private readonly idempotency: IdempotencyService,
  ) {}

  async status(userId: string) {
    if (this.env.KYC_ENABLED !== "true")
      throw new ProblemException("KYC_UNAVAILABLE", 503, "KYC chưa được cấu hình");
    return this.repo.status(userId);
  }

  private decode(userId: string, challengeId: string, encrypted: string) {
    try {
      const envelope = z
        .object({ keyId: z.string(), ciphertext: z.string() })
        .parse(JSON.parse(encrypted));
      return payloadSchema.parse(
        JSON.parse(
          this.crypto.decrypt(userId, `challenge:${challengeId}`, {
            keyId: envelope.keyId,
            ciphertext: Buffer.from(envelope.ciphertext, "base64"),
          }),
        ),
      );
    } catch {
      throw new ProblemException(
        "OTP_INVALID_OR_EXPIRED",
        400,
        "Mã xác minh không hợp lệ hoặc đã hết hạn",
      );
    }
  }

  async challenge(
    userId: string,
    input: KycChallengeRequest,
    key: string | undefined,
  ): Promise<KycChallengeResponse> {
    const otp = this.runtime.otp;
    if (!z.string().uuid().safeParse(key).success)
      throw new ProblemException("INVALID_IDEMPOTENCY_KEY", 400, "Idempotency-Key phải là UUID");
    const user = await this.repo.recipient(userId);
    if (user.kycProfile?.verifiedAt)
      throw new ProblemException("KYC_ALREADY_VERIFIED", 409, "Hồ sơ đã được xác minh");
    const challengeId = randomUUID();
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const payload = {
      ...input,
      email: user.email,
      expires_at: new Date(Date.now() + this.env.KYC_OTP_TTL_SECONDS * 1000).toISOString(),
    };
    const encrypted = this.crypto.encrypt(
      userId,
      `challenge:${challengeId}`,
      JSON.stringify(payload),
    );
    const fingerprint = this.crypto.mac(
      "kyc-challenge-request",
      JSON.stringify([userId, input.id_number, input.full_name, user.email]),
    );
    let result: string[];
    try {
      result = await otp.create({
        userId,
        requestKey: key!,
        fingerprint,
        challengeId,
        codeHash: this.crypto.mac("kyc-otp", JSON.stringify([userId, challengeId, code])),
        encryptedPayload: JSON.stringify({
          keyId: encrypted.keyId,
          ciphertext: encrypted.ciphertext.toString("base64"),
        }),
      });
    } catch {
      throw new ProblemException("OTP_STORE_UNAVAILABLE", 503, "Dịch vụ xác minh chưa sẵn sàng");
    }
    if (result[0] === "CONFLICT")
      throw new ProblemException("IDEMPOTENCY_KEY_REUSED", 409, "Key đã dùng với nội dung khác");
    if (result[0] === "RATE_LIMITED")
      throw new ProblemException("OTP_RATE_LIMITED", 429, "Hãy chờ trước khi yêu cầu mã mới");
    if (result[0] === "DUPLICATE") {
      if (!(await otp.sent(userId, result[1])))
        throw new ProblemException("OTP_DELIVERY_PENDING", 409, "Mã xác minh đang được gửi");
      const stored = await otp.payload(userId, result[1]);
      if (!stored) throw new ProblemException("OTP_INVALID_OR_EXPIRED", 400, "Yêu cầu mã mới");
      return {
        challenge_id: result[1],
        expires_at: this.decode(userId, result[1], stored).expires_at,
      };
    }
    if (result[0] !== "CREATED")
      throw new ProblemException("OTP_STORE_UNAVAILABLE", 503, "Dịch vụ xác minh chưa sẵn sàng");
    try {
      await this.mailer.send(user.email, code);
      await otp.delivery(userId, challengeId, "SENT");
    } catch (error) {
      await otp.delivery(userId, challengeId, "INVALIDATE").catch(() => undefined);
      if (error instanceof ProblemException) throw error;
      throw new ProblemException("OTP_STORE_UNAVAILABLE", 503, "Dịch vụ xác minh chưa sẵn sàng");
    }
    return { challenge_id: challengeId, expires_at: payload.expires_at };
  }

  async verify(
    userId: string,
    input: KycVerifyRequest,
    key: string | undefined,
  ): Promise<Prisma.JsonValue> {
    const otp = this.runtime.otp;
    const codeHash = this.crypto.mac(
      "kyc-otp",
      JSON.stringify([userId, input.challenge_id, input.code]),
    );
    let response: Prisma.JsonValue;
    try {
      response = await this.idempotency.run(
        `kyc-verify:${userId}`,
        key,
        { challenge_id: input.challenge_id, codeHash },
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`;
          const proofScope = `kyc-proof:${userId}`;
          if (
            await tx.idempotencyRecord.findUnique({
              where: { scope_key: { scope: proofScope, key: input.challenge_id } },
            })
          )
            throw new ProblemException("OTP_ALREADY_USED", 409, "Mã xác minh đã được sử dụng");
          let result: string[];
          try {
            result = await otp.verify(userId, input.challenge_id, codeHash);
          } catch {
            throw new ProblemException(
              "OTP_STORE_UNAVAILABLE",
              503,
              "Dịch vụ xác minh chưa sẵn sàng",
            );
          }
          if (result[0] === "LOCKED")
            throw new ProblemException("OTP_ATTEMPTS_EXCEEDED", 429, "Đã vượt số lần thử mã");
          if (result[0] !== "VERIFIED")
            throw new ProblemException(
              "OTP_INVALID_OR_EXPIRED",
              400,
              "Mã xác minh không hợp lệ hoặc đã hết hạn",
            );
          const payload = this.decode(userId, input.challenge_id, result[1]);
          const profile = await this.repo.finalize(
            tx,
            userId,
            payload.email,
            payload.id_number,
            payload.full_name,
          );
          await tx.idempotencyRecord.create({
            data: {
              scope: proofScope,
              key: input.challenge_id,
              requestHash: this.crypto.mac("kyc-proof", input.challenge_id),
              response: { consumed: true },
            },
          });
          if (profile.changed)
            await new OutboxService().add(
              fromPrismaTx(tx),
              newMessage(
                "AuditRecorded",
                {
                  actor_id: userId,
                  action: "KYC_VERIFIED",
                  resource_type: "kyc_profile",
                  resource_id: userId,
                  after_state: { verified: true },
                },
                { trace_id: requestContext.get()?.traceId ?? requestContext.get()?.requestId },
              ),
              userId,
            );
          return { verified: true, kycHash: profile.hash };
        },
        this.crypto.mac("kyc-verify-request", JSON.stringify([input.challenge_id, codeHash])),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new ProblemException(
          "KYC_IDENTITY_ALREADY_LINKED",
          409,
          "Thông tin định danh đã được sử dụng",
        );
      throw error;
    }
    await otp.delivery(userId, input.challenge_id, "INVALIDATE").catch(() => undefined);
    return response;
  }
}
