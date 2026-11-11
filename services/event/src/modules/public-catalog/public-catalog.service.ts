import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { ProblemException } from "@ticketing/common";
import { MetricsService } from "../../metrics/metrics";
import {
  eventResponse,
  page,
  salePhaseResponse,
  seatMapResponse,
  ticketClassResponse,
  venueResponse,
} from "../organizer/organizer.responses";
import { CatalogCache, catalogDetailKey, catalogListKey } from "./catalog-cache";
import type { CatalogQuery } from "./public-catalog.dto";
import { PublicCatalogRepository } from "./public-catalog.repository";

export function responseEtag(body: unknown): string {
  return `"${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
}

export function matchesEtag(header: string | undefined, etag: string): boolean {
  return (
    header?.split(",").some((candidate) => {
      const tag = candidate.trim();
      return tag === "*" || tag.replace(/^W\//, "") === etag;
    }) ?? false
  );
}

@Injectable()
export class PublicCatalogService {
  constructor(
    private readonly repo: PublicCatalogRepository,
    private readonly cache: CatalogCache,
    private readonly metrics: MetricsService,
  ) {}

  async list(query: CatalogQuery) {
    const result = await this.cache.getOrLoad(catalogListKey(query), async () =>
      page(await this.repo.list(query), query, eventResponse),
    );
    this.metrics.catalogCache.inc({ result: result.hit ? "hit" : "miss" });
    // Cache có thể được ghi trước transaction hủy; chỉ DB quyết định quyền xuất hiện.
    const published = await this.repo.publishedIds(result.value.items.map((item) => item.id));
    return {
      items: result.value.items.filter((item) => published.has(item.id)),
      next_cursor: result.value.next_cursor,
    };
  }

  async detail(id: string) {
    const result = await this.cache.getOrLoad(catalogDetailKey(id), async () => {
      const row = await this.repo.detail(id);
      if (!row) return null;
      return {
        ...eventResponse(row),
        venue: venueResponse(row.venue),
        ticket_classes: row.ticketClasses.map(ticketClassResponse),
        sale_phases: row.salePhases.map(salePhaseResponse),
        seat_map: row.seatMaps[0] ? seatMapResponse(row.seatMaps[0]) : null,
      };
    });
    this.metrics.catalogCache.inc({ result: result.hit ? "hit" : "miss" });
    const published = await this.repo.publishedIds([id]);
    if (!result.value || !published.has(id)) {
      throw new ProblemException("EVENT_NOT_FOUND", 404, "Không tìm thấy sự kiện công khai");
    }
    return result.value;
  }
}
