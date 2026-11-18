import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { Request, Response } from "express";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { VerifyLimiter } from "./verify-limiter";

@Injectable()
export class VerifyGuard implements CanActivate {
  private readonly limiter: VerifyLimiter;
  constructor(@Inject(ENV) env: Env) {
    this.limiter = new VerifyLimiter(
      env.VERIFY_RATE_PER_PEER,
      env.VERIFY_RATE_TOTAL,
      env.VERIFY_RATE_WINDOW_MS,
    );
  }
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const wait = this.limiter.take(req.socket.remoteAddress ?? "unknown");
    if (wait) {
      res.setHeader("Retry-After", wait);
      throw new ProblemException(
        "VERIFY_RATE_LIMITED",
        429,
        "Please retry after the current verification window.",
      );
    }
    return true;
  }
}
