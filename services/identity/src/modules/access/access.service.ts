import { Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";
import { AuthKeys } from "../auth/auth-keys";
import { AccessRepository } from "./access.repository";

@Injectable()
export class AccessService {
  constructor(
    private readonly repository: AccessRepository,
    private readonly keys: AuthKeys,
    @Inject(ENV) private readonly env: Env,
  ) {}
  async me(userId: string) {
    const user = await this.repository.user(userId);
    if (!user || user.status !== "ACTIVE")
      throw new ProblemException("ACCOUNT_UNAVAILABLE", 403, "Tài khoản không khả dụng");
    return {
      id: user.id,
      email: user.email,
      roles: user.userRoles.filter((r) => !r.organizerId).map((r) => r.role.code),
      memberships: user.userRoles
        .filter((r) => r.organizerId && r.organizer?.status === "APPROVED")
        .map((r) => ({ organizer_id: r.organizerId!, role: r.role.code })),
    };
  }
  async tenantRoles(userId: string, organizerId: string) {
    const me = await this.me(userId);
    const scoped = me.memberships.filter((m) => m.organizer_id === organizerId).map((m) => m.role);
    if (scoped.length === 0)
      throw new ProblemException("TENANT_MISMATCH", 403, "Không có quyền với organizer này");
    return [...me.roles, ...scoped];
  }
  async token(userId: string, organizerId: string) {
    const roles = await this.tenantRoles(userId, organizerId);
    return {
      access_token: await this.keys.sign(userId, roles, organizerId),
      token_type: "Bearer",
      expires_in: this.env.ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}
