import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { Prisma, Organizer } from "../../../generated/client";
import { PrismaService } from "../../db/prisma.service";
import type { OrganizerDecisionDto, OrganizerListDto } from "./organizers.dto";

export const applicationResponse = (row: Organizer) => ({
  id: row.id,
  owner_user_id: row.ownerUserId,
  company_name: row.companyName,
  tax_code: row.taxCode,
  status: row.status,
  version: row.version,
  created_at: row.createdAt.toISOString(),
  approved_at: row.approvedAt?.toISOString() ?? null,
});

@Injectable()
export class OrganizersRepository {
  constructor(private readonly prisma: PrismaService) {}
  async get(id: string) {
    const row = await this.prisma.organizer.findUnique({
      where: { id },
      include: { documents: true },
    });
    if (!row) throw new ProblemException("ORGANIZER_NOT_FOUND", 404, "Không tìm thấy hồ sơ");
    return row;
  }
  async lockOwned(tx: Prisma.TransactionClient, id: string, userId: string) {
    await tx.$queryRaw`SELECT id FROM organizers WHERE id=${id}::uuid FOR UPDATE`;
    const row = await tx.organizer.findUnique({ where: { id } });
    if (!row) throw new ProblemException("ORGANIZER_NOT_FOUND", 404, "Không tìm thấy hồ sơ");
    if (row.ownerUserId !== userId)
      throw new ProblemException("FORBIDDEN", 403, "Không có quyền với hồ sơ");
    if (row.status !== "PENDING")
      throw new ProblemException("ORGANIZER_NOT_PENDING", 409, "Hồ sơ không còn chờ duyệt");
    return row;
  }
  async list(query: OrganizerListDto) {
    const rows = await this.prisma.organizer.findMany({
      where: { status: query.status },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const data = rows.slice(0, query.limit);
    return {
      data: data.map(applicationResponse),
      next_cursor: rows.length > query.limit ? data.at(-1)!.id : null,
    };
  }
  async decide(id: string, adminId: string, dto: OrganizerDecisionDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizers WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.organizer.findUnique({ where: { id }, include: { documents: true } });
      if (!row) throw new ProblemException("ORGANIZER_NOT_FOUND", 404, "Không tìm thấy hồ sơ");
      if (row.status !== "PENDING" || row.version !== dto.version)
        throw new ProblemException(
          "ORGANIZER_VERSION_CONFLICT",
          409,
          "Hồ sơ đã được xử lý hoặc phiên bản đã thay đổi",
        );
      if (dto.decision === "APPROVED") {
        if (!row.documents.some((d) => d.docType === "BUSINESS_LICENSE"))
          throw new ProblemException("LICENSE_REQUIRED", 422, "Cần giấy phép trước khi duyệt");
        const role = await tx.role.findUniqueOrThrow({ where: { code: "ORGANIZER" } });
        const prior = await tx.userRole.findUnique({
          where: { userId_roleId: { userId: row.ownerUserId, roleId: role.id } },
        });
        if (prior && prior.organizerId !== id)
          throw new ProblemException(
            "ORGANIZER_SCOPE_CONFLICT",
            409,
            "User đã có scope ORGANIZER khác",
          );
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: row.ownerUserId, roleId: role.id } },
          create: { userId: row.ownerUserId, roleId: role.id, organizerId: id },
          update: {},
        });
      }
      const updated = await tx.organizer.updateMany({
        where: { id, status: "PENDING", version: dto.version },
        data: {
          status: dto.decision,
          version: { increment: 1 },
          approvedBy: dto.decision === "APPROVED" ? adminId : null,
          approvedAt: dto.decision === "APPROVED" ? new Date() : null,
        },
      });
      if (updated.count !== 1)
        throw new ProblemException("ORGANIZER_VERSION_CONFLICT", 409, "Hồ sơ đã thay đổi");
      return applicationResponse(await tx.organizer.findUniqueOrThrow({ where: { id } }));
    });
  }
}
