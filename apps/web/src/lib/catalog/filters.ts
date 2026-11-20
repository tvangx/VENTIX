import type { EventPaths } from "@/lib/api";
import { VN_OFFSET_MS } from "./format";

// Bộ lọc trang Khám phá nằm trong query string của URL (chia sẻ link, quay lại vẫn giữ) và được
// đổi sang query của GET /v1/events (event-service, S-204). Giá trị lạ trên URL bị bỏ qua thay vì
// làm hỏng trang.

export type CatalogQuery = NonNullable<EventPaths["/v1/events"]["get"]["parameters"]["query"]>;
export type SaleStatus = NonNullable<CatalogQuery["sale_status"]>;

export const DATE_PRESETS = ["today", "weekend", "month", "range"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const PRICE_BANDS = {
  "under-300k": { label: "Dưới 300k", max: 299_999 },
  "300k-1m": { label: "300k đến 1 triệu", min: 300_000, max: 1_000_000 },
  "1m-2m": { label: "1 đến 2 triệu", min: 1_000_001, max: 2_000_000 },
  "over-2m": { label: "Trên 2 triệu", min: 2_000_001 },
} as const satisfies Record<string, { label: string; min?: number; max?: number }>;
export type PriceBand = keyof typeof PRICE_BANDS;

export const SORTS = {
  start_at: "Sắp diễn ra",
  price_asc: "Giá thấp trước",
} as const;
export type ExploreSort = keyof typeof SORTS;

export const SALE_STATUS_OPTIONS: Record<SaleStatus, string> = {
  ON_SALE: "Đang mở bán",
  UPCOMING: "Sắp mở bán",
  CLOSED: "Đã đóng bán",
};

export const DATE_LABELS: Record<DatePreset, string> = {
  today: "Hôm nay",
  weekend: "Cuối tuần này",
  month: "Tháng này",
  range: "Chọn ngày",
};

export interface ExploreFilters {
  q: string;
  date: DatePreset | null;
  /** YYYY-MM-DD theo giờ Việt Nam; chỉ dùng khi date = "range". */
  from: string | null;
  to: string | null;
  price: PriceBand | null;
  status: SaleStatus | null;
  sort: ExploreSort;
}

export const DEFAULT_FILTERS: ExploreFilters = {
  q: "",
  date: null,
  from: null,
  to: null,
  price: null,
  status: null,
  sort: "start_at",
};

/** Giới hạn của event-service cho `q`. */
export const MAX_QUERY_LENGTH = 100;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return allowed.find((item) => item === value) ?? null;
}

function validDay(value: string | null): string | null {
  if (!value || !DAY_RE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : null;
}

export function parseFilters(params: URLSearchParams): ExploreFilters {
  const date = pick(params.get("date"), DATE_PRESETS);
  const from = date === "range" ? validDay(params.get("from")) : null;
  const to = date === "range" ? validDay(params.get("to")) : null;
  return {
    q: (params.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH),
    // "range" chưa chọn mốc nào vẫn giữ để hiện ô chọn ngày; khi đó không lọc theo ngày.
    date,
    from,
    to: from && to && to < from ? from : to,
    price: pick(params.get("price"), Object.keys(PRICE_BANDS) as PriceBand[]),
    status: pick(params.get("status"), Object.keys(SALE_STATUS_OPTIONS) as SaleStatus[]),
    sort: pick(params.get("sort"), Object.keys(SORTS) as ExploreSort[]) ?? DEFAULT_FILTERS.sort,
  };
}

/** Ngược lại với parseFilters; bỏ giá trị mặc định để URL gọn. */
export function filtersToSearch(filters: ExploreFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.date) params.set("date", filters.date);
  if (filters.date === "range") {
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
  }
  if (filters.price) params.set("price", filters.price);
  if (filters.status) params.set("status", filters.status);
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort);
  return params;
}

export function hasActiveFilters(filters: ExploreFilters): boolean {
  return Boolean(filters.q || filters.date || filters.price || filters.status);
}

/** Ngày (theo giờ Việt Nam) của thời điểm `now`, dạng YYYY-MM-DD. */
export function vnDay(now: number): string {
  return new Date(now + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 00:00 giờ Việt Nam của một ngày, dạng ISO có múi giờ như event-service yêu cầu. */
function vnMidnight(day: string): string {
  return `${day}T00:00:00+07:00`;
}

/** Khoảng [from, before) theo giờ Việt Nam cho bộ lọc ngày. */
export function dateRange(
  filters: Pick<ExploreFilters, "date" | "from" | "to">,
  now: number,
): { start_from?: string; start_before?: string } {
  const today = vnDay(now);
  switch (filters.date) {
    case "today":
      return { start_from: vnMidnight(today), start_before: vnMidnight(addDays(today, 1)) };
    case "weekend": {
      // Thứ Bảy và Chủ Nhật gần nhất; đang trong cuối tuần thì lấy từ hôm nay.
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
      const saturday = weekday === 0 ? addDays(today, -1) : addDays(today, (6 - weekday) % 7);
      const start = weekday === 0 || weekday === 6 ? today : saturday;
      return { start_from: vnMidnight(start), start_before: vnMidnight(addDays(saturday, 2)) };
    }
    case "month": {
      const [year, month] = today.split("-").map(Number) as [number, number];
      const next =
        month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
      return { start_from: vnMidnight(today), start_before: vnMidnight(next) };
    }
    case "range":
      return {
        ...(filters.from ? { start_from: vnMidnight(filters.from) } : {}),
        ...(filters.to ? { start_before: vnMidnight(addDays(filters.to, 1)) } : {}),
      };
    default:
      return {};
  }
}

/** Query gửi GET /v1/events. `cursor` thêm khi tải trang sau. */
export function toCatalogQuery(filters: ExploreFilters, now: number): CatalogQuery {
  const band = filters.price ? PRICE_BANDS[filters.price] : null;
  return {
    sort: filters.sort,
    ...(filters.q ? { q: filters.q } : {}),
    ...dateRange(filters, now),
    ...(band && "min" in band ? { min_price_vnd: band.min } : {}),
    ...(band && "max" in band ? { max_price_vnd: band.max } : {}),
    ...(filters.status ? { sale_status: filters.status } : {}),
  };
}
