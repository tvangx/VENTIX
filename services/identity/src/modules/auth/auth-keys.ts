import { createHash, createHmac, createPrivateKey, createPublicKey } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { exportPKCS8, generateKeyPair, importPKCS8, SignJWT } from "jose";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";

@Injectable()
export class AuthKeys {
  private readonly material: ReturnType<AuthKeys["initialize"]>;
  constructor(@Inject(ENV) private readonly env: Env) {
    this.material = this.initialize();
  }

  private async initialize() {
    const pem =
      this.env.JWT_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n") ??
      (await exportPKCS8((await generateKeyPair("RS256", { modulusLength: 2048 })).privateKey));
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      throw new Error("JWT signing key must be RSA with at least 2048 bits");
    }
    const canonical = key.export({ format: "pem", type: "pkcs8" }).toString();
    const jwk = createPublicKey(key).export({ format: "jwk" });
    const kid = createHash("sha256").update(JSON.stringify(jwk)).digest("hex").slice(0, 24);
    return {
      privateKey: await importPKCS8(canonical, "RS256"),
      jwk: { ...jwk, kid, alg: "RS256", use: "sig" },
      canonical,
    };
  }

  async jwks() {
    return { keys: [(await this.material).jwk] };
  }
  async fingerprint(value: unknown): Promise<string> {
    return createHmac("sha256", (await this.material).canonical)
      .update(JSON.stringify(value))
      .digest("hex");
  }
  async sign(userId: string, roles: string[], organizerId?: string): Promise<string> {
    const { privateKey, jwk } = await this.material;
    return new SignJWT({ roles, ...(organizerId ? { organizer_id: organizerId } : {}) })
      .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
      .setSubject(userId)
      .setIssuer(this.env.AUTH_ISSUER)
      .setAudience(this.env.AUTH_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.env.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(privateKey);
  }
}
