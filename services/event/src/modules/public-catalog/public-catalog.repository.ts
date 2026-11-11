import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../db/prisma.service";
import type { CatalogQuery } from "./public-catalog.dto";

@Injectable()
export class PublicCatalogRepository {
  constructor(private readonly db: PrismaService) {}

  list(query: CatalogQuery) {
    return this.db.event.findMany({
      where: {
        status: "PUBLISHED",
        ...(query.q ? { title: { contains: query.q, mode: "insensitive" as const } } : {}),
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: query.limit + 1,
    });
  }

  detail(id: string) {
    return this.db.event.findFirst({
      where: { id, status: "PUBLISHED" },
      include: {
        venue: true,
        ticketClasses: { orderBy: { id: "asc" } },
        salePhases: { orderBy: [{ startsAt: "asc" }, { id: "asc" }] },
        seatMaps: { where: { publishedAt: { not: null } }, orderBy: { version: "desc" }, take: 1 },
      },
    });
  }

  async publishedIds(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.db.event.findMany({
      where: { id: { in: ids }, status: "PUBLISHED" },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }
}
