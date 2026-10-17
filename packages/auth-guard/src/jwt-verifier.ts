import { Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { KeyLike, createRemoteJWKSet, importSPKI, jwtVerify, JWTVerifyGetKey } from "jose";
import { AUTH_OPTIONS, AuthGuardOptions } from "./options";

export interface AuthUser {
  userId: string;
  roles: string[];
  organizerId?: string;
}

const ALGORITHMS = ["RS256"]; // ADR-0004: chỉ RS256, không bao giờ nới.

@Injectable()
export class JwtVerifier {
  private staticKey?: Promise<KeyLike>;
  private remote?: JWTVerifyGetKey;

  constructor(@Inject(AUTH_OPTIONS) private readonly options: AuthGuardOptions) {
    if (options.jwksUri) {
      // jose tự cache và chỉ tải lại khi gặp `kid` lạ, tối thiểu cách nhau `cooldownDuration`.
      this.remote = createRemoteJWKSet(new URL(options.jwksUri), {
        cooldownDuration: options.jwksCooldownMs ?? 30_000,
        cacheMaxAge: options.jwksCacheMs ?? 600_000,
      });
    } else if (options.publicKeyPem) {
      this.staticKey = importSPKI(options.publicKeyPem, "RS256");
    } else {
      throw new Error("auth-guard requires jwksUri or publicKeyPem");
    }
  }

  /** Ném `ProblemException` 401 cho mọi lý do token không hợp lệ (không nói rõ lý do ra ngoài). */
  async verify(token: string): Promise<AuthUser> {
    try {
      const opts = {
        algorithms: ALGORITHMS,
        issuer: this.options.issuer,
        audience: this.options.audience,
        requiredClaims: ["exp", "sub"],
        clockTolerance: this.options.clockToleranceSec ?? 5,
      };
      const { payload } = this.remote
        ? await jwtVerify(token, this.remote, opts)
        : await jwtVerify(token, await (this.staticKey as Promise<KeyLike>), opts);

      const roles = Array.isArray(payload.roles)
        ? payload.roles.filter((r): r is string => typeof r === "string")
        : [];
      const organizerId =
        typeof payload.organizer_id === "string" ? payload.organizer_id : undefined;
      return { userId: payload.sub as string, roles, ...(organizerId ? { organizerId } : {}) };
    } catch {
      throw new ProblemException("INVALID_TOKEN", 401, "Token không hợp lệ hoặc đã hết hạn");
    }
  }
}
