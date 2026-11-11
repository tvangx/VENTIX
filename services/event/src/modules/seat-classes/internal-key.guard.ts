import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import type { Request } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";

function keyHash(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly expectedKey?: Buffer;

  constructor(@Inject(ENV) env: Env) {
    if (env.INTERNAL_API_KEY) this.expectedKey = keyHash(env.INTERNAL_API_KEY);
  }

  canActivate(context: ExecutionContext): boolean {
    const key = context.switchToHttp().getRequest<Request>().get("X-Internal-Key");
    if (this.expectedKey && key && timingSafeEqual(this.expectedKey, keyHash(key))) return true;
    throw new ProblemException("INTERNAL_AUTH_REQUIRED", 401, "Yêu cầu khóa API nội bộ");
  }
}
