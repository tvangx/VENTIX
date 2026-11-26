import { describe, expect, it } from "vitest";
import {
  dateRange,
  DEFAULT_FILTERS,
  filtersToSearch,
  parseFilters,
  toCatalogQuery,
  vnDay,
  type ExploreFilters,
} from "./filters";
import { countdownTo, formatDateTime, formatShortDateTime, formatVnd, vnParts } from "./format";
import {
  bannerSrc,
  cardStatusLabel,
  primaryAction,
  saleStateOf,
  tierTones,
  type CatalogCard,
  type CatalogDetail,
  type SalePhase,
  type TicketClass,
} from "./sale";

// Thứ Tư 18/11/2026, 12:00 giờ Việt Nam.
const NOW = Date.parse("2026-11-18T05:00:00Z");

function filters(patch: Partial<ExploreFilters>): ExploreFilters {
  return { ...DEFAULT_FILTERS, ...patch };
}

describe("bộ lọc trên URL", () => {
  it("đọc và ghi lại đúng các giá trị hợp lệ", () => {
    const params = new URLSearchParams(
      "q=%C3%A1nh+sao&date=range&from=2026-12-01&to=2026-12-31&price=300k-1m&status=ON_SALE&sort=price_asc",
    );
    const parsed = parseFilters(params);
    expect(parsed).toEqual({
      q: "ánh sao",
      date: "range",
      from: "2026-12-01",
      to: "2026-12-31",
      price: "300k-1m",
      status: "ON_SALE",
      sort: "price_asc",
    });
    expect(parseFilters(filtersToSearch(parsed))).toEqual(parsed);
  });

  it("bỏ qua giá trị lạ thay vì làm hỏng trang", () => {
    const parsed = parseFilters(
      new URLSearchParams("date=yesterday&price=free&status=SOLD_OUT&sort=popular&from=2026-13-40"),
    );
    expect(parsed).toEqual(DEFAULT_FILTERS);
  });

  it("from/to chỉ có nghĩa khi chọn khoảng ngày; to trước from thì kéo về from", () => {
    expect(parseFilters(new URLSearchParams("date=today&from=2026-12-01")).from).toBeNull();
    const parsed = parseFilters(new URLSearchParams("date=range&from=2026-12-10&to=2026-12-01"));
    expect([parsed.from, parsed.to]).toEqual(["2026-12-10", "2026-12-10"]);
  });

  it("cắt từ khóa theo giới hạn 100 ký tự của event-service", () => {
    expect(parseFilters(new URLSearchParams(`q=${"a".repeat(150)}`)).q).toHaveLength(100);
  });

  it("URL mặc định không có tham số thừa", () => {
    expect(filtersToSearch(DEFAULT_FILTERS).toString()).toBe("");
  });
});

describe("khoảng ngày theo giờ Việt Nam", () => {
  it("ngày hiện tại tính theo UTC+7, kể cả khi UTC còn là hôm trước", () => {
    expect(vnDay(Date.parse("2026-11-18T18:30:00Z"))).toBe("2026-11-19");
  });

  it("hôm nay, cuối tuần, tháng này", () => {
    expect(dateRange(filters({ date: "today" }), NOW)).toEqual({
      start_from: "2026-11-18T00:00:00+07:00",
      start_before: "2026-11-19T00:00:00+07:00",
    });
    expect(dateRange(filters({ date: "weekend" }), NOW)).toEqual({
      start_from: "2026-11-21T00:00:00+07:00",
      start_before: "2026-11-23T00:00:00+07:00",
    });
    expect(dateRange(filters({ date: "month" }), NOW)).toEqual({
      start_from: "2026-11-18T00:00:00+07:00",
      start_before: "2026-12-01T00:00:00+07:00",
    });
  });

  it("cuối tuần khi đang là Chủ Nhật chỉ còn hôm nay; tháng 12 sang năm sau", () => {
    const sunday = Date.parse("2026-11-22T03:00:00Z");
    expect(dateRange(filters({ date: "weekend" }), sunday)).toEqual({
      start_from: "2026-11-22T00:00:00+07:00",
      start_before: "2026-11-23T00:00:00+07:00",
    });
    const december = Date.parse("2026-12-10T03:00:00Z");
    expect(dateRange(filters({ date: "month" }), december).start_before).toBe(
      "2027-01-01T00:00:00+07:00",
    );
  });

  it("khoảng tự chọn gồm cả ngày cuối", () => {
    expect(
      dateRange(filters({ date: "range", from: "2026-12-01", to: "2026-12-31" }), NOW),
    ).toEqual({
      start_from: "2026-12-01T00:00:00+07:00",
      start_before: "2027-01-01T00:00:00+07:00",
    });
    expect(dateRange(filters({ date: "range", to: "2026-12-31" }), NOW)).toEqual({
      start_before: "2027-01-01T00:00:00+07:00",
    });
  });
});

describe("query gửi GET /v1/events", () => {
  it("chỉ gửi tham số đang dùng", () => {
    expect(toCatalogQuery(DEFAULT_FILTERS, NOW)).toEqual({ sort: "start_at" });
  });

  it("đổi mức giá và tình trạng sang tham số của API", () => {
    expect(
      toCatalogQuery(filters({ q: "jazz", price: "300k-1m", status: "UPCOMING" }), NOW),
    ).toEqual({
      sort: "start_at",
      q: "jazz",
      min_price_vnd: 300_000,
      max_price_vnd: 1_000_000,
      sale_status: "UPCOMING",
    });
    expect(toCatalogQuery(filters({ price: "under-300k" }), NOW)).toEqual({
      sort: "start_at",
      max_price_vnd: 299_999,
    });
    expect(toCatalogQuery(filters({ price: "over-2m" }), NOW)).toEqual({
      sort: "start_at",
      min_price_vnd: 2_000_001,
    });
  });
});

describe("định dạng", () => {
  it("tiền VND và giờ Việt Nam", () => {
    expect(formatVnd(1_500_000)).toBe("1.500.000đ");
    expect(formatVnd(0)).toBe("0đ");
    expect(formatDateTime("2026-12-19T12:00:00Z")).toBe("T7 19.12.2026 · 19:00");
    expect(formatShortDateTime("2026-11-16T03:00:00Z")).toBe("16.11 10:00");
    // 23:30 UTC là 6:30 sáng hôm sau ở Việt Nam.
    expect(vnParts("2026-12-31T23:30:00Z")).toMatchObject({
      year: 2027,
      month: 1,
      day: 1,
      hour: 6,
    });
  });

  it("đếm ngược", () => {
    expect(countdownTo("2026-11-20T06:02:03Z", NOW)).toEqual({
      days: 2,
      hours: 1,
      minutes: 2,
      seconds: 3,
    });
    expect(countdownTo("2026-11-18T05:00:00Z", NOW)).toBeNull();
  });
});

const META = {
  version: 1,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  event_id: "30000000-0000-4000-8000-000000000001",
};

function phase(id: string, starts: string, ends: string, queue = false): SalePhase {
  return {
    ...META,
    id,
    starts_at: starts,
    ends_at: ends,
    queue_enabled: queue,
    admit_rate: 100,
    per_user_limit: 4,
    require_kyc: false,
  };
}

function ticketClass(id: string, price: number, kind: "SEATED" | "GA" = "SEATED"): TicketClass {
  return { ...META, id, name: id, price_vnd: price, capacity: 100, kind };
}

function detail(patch: Partial<CatalogDetail>): CatalogDetail {
  return {
    id: META.event_id,
    version: 1,
    created_at: META.created_at,
    updated_at: META.updated_at,
    organizer_id: "10000000-0000-4000-8000-000000000001",
    status: "PUBLISHED",
    venue_id: "20000000-0000-4000-8000-000000000001",
    title: "Đêm thử",
    description: "Mô tả",
    banner_key: null,
    banner_url: null,
    thumbnail_url: null,
    start_at: "2026-12-19T12:00:00Z",
    end_at: "2026-12-19T15:00:00Z",
    venue: {
      id: "20000000-0000-4000-8000-000000000001",
      version: 1,
      created_at: META.created_at,
      updated_at: META.updated_at,
      organizer_id: "10000000-0000-4000-8000-000000000001",
      name: "Nhà hát",
      address: "Hà Nội",
      capacity: 500,
    },
    ticket_classes: [ticketClass("a", 500_000)],
    sale_phases: [],
    seat_map: null,
    ...patch,
  };
}

describe("tình trạng bán ở trang chi tiết", () => {
  const p1 = phase("p1", "2026-11-14T03:00:00Z", "2026-11-15T03:00:00Z", true);
  const p2 = phase("p2", "2026-11-16T03:00:00Z", "2026-12-19T10:00:00Z", true);
  const p3 = phase("p3", "2026-12-20T03:00:00Z", "2026-12-21T03:00:00Z");

  it("đợt đang mở được ưu tiên, số thứ tự theo thời gian (không theo thứ tự API trả)", () => {
    expect(saleStateOf([p3, p2, p1], NOW)).toEqual({
      status: "ON_SALE",
      phase: p2,
      phaseNumber: 2,
    });
  });

  it("chưa tới đợt nào → sắp mở bán; qua hết → đã đóng", () => {
    expect(saleStateOf([p3], NOW)).toMatchObject({ status: "UPCOMING", phase: p3, phaseNumber: 1 });
    expect(saleStateOf([p1], NOW)).toEqual({ status: "CLOSED", phase: null, phaseNumber: null });
    expect(saleStateOf([], NOW).status).toBe("CLOSED");
  });

  it("nút chính theo tình trạng, loại vé và seat map", () => {
    const queue = detail({ sale_phases: [p2] });
    expect(primaryAction(queue, saleStateOf([p2], NOW), NOW)).toEqual({
      label: "Vào phòng chờ",
      enabled: true,
      to: "buy",
    });
    const open = phase("p4", "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
    const seatMap = {
      ...META,
      id: "33000000-0000-4000-8000-000000000001",
      layout: { zones: [] },
      published_at: META.created_at,
    };
    const seated = detail({ sale_phases: [open], seat_map: seatMap });
    expect(primaryAction(seated, saleStateOf([open], NOW), NOW)).toEqual({
      label: "Chọn ghế",
      enabled: true,
      to: "seats",
    });
    // Có ghế ngồi nhưng chưa publish seat map: chưa có trang chọn ghế.
    const noMap = detail({ sale_phases: [open] });
    expect(primaryAction(noMap, saleStateOf([open], NOW), NOW)).toEqual({
      label: "Mua vé",
      enabled: true,
      to: "buy",
    });
    const ga = detail({ sale_phases: [open], ticket_classes: [ticketClass("g", 1, "GA")] });
    expect(primaryAction(ga, saleStateOf([open], NOW), NOW).to).toBe("buy");
    expect(primaryAction(detail({}), saleStateOf([p3], NOW), NOW)).toEqual({
      label: "Mở bán 20.12",
      enabled: false,
      to: null,
    });
    expect(primaryAction(detail({}), saleStateOf([p1], NOW), NOW)).toEqual({
      label: "Đã đóng bán",
      enabled: false,
      to: null,
    });
    const past = detail({ end_at: "2026-11-01T00:00:00Z" });
    expect(primaryAction(past, saleStateOf([p2], NOW), NOW).label).toBe("Đã diễn ra");
  });

  it("màu hạng vé theo giá giảm dần, từ hạng thứ 5 dùng xám", () => {
    const tones = tierTones(
      ["e", "a", "c", "b", "d"].map((id, i) => ticketClass(id, (5 - i) * 100)),
    );
    expect([...tones.entries()]).toEqual([
      ["e", 1],
      ["a", 2],
      ["c", 3],
      ["b", 4],
      ["d", 4],
    ]);
  });
});

describe("thẻ sự kiện", () => {
  const card = {
    sale_status: "UPCOMING",
    sale_queue_enabled: false,
    next_sale_starts_at: "2026-12-01T03:00:00Z",
  } as CatalogCard;

  it("nhãn tình trạng", () => {
    expect(cardStatusLabel(card)).toBe("Mở bán 01.12");
    expect(cardStatusLabel({ ...card, sale_status: "ON_SALE", sale_queue_enabled: true })).toBe(
      "Đang mở bán · có hàng chờ",
    );
    expect(cardStatusLabel({ ...card, sale_status: "CLOSED", next_sale_starts_at: null })).toBe(
      "Đã đóng bán",
    );
  });

  it("chỉ ảnh seed có đường dẫn; khóa khác hoặc lạ thì không có ảnh", () => {
    expect(bannerSrc("seed/banners/song-am-live-2026.jpg")).toBe(
      "/seed/banners/song-am-live-2026.jpg",
    );
    expect(bannerSrc("organizers/1/banner.png")).toBeNull();
    expect(bannerSrc("seed/banners/../../secret.jpg")).toBeNull();
    expect(bannerSrc(null)).toBeNull();
  });
});
