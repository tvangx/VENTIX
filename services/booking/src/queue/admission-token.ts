import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

export const grantSchema = z.object({
  jti: z.string().min(1).max(200),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});
export type AdmissionGrant = z.infer<typeof grantSchema>;

export class AdmissionTokens {
  private readonly key: Buffer;
  constructor(secret: string) {
    this.key = Buffer.from(secret);
  }

  sign(user: string, event: string, grant: AdmissionGrant): Promise<string> {
    return new SignJWT({ evt: event, ...grant })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user)
      .setIssuer("booking-admission")
      .setAudience("booking")
      .sign(this.key);
  }

  async verify(
    token: string,
    user: string,
    event: string,
  ): Promise<AdmissionGrant & { sub: string; evt: string }> {
    const { payload } = await jwtVerify(token, this.key, {
      algorithms: ["HS256"],
      issuer: "booking-admission",
      audience: "booking",
      requiredClaims: ["sub", "evt", "jti", "iat", "exp"],
    });
    const grant = grantSchema.parse(payload);
    if (
      payload.sub !== user ||
      payload.evt !== event ||
      grant.exp - grant.iat < 300 ||
      grant.exp - grant.iat > 600 ||
      grant.iat > Math.floor(Date.now() / 1000)
    )
      throw new Error("Invalid admission claims");
    return { ...grant, sub: user, evt: event };
  }
}
