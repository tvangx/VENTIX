import { HttpResponse } from "msw";
import { SERVICE_PREFIX, type EventPaths, type EventSchemas } from "@/lib/api";
import { mockConfig } from "../db";
import { mockSeatMapLayout } from "../seat-map";
import { seedEvents, seedVenues, type SeedEvent } from "../seed";
import { mockService, problem, UUID_RE } from "./typed";

// Catalog công khai của event-service (S-204), dữ liệu từ seed V-104.
// Bám logic của services/event/src/modules/public-catalog: chỉ PUBLISHED, cùng bộ lọc, cách sắp
// xếp và dạng cursor, để UI chạy bằng mock giống khi gọi backend thật.

const api = mockService<EventPaths>(SERVICE_PREFIX.event);

type CatalogCard = EventSchemas["schemas"]["CatalogCard"];
type CatalogDetail = EventSchemas["schemas"]["CatalogDetail"];
type Sort = "id" | "start_at" | "price_asc";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** Thời điểm tạo/sửa cố định cho bản ghi seed (API bắt buộc có hai trường này). */
const SEED_TIME = "2026-10-01T00:00:00.000Z";
const SORTS: readonly Sort[] = ["id", "start_at", "price_asc"];
const SALE_STATUSES = ["UPCOMING", "ON_SALE", "CLOSED"] as const;
// Như DTO của event-service: ISO-8601 có ngày giờ và múi giờ.
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

function venueOf(event: SeedEvent) {
  const venue = seedVenues.find((item) => item.id === event.venue_id);
  if (!venue) throw new Error(`seed thiếu địa điểm ${event.venue_id}`);
  return venue;
}

function minPrice(event: SeedEvent): number | null {
  const prices = event.ticket_classes.map((tc) => tc.price_vnd);
  return prices.length ? Math.min(...prices) : null;
}

/** Như `catalogSaleSummary` của event-service: đợt đang mở, nếu không thì đợt sắp mở gần nhất. */
function saleSummary(event: SeedEvent, now: number) {
  const windows = [...event.sale_phases]
    .filter((phase) => Date.parse(phase.ends_at) > now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const current = windows.find((phase) => Date.parse(phase.starts_at) <= now);
  const next = windows.find((phase) => Date.parse(phase.starts_at) > now);
  return {
    next_sale_starts_at: next ? new Date(next.starts_at).toISOString() : null,
    sale_status: current ? "ON_SALE" : next ? "UPCOMING" : "CLOSED",
    sale_queue_enabled: (current ?? next)?.queue_enabled ?? false,
  } as const;
}

function baseOf(event: SeedEvent) {
  return {
    id: event.id,
    version: event.version,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
    organizer_id: event.organizer_id,
    status: event.status,
    venue_id: event.venue_id,
    title: event.title,
    description: event.description,
    banner_key: event.banner_key,
    start_at: new Date(event.start_at).toISOString(),
    end_at: new Date(event.end_at).toISOString(),
  };
}

function cardOf(event: SeedEvent, now: number): CatalogCard {
  const venue = venueOf(event);
  return {
    ...baseOf(event),
    banner_url: null,
    thumbnail_url: null,
    venue_name: venue.name,
    venue_address: venue.address,
    min_ticket_price_vnd: minPrice(event),
    ...saleSummary(event, now),
  };
}

function detailOf(event: SeedEvent): CatalogDetail {
  const venue = venueOf(event);
  const meta = { version: 1, created_at: SEED_TIME, updated_at: SEED_TIME };
  return {
    ...baseOf(event),
    banner_url: null,
    thumbnail_url: null,
    venue: { ...venue, ...meta, organizer_id: event.organizer_id },
    ticket_classes: [...event.ticket_classes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((tc) => ({ ...tc, ...meta, event_id: event.id })),
    sale_phases: [...event.sale_phases]
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id))
      .map((phase) => ({
        ...meta,
        id: phase.id,
        event_id: event.id,
        starts_at: new Date(phase.starts_at).toISOString(),
        ends_at: new Date(phase.ends_at).toISOString(),
        queue_enabled: phase.queue_enabled,
        admit_rate: phase.admit_rate,
        per_user_limit: phase.per_user_limit,
        require_kyc: phase.require_kyc,
      })),
    seat_map: seatMapOf(event),
  };
}

/** Seat map đã publish (mock sinh từ capacity, xem ../seat-map.ts); null với sự kiện chỉ có vé đứng. */
function seatMapOf(event: SeedEvent): CatalogDetail["seat_map"] {
  const layout = mockSeatMapLayout(event);
  if (!layout) return null;
  return {
    id: `33000000-0000-4000-8000-${event.id.slice(-12)}`,
    version: 1,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
    event_id: event.id,
    layout,
    published_at: SEED_TIME,
  };
}

/** `start_at` dạng micro giây như cursor của event-service. */
function startCursor(iso: string): string {
  return new Date(iso).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

function compare(sort: Sort, a: CatalogCard, b: CatalogCard): number {
  if (sort === "start_at") return a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id);
  if (sort === "price_asc") {
    const pa = a.min_ticket_price_vnd ?? Number.MAX_SAFE_INTEGER;
    const pb = b.min_ticket_price_vnd ?? Number.MAX_SAFE_INTEGER;
    return pa - pb || a.id.localeCompare(b.id);
  }
  return a.id.localeCompare(b.id);
}

/** Vị trí bắt đầu trang sau; null khi cursor không hợp lệ (backend trả 400). */
function afterCursor(sort: Sort, cursor: string, card: CatalogCard): boolean | null {
  if (sort === "id") {
    if (!UUID_RE.test(cursor)) return null;
    return card.id > cursor;
  }
  const [tokenSort, id, value, ...rest] = cursor.split("|");
  if (tokenSort !== sort || !id || !UUID_RE.test(id) || value === undefined || rest.length) {
    return null;
  }
  if (sort === "start_at") {
    const at = startCursor(card.start_at);
    return at > value || (at === value && card.id > id);
  }
  const price = card.min_ticket_price_vnd ?? Number.MAX_SAFE_INTEGER;
  const mark = value === "-" ? Number.MAX_SAFE_INTEGER : Number(value);
  if (!Number.isSafeInteger(mark)) return null;
  return price > mark || (price === mark && card.id > id);
}

function nextCursor(sort: Sort, last: CatalogCard): string {
  if (sort === "start_at") return `start_at|${last.id}|${startCursor(last.start_at)}`;
  if (sort === "price_asc") return `price_asc|${last.id}|${last.min_ticket_price_vnd ?? "-"}`;
  return last.id;
}

function intParam(value: string | null): number | undefined | null {
  if (value === null) return undefined;
  return /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

function invalid(detail: string) {
  return problem(400, "INVALID_INPUT", detail);
}

export const eventHandlers = [
  api.get("/v1/events", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const now = mockConfig.now();
    const q = params.get("q")?.trim().toLowerCase() ?? "";
    const sortParam = params.get("sort") ?? "id";
    const sort = SORTS.find((item) => item === sortParam);
    if (!sort) return invalid("sort không hợp lệ");
    const saleParam = params.get("sale_status");
    const saleStatus = SALE_STATUSES.find((item) => item === saleParam);
    if (saleParam !== null && !saleStatus) return invalid("sale_status không hợp lệ");
    const limit = intParam(params.get("limit")) ?? DEFAULT_LIMIT;
    if (limit === null || limit < 1 || limit > MAX_LIMIT) return invalid("limit từ 1 đến 100");
    const minPriceVnd = intParam(params.get("min_price_vnd"));
    const maxPriceVnd = intParam(params.get("max_price_vnd"));
    if (minPriceVnd === null || maxPriceVnd === null) return invalid("Giá phải là số nguyên ≥ 0");
    const startFrom = params.get("start_from");
    const startBefore = params.get("start_before");
    for (const value of [startFrom, startBefore]) {
      if (value !== null && (!TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value)))) {
        return invalid("Mốc thời gian cần dạng ISO-8601 có múi giờ");
      }
    }
    if (startFrom && startBefore && Date.parse(startFrom) >= Date.parse(startBefore)) {
      return problem(400, "INVALID_CATALOG_RANGE", "start_from phải nhỏ hơn start_before");
    }
    if (minPriceVnd !== undefined && maxPriceVnd !== undefined && minPriceVnd > maxPriceVnd) {
      return problem(
        400,
        "INVALID_CATALOG_RANGE",
        "min_price_vnd phải nhỏ hơn hoặc bằng max_price_vnd",
      );
    }

    let cards = seedEvents
      .filter((event) => event.status === "PUBLISHED")
      .map((event) => cardOf(event, now))
      .filter((card) => {
        if (
          q &&
          ![card.title, card.venue_name, card.venue_address].some((text) =>
            text.toLowerCase().includes(q),
          )
        ) {
          return false;
        }
        const start = Date.parse(card.start_at);
        if (startFrom && start < Date.parse(startFrom)) return false;
        if (startBefore && start >= Date.parse(startBefore)) return false;
        // Như SQL: so sánh với giá NULL loại sự kiện chưa có hạng vé.
        const price = card.min_ticket_price_vnd;
        if (minPriceVnd !== undefined && (price === null || price < minPriceVnd)) return false;
        if (maxPriceVnd !== undefined && (price === null || price > maxPriceVnd)) return false;
        return !saleStatus || card.sale_status === saleStatus;
      })
      .sort((a, b) => compare(sort, a, b));

    const cursor = params.get("cursor");
    if (cursor !== null) {
      const kept: CatalogCard[] = [];
      for (const card of cards) {
        const after = afterCursor(sort, cursor, card);
        if (after === null) {
          return problem(400, "INVALID_CATALOG_CURSOR", "Cursor không hợp lệ cho kiểu sắp xếp");
        }
        if (after) kept.push(card);
      }
      cards = kept;
    }
    const items = cards.slice(0, limit);
    const last = items[items.length - 1];
    return HttpResponse.json({
      items,
      next_cursor: cards.length > limit && last ? nextCursor(sort, last) : null,
    });
  }),

  api.get("/v1/events/{id}", ({ params }) => {
    // event-service dùng ParseUUIDPipe: id sai dạng → 400 trước khi tra cứu.
    if (!UUID_RE.test(params.id)) return invalid("id phải là UUID");
    const event = seedEvents.find((item) => item.id === params.id && item.status === "PUBLISHED");
    if (!event) return problem(404, "EVENT_NOT_FOUND", "Không tìm thấy sự kiện công khai");
    return HttpResponse.json(detailOf(event));
  }),
];
