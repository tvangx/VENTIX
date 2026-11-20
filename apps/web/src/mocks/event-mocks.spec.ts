import axios from "axios";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SERVICE_PREFIX, toProblem, type EventPaths } from "@/lib/api";
import { createServiceClient } from "@/lib/api/typed-client";
import type { CatalogQuery } from "@/lib/catalog/filters";
import { mockConfig, resetMockState } from "./db";
import { mockServer } from "./node";

// Mock catalog công khai (S-204) chạy qua typed client như app thật.

const api = createServiceClient<EventPaths>(
  axios.create({ baseURL: "http://localhost/api" }),
  SERVICE_PREFIX.event,
);
// Thứ Tư 18/11/2026, 12:00 giờ Việt Nam.
const NOW = Date.parse("2026-11-18T05:00:00Z");
const SONG_AM = "30000000-0000-4000-8000-000000000001";
const GIO_MUA = "30000000-0000-4000-8000-000000000002";
const GIAO_HUONG = "30000000-0000-4000-8000-000000000003";
const KICH = "30000000-0000-4000-8000-000000000004";
const NEON_PENDING = "30000000-0000-4000-8000-000000000005";

const realNow = mockConfig.now;
beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  resetMockState();
  mockConfig.now = () => NOW;
});
afterEach(() => {
  mockConfig.now = realNow;
  mockServer.resetHandlers();
});
afterAll(() => mockServer.close());

async function ids(query: CatalogQuery = {}) {
  const page = await api.get("/v1/events", { query });
  return page.items.map((item) => item.id);
}

async function problemOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return toProblem(error);
  }
  throw new Error("request phải lỗi");
}

describe("GET /v1/events (mock)", () => {
  it("chỉ trả sự kiện PUBLISHED, kèm địa điểm, giá thấp nhất và tình trạng bán", async () => {
    const page = await api.get("/v1/events");
    expect(page.items.map((item) => item.id)).toEqual([SONG_AM, GIO_MUA, GIAO_HUONG, KICH]);
    expect(page.next_cursor).toBeNull();
    expect(page.items[0]).toMatchObject({
      venue_name: "Nhà thi đấu Ánh Sao",
      min_ticket_price_vnd: 800_000,
      sale_status: "ON_SALE",
      sale_queue_enabled: true,
      next_sale_starts_at: null,
    });
    expect(page.items.find((item) => item.id === GIAO_HUONG)).toMatchObject({
      sale_status: "UPCOMING",
      next_sale_starts_at: "2026-12-01T03:00:00.000Z",
    });
    expect(page.items.some((item) => item.id === NEON_PENDING)).toBe(false);
  });

  it("tìm theo tiêu đề, tên hoặc địa chỉ địa điểm, không phân biệt hoa thường", async () => {
    expect(await ids({ q: "ÁNH SAO" })).toEqual([SONG_AM]);
    expect(await ids({ q: "hà nội" })).toEqual([GIAO_HUONG, KICH]);
    expect(await ids({ q: "không có" })).toEqual([]);
  });

  it("lọc theo ngày, giá, tình trạng", async () => {
    expect(
      await ids({
        start_from: "2026-12-01T00:00:00+07:00",
        start_before: "2027-01-01T00:00:00+07:00",
      }),
    ).toEqual([SONG_AM, KICH]);
    expect(await ids({ min_price_vnd: 300_000, max_price_vnd: 1_000_000 })).toEqual([
      SONG_AM,
      GIAO_HUONG,
      KICH,
    ]);
    expect(await ids({ sale_status: "UPCOMING" })).toEqual([GIAO_HUONG]);
    expect(await ids({ sale_status: "CLOSED" })).toEqual([]);
  });

  it("sắp xếp theo ngày diễn và theo giá", async () => {
    expect(await ids({ sort: "start_at" })).toEqual([KICH, SONG_AM, GIO_MUA, GIAO_HUONG]);
    expect(await ids({ sort: "price_asc" })).toEqual([KICH, GIAO_HUONG, SONG_AM, GIO_MUA]);
  });

  it("phân trang theo cursor đúng dạng của event-service, không trùng không sót", async () => {
    for (const sort of ["id", "start_at", "price_asc"] as const) {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await api.get("/v1/events", {
          query: { sort, ...(cursor ? { cursor } : {}), ...({ limit: 3 } as object) },
        });
        seen.push(...page.items.map((item) => item.id));
        cursor = page.next_cursor ?? undefined;
        pages += 1;
      } while (cursor);
      expect(pages).toBe(2);
      expect(seen).toEqual(await ids({ sort }));
    }
    const first = await api.get("/v1/events", {
      query: { sort: "start_at", ...({ limit: 1 } as object) },
    });
    expect(first.next_cursor).toBe(`start_at|${KICH}|2026-12-05T12:00:00.000000Z`);
  });

  it("input sai → 400 problem+json như backend", async () => {
    expect(
      await problemOf(api.get("/v1/events", { query: { cursor: "start_at|x|y" } })),
    ).toMatchObject({
      status: 400,
      code: "INVALID_CATALOG_CURSOR",
    });
    expect(
      await problemOf(api.get("/v1/events", { query: { min_price_vnd: 2, max_price_vnd: 1 } })),
    ).toMatchObject({ status: 400, code: "INVALID_CATALOG_RANGE" });
    expect(
      await problemOf(api.get("/v1/events", { query: { start_from: "2026-12-01" } })),
    ).toMatchObject({ status: 400 });
  });
});

describe("GET /v1/events/{id} (mock)", () => {
  it("trả địa điểm, hạng vé, đợt bán theo hợp đồng", async () => {
    const detail = await api.get("/v1/events/{id}", { path: { id: SONG_AM } });
    expect(detail.venue.name).toBe("Nhà thi đấu Ánh Sao");
    expect(detail.ticket_classes.map((tc) => tc.name)).toEqual([
      "SVIP",
      "VIP",
      "Standard",
      "Economy",
    ]);
    expect(detail.sale_phases.map((p) => p.per_user_limit)).toEqual([2, 4]);
    expect(detail.seat_map).toBeNull();
  });

  it("sự kiện chưa công khai → 404; id sai dạng → 400", async () => {
    expect(
      await problemOf(api.get("/v1/events/{id}", { path: { id: NEON_PENDING } })),
    ).toMatchObject({
      status: 404,
      code: "EVENT_NOT_FOUND",
    });
    expect(await problemOf(api.get("/v1/events/{id}", { path: { id: "abc" } }))).toMatchObject({
      status: 400,
    });
  });
});
