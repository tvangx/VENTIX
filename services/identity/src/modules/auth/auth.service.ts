import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { argon2id, hash, verify } from "argon2";
import { Prisma } from "../../../generated/client";
import { AuthKeys } from "./auth-keys";
import { AuthRepository } from "./auth.repository";
import { IdempotencyService } from "./idempotency.service";

@Injectable()
export class AuthService {
  private readonly dummyHash = hash("not-a-user-password", {
    type: argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  constructor(
    private readonly repository: AuthRepository,
    private readonly keys: AuthKeys,
    private readonly idempotency: IdempotencyService,
  ) {}

  async register(email: string, password: string, key?: string) {
    const passwordHash = await hash(password, {
      type: argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    try {
      return await this.idempotency.run("auth.register", key, { email, password }, async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            userRoles: { create: { role: { connect: { code: "USER" } } } },
          },
        });
        return { id: user.id, email: user.email };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new ProblemException("EMAIL_EXISTS", 409, "Email đã được sử dụng");
      throw error;
    }
  }
  async login(email: string, password: string) {
    const user = await this.repository.byEmail(email);
    const valid = await verify(user?.passwordHash ?? (await this.dummyHash), password);
    if (!user?.passwordHash || !valid || user.status !== "ACTIVE")
      throw new ProblemException("INVALID_CREDENTIALS", 401, "Email hoặc mật khẩu không hợp lệ");
    return this.startSession(user.id);
  }
  async startSession(userId: string) {
    const result = await this.repository.session(userId);
    if (!result) throw new ProblemException("INVALID_CREDENTIALS", 401, "Tài khoản không khả dụng");
    return {
      access_token: await this.keys.sign(result.userId, result.roles),
      refreshToken: result.raw,
    };
  }
  async refresh(raw: string) {
    const result = await this.repository.rotate(raw);
    if (!result)
      throw new ProblemException(
        "INVALID_REFRESH_TOKEN",
        401,
        "Phiên không hợp lệ, hãy đăng nhập lại",
      );
    return {
      access_token: await this.keys.sign(result.userId, result.roles),
      refreshToken: result.raw,
    };
  }
  logout(raw: string) {
    return this.repository.logout(raw);
  }
}
