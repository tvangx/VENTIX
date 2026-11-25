import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { ProblemException } from "@ticketing/common";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";
import { MetricsService } from "../../metrics/metrics";
import { publicAssetUrl, thumbnailKeyFor } from "../banners/banner-file";
import {
  eventResponse,
  page,
  salePhaseResponse,
  seatMapResponse,
  ticketClassResponse,
  venueResponse,
} from "../organizer/organizer.responses";
import { CatalogCache, catalogDetailKey, catalogListKey } from "./catalog-cache";
import { readCatalogCursor } from "./catalog-cursor";
import type { CatalogCard, CatalogQuery } from "./public-catalog.dto";
import { PublicCatalogRepository, type CatalogSaleWindow } from "./public-catalog.repository";

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

export function catalogSaleSummary(
  windows: CatalogSaleWindow[],
  now: Date,
): Pick<CatalogCard, "sale_status" | "next_sale_starts_at" | "sale_queue_enabled"> {
  const current = windows.find(
    (phase) => Date.parse(phase.starts_at) <= +now && Date.parse(phase.ends_at) > +now,
  );
  const next = windows.find((phase) => Date.parse(phase.starts_at) > +now);
  return {
    next_sale_starts_at: next ? new Date(next.starts_at).toISOString() : null,
    sale_status: current ? "ON_SALE" : next ? "UPCOMING" : "CLOSED",
    sale_queue_enabled: (current ?? next)?.queue_enabled ?? false,
  };
}

@Injectable()
export class PublicCatalogService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repo: PublicCatalogRepository,
    private readonly cache: CatalogCache,
    private readonly metrics: MetricsService,
  ) {}

  async list(query: CatalogQuery) {
    const start = query.start_from === undefined ? -Infinity : Date.parse(query.start_from);
    const end = query.start_before === undefined ? Infinity : Date.parse(query.start_before);
    if (Number.isNaN(start) || Number.isNaN(end) || start >= end) {
      throw new ProblemException(
        "INVALID_CATALOG_RANGE",
        400,
        "start_from phải trước start_before",
      );
    }
    if (
      query.min_price_vnd !== undefined &&
      query.max_price_vnd !== undefined &&
      query.min_price_vnd > query.max_price_vnd
    ) {
      throw new ProblemException(
        "INVALID_CATALOG_RANGE",
        400,
        "min_price_vnd phải nhỏ hơn hoặc bằng max_price_vnd",
      );
    }

    const cursor = readCatalogCursor(query);
    const now = new Date();
    const load = async () => {
      const rows = await this.repo.list(query, now, cursor);
      const result = page(rows, query, (row) => ({
        ...eventResponse(row),
        venue_name: row.venueName,
        venue_address: row.venueAddress,
        min_ticket_price_vnd: row.minPrice === null ? null : Number(row.minPrice),
        windows: row.windows,
      }));
      if (!result.next_cursor) return result;
      const last = rows[query.limit - 1];
      if (query.sort === "start_at") result.next_cursor = `start_at|${last.id}|${last.startCursor}`;
      if (query.sort === "price_asc")
        result.next_cursor = `price_asc|${last.id}|${last.minPrice ?? "-"}`;
      return result;
    };
    // Lọc theo trạng thái bán cần xét thời điểm hiện tại ngay trong truy vấn phân trang.
    const result = query.sale_status
      ? { value: await load(), hit: false }
      : await this.cache.getOrLoad(catalogListKey(query), load);
    this.metrics.catalogCache.inc({ result: result.hit ? "hit" : "miss" });
    // Cache có thể được ghi trước transaction hủy; chỉ DB quyết định quyền xuất hiện.
    const published = await this.repo.publishedIds(result.value.items.map((item) => item.id));
    return {
      items: result.value.items
        .filter((item) => published.has(item.id))
        .map(({ windows, ...item }) => ({
          ...item,
          // Tính sau cache để đổi PUBLIC_ASSET_BASE_URL có hiệu lực ngay, không chờ hết TTL.
          banner_url: publicAssetUrl(this.env.PUBLIC_ASSET_BASE_URL, item.banner_key),
          thumbnail_url: publicAssetUrl(
            this.env.PUBLIC_ASSET_BASE_URL,
            thumbnailKeyFor(item.banner_key),
          ),
          ...catalogSaleSummary(windows, now),
        })),
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
    return {
      ...result.value,
      banner_url: publicAssetUrl(this.env.PUBLIC_ASSET_BASE_URL, result.value.banner_key),
      thumbnail_url: publicAssetUrl(
        this.env.PUBLIC_ASSET_BASE_URL,
        thumbnailKeyFor(result.value.banner_key),
      ),
    };
  }
}
