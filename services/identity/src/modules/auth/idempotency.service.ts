import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { z } from "zod";
import { Prisma } from "../../../generated/client";
import { PrismaService } from "../../db/prisma.service";
import { AuthKeys } from "./auth-keys";

@Injectable()
export class IdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: AuthKeys,
  ) {}
  async run(
    scope: string,
    key: string | undefined,
    payload: unknown,
    action: (tx: Prisma.TransactionClient) => Promise<Prisma.InputJsonObject>,
  ): Promise<Prisma.JsonValue> {
    if (!z.string().uuid().safeParse(key).success)
      throw new ProblemException("INVALID_IDEMPOTENCY_KEY", 400, "Idempotency-Key phải là UUID");
    const safeKey = key as string;
    const requestHash = await this.keys.fingerprint(payload);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope + safeKey}, 0))::text`;
        const previous = await tx.idempotencyRecord.findUnique({
          where: { scope_key: { scope, key: safeKey } },
        });
        if (previous) {
          if (previous.requestHash !== requestHash)
            throw new ProblemException(
              "IDEMPOTENCY_KEY_REUSED",
              409,
              "Key đã dùng với nội dung khác",
            );
          return previous.response;
        }
        const response = await action(tx);
        await tx.idempotencyRecord.create({ data: { scope, key: safeKey, requestHash, response } });
        return response as Prisma.JsonObject;
      },
      { timeout: 15000, maxWait: 5000 },
    );
  }
}
