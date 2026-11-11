import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "../../../generated/client";
import { PrismaService } from "../../db/prisma.service";

export function notFound() {
  return new ProblemException("NOT_FOUND", 404, "Không tìm thấy tài nguyên trong tenant");
}

export function checkVersion(actual: number, expected: number) {
  if (actual !== expected) {
    throw new ProblemException("VERSION_CONFLICT", 409, "Phiên bản tài nguyên đã thay đổi");
  }
}

export function checkEditable(status: string) {
  if (status !== "DRAFT" && status !== "REJECTED") {
    throw new ProblemException("EVENT_NOT_EDITABLE", 409, "Chỉ sửa sự kiện ở DRAFT hoặc REJECTED");
  }
}

export function checkRange(start: Date, end: Date) {
  if (!(start.getTime() < end.getTime())) {
    throw new ProblemException(
      "INVALID_TIME_RANGE",
      400,
      "Thời điểm kết thúc phải sau thời điểm bắt đầu",
    );
  }
}

@Injectable()
export class OrganizerWrites {
  constructor(private readonly db: PrismaService) {}

  async run(
    organizerId: string,
    key: string | undefined,
    operation: string,
    payload: object,
    write: (tx: Prisma.TransactionClient) => Promise<Prisma.InputJsonObject>,
    timeout = 15000,
  ): Promise<Prisma.JsonValue | Prisma.InputJsonObject> {
    const parsed = z.string().uuid().safeParse(key);
    if (!parsed.success) {
      throw new ProblemException("INVALID_IDEMPOTENCY_KEY", 400, "Idempotency-Key phải là UUID");
    }
    const safeKey = parsed.data.toLowerCase();
    // DTO ghi chỉ có trường vô hướng. Sắp xếp tên để thứ tự thuộc tính JSON không đổi fingerprint.
    const fields = Object.entries(payload).filter(([, value]) => value !== undefined);
    fields.sort(([first], [second]) => first.localeCompare(second));
    const requestHash = createHash("sha256")
      .update(JSON.stringify([operation, fields]))
      .digest("hex");

    try {
      return await this.db.$transaction(
        async (tx) => {
          // Chỉ giữ khóa tới khi commit/rollback, kể cả khi nhiều process nhận cùng key.
          await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${organizerId + safeKey}, 0))::text
      `;
          const previous = await tx.idempotencyRecord.findUnique({
            where: { organizerId_key: { organizerId, key: safeKey } },
          });
          if (previous) {
            if (previous.requestHash !== requestHash) {
              throw new ProblemException(
                "IDEMPOTENCY_KEY_REUSED",
                409,
                "Key đã dùng với yêu cầu khác",
              );
            }
            return previous.response;
          }
          const response = await write(tx);
          await tx.idempotencyRecord.create({
            data: { organizerId, key: safeKey, requestHash, response },
          });
          return response;
        },
        { timeout, maxWait: 5000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2025") throw notFound();
        if (error.code === "P2002") {
          throw new ProblemException("RESOURCE_CONFLICT", 409, "Tài nguyên trùng lặp");
        }
        if (error.code === "P2003") {
          throw new ProblemException(
            "RESOURCE_IN_USE",
            409,
            "Quan hệ tài nguyên đang được sử dụng hoặc đã thay đổi",
          );
        }
      }
      throw error;
    }
  }
}
