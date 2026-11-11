import { Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";

const identitySchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().email().max(254),
  email_verified: z.literal(true),
  nonce: z.string(),
});
export type GoogleIdentity = z.infer<typeof identitySchema>;

@Injectable()
export class GoogleProvider {
  private readonly keySet = createRemoteJWKSet(
    new URL("https://www.googleapis.com/oauth2/v3/certs"),
    { timeoutDuration: 5000 },
  );
  constructor(@Inject(ENV) private readonly env: Env) {}
  configured() {
    if (!this.env.GOOGLE_CLIENT_ID || !this.env.GOOGLE_CLIENT_SECRET)
      throw new ProblemException("GOOGLE_NOT_CONFIGURED", 503, "Chưa cấu hình Google OAuth");
  }
  async verifyIdToken(
    token: string,
    nonce: string,
    getKey: JWTVerifyGetKey = this.keySet,
  ): Promise<GoogleIdentity> {
    try {
      const { payload } = await jwtVerify(token, getKey, {
        algorithms: ["RS256"],
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: this.env.GOOGLE_CLIENT_ID,
        requiredClaims: ["exp", "sub", "nonce", "email"],
      });
      const profile = identitySchema.parse(payload);
      if (profile.nonce !== nonce) throw new Error("nonce mismatch");
      return { ...profile, email: profile.email.trim().toLowerCase() };
    } catch {
      throw new ProblemException("GOOGLE_TOKEN_INVALID", 401, "Google ID token không hợp lệ");
    }
  }
  async exchange(code: string, verifier: string, nonce: string): Promise<GoogleIdentity> {
    this.configured();
    let response: globalThis.Response;
    try {
      response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          code_verifier: verifier,
          client_id: this.env.GOOGLE_CLIENT_ID!,
          client_secret: this.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: this.env.GOOGLE_REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });
    } catch {
      throw new ProblemException("GOOGLE_UNAVAILABLE", 503, "Không kết nối được Google");
    }
    if (!response.ok)
      throw new ProblemException("GOOGLE_EXCHANGE_FAILED", 401, "Google từ chối mã đăng nhập");
    const parsed = z
      .object({ id_token: z.string().min(1) })
      .safeParse(await response.json().catch(() => null));
    if (!parsed.success)
      throw new ProblemException("GOOGLE_EXCHANGE_FAILED", 401, "Google không trả ID token");
    return this.verifyIdToken(parsed.data.id_token, nonce);
  }
}
