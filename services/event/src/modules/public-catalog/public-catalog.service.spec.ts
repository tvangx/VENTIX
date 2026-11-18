import { catalogSaleSummary, matchesEtag, responseEtag } from "./public-catalog.service";
import { catalogDetailKey, catalogListKey } from "./catalog-cache";

describe("S-204 catalog cache keys and validators", () => {
  it("uses a stable bounded list key and event hash tag for detail", () => {
    expect(catalogListKey({ q: "Concert", cursor: undefined, limit: 20 })).toBe(
      catalogListKey({ q: "concert", cursor: undefined, limit: 20 }),
    );
    expect(catalogListKey({ q: "concert", cursor: undefined, limit: 20 })).not.toBe(
      catalogListKey({ q: "concert", cursor: undefined, limit: 21 }),
    );
    expect(catalogDetailKey("abc")).toBe("catalog:{evt:abc}:detail");
  });

  it("uses deterministic ETags and accepts standard If-None-Match forms", () => {
    const tag = responseEtag({ id: "a", version: 1 });
    expect(tag).toBe(responseEtag({ id: "a", version: 1 }));
    expect(tag).not.toBe(responseEtag({ id: "a", version: 2 }));
    expect(matchesEtag(`"other", W/${tag}`, tag)).toBe(true);
    expect(matchesEtag("*", tag)).toBe(true);
    expect(matchesEtag('"other"', tag)).toBe(false);
  });

  it("separates date, price and sort variants in Redis", () => {
    const base = { limit: 20 };
    for (const filter of [
      { start_from: "2032-01-01T00:00:00Z" },
      { start_before: "2032-01-02T00:00:00Z" },
      { min_price_vnd: 0 },
      { max_price_vnd: 500 },
      { sort: "start_at" as const },
      { sort: "price_asc" as const },
    ]) {
      expect(catalogListKey({ ...base, ...filter })).not.toBe(catalogListKey(base));
    }
  });

  it("uses the same sale schedule before, at and after opening", () => {
    const windows = [
      { starts_at: "2032-01-01T10:00:00Z", ends_at: "2032-01-01T11:00:00Z", queue_enabled: true },
      { starts_at: "2032-01-01T12:00:00Z", ends_at: "2032-01-01T13:00:00Z", queue_enabled: false },
    ];
    expect(catalogSaleSummary(windows, new Date("2032-01-01T09:59:59Z"))).toEqual({
      sale_status: "UPCOMING",
      next_sale_starts_at: "2032-01-01T10:00:00.000Z",
      sale_queue_enabled: true,
    });
    expect(catalogSaleSummary(windows, new Date("2032-01-01T10:00:00Z"))).toEqual({
      sale_status: "ON_SALE",
      next_sale_starts_at: "2032-01-01T12:00:00.000Z",
      sale_queue_enabled: true,
    });
    expect(catalogSaleSummary(windows, new Date("2032-01-01T11:00:00Z")).sale_status).toBe(
      "UPCOMING",
    );
    expect(catalogSaleSummary(windows, new Date("2032-01-01T13:00:00Z"))).toEqual({
      sale_status: "CLOSED",
      next_sale_starts_at: null,
      sale_queue_enabled: false,
    });
  });
});
