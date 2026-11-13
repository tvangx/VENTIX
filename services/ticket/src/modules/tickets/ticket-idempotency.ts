import { Injectable } from "@nestjs/common";
import { AuthUser } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { SqlExecutor } from "@ticketing/outbox-inbox";
import { createHash } from "node:crypto";
import { z } from "zod";
import { TicketRepository } from "./ticket.repository";

@Injectable()
export class TicketIdempotency {
  constructor(private readonly repo: TicketRepository) {}

  async run<T>(
    executor: SqlExecutor,
    user: AuthUser,
    scope: string,
    key: string,
    payload: unknown,
    perform: () => Promise<T>,
  ): Promise<T> {
    if (!z.string().uuid().safeParse(key).success)
      throw new ProblemException(
        "IDEMPOTENCY_KEY_REQUIRED",
        400,
        "A UUID Idempotency-Key is required",
      );
    const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const cached = await this.repo.cachedRequest(executor, user.userId, scope, key);
    if (cached) {
      if (cached.fingerprint !== fingerprint)
        throw new ProblemException(
          "IDEMPOTENCY_KEY_REUSED",
          409,
          "Request key was used with different input",
        );
      return cached.response as T;
    }
    const response = await perform();
    await this.repo.rememberRequest(executor, user.userId, scope, key, fingerprint, response);
    return response;
  }
}
