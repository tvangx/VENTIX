import { describe, expect, it } from "vitest";
import { formatCompactVnd } from "@/lib/catalog/format";
import { parseLayout } from "@/lib/seatmap/layout";
import type { EventBundle, TicketClass } from "./api";
import { BANNER_MAX_BYTES, checkBannerFile } from "./banner-upload";
import {
  EventInfoSchema,
  parseIntegerInput,
  salePhaseSchema,
  TicketClassSchema,
  utcToVnLocal,
  vnLocalToUtc,
} from "./forms";
import { canSubmit, readiness, seatMapMatches } from "./readiness";
import {
  buildLayout,
  checkPlans,
  letterLabel,
  LIMITS,
  seatsOf,
  suggestPlan,
  type BlockPlan,
} from "./seat-map-builder";

const VIP = "31000000-0000-4000-8000-000000000011";
const STD = "31000000-0000-4000-8000-000000000012";
const GA = "31000000-0000-4000-8000-000000000013";
const T = "2026-11-20T00:00:00.000Z";

function ticketClass(id: string, kind: "SEATED" | "GA", capacity: number, price = 100000) {
  return {
    id,
    kind,
    capacity,
    price_vnd: price,
    name: id.slice(-2),
    event_id: "e",
    version: 0,
    created_at: T,
    updated_at: T,
  } satisfies TicketClass;
}

function bundle(over: Partial<EventBundle> = {}): EventBundle {
  return {
    event: {
      id: "e",
      organizer_id: "o",
      status: "DRAFT",
      venue_id: "v",
      title: "Đêm nhạc",
      description: "",
      banner_key: null,
      start_at: "2027-03-13T13:00:00.000Z",
      end_at: "2027-03-13T16:00:00.000Z",
      version: 0,
      created_at: T,
      updated_at: T,
    },
    ticketClasses: [],
    salePhases: [],
    seatMap: null,
    ...over,
  };
}

describe("giờ Việt Nam ↔ UTC", () => {
  it("20:00 giờ Việt Nam là 13:00 UTC, đổi ngược lại được", () => {
    expect(vnLocalToUtc("2027-03-13T20:00")).toBe("2027-03-13T13:00:00.000Z");
    expect(vnLocalToUtc("2027-03-14T05:30")).toBe("2027-03-13T22:30:00.000Z");
    expect(utcToVnLocal("2027-03-13T22:30:00.000Z")).toBe("2027-03-14T05:30");
  });

  it("sai dạng hoặc ngày không tồn tại → null", () => {
    expect(vnLocalToUtc("")).toBeNull();
    expect(vnLocalToUtc("2027-02-31T10:00")).toBeNull();
    expect(vnLocalToUtc("13/03/2027 20:00")).toBeNull();
  });
});

describe("form", () => {
  it("doanh thu tối đa ghi gọn như wireframe", () => {
    expect(formatCompactVnd(4_500_000_000)).toBe("4,5 tỷ");
    expect(formatCompactVnd(800_000_000)).toBe("800 triệu");
    expect(formatCompactVnd(12_345_000)).toBe("12,3 triệu");
    expect(formatCompactVnd(500_000)).toBe("500.000đ");
  });

  it("số nhập có dấu chấm ngăn nghìn", () => {
    expect(parseIntegerInput("1.500.000")).toBe(1500000);
    expect(parseIntegerInput("5 000")).toBe(5000);
    expect(parseIntegerInput("1,5")).toBeNull();
    expect(parseIntegerInput("-3")).toBeNull();
  });

  it("thông tin sự kiện: giờ kết thúc phải sau giờ bắt đầu", () => {
    const base = {
      venue_id: "20000000-0000-4000-8000-000000000001",
      title: "Đêm nhạc",
      description: "",
      start_local: "2027-03-13T20:00",
    };
    expect(EventInfoSchema.safeParse({ ...base, end_local: "2027-03-13T23:00" }).success).toBe(
      true,
    );
    const bad = EventInfoSchema.safeParse({ ...base, end_local: "2027-03-13T19:00" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(["end_local"]);
    expect(
      EventInfoSchema.safeParse({ ...base, title: "  ", end_local: "2027-03-13T23:00" }).success,
    ).toBe(false);
  });

  it("hạng vé: giá 0 được (vé miễn phí), số lượng phải ≥ 1", () => {
    const ok = TicketClassSchema.safeParse({
      name: "Free",
      kind: "GA",
      price_vnd: "0",
      capacity: "100",
    });
    expect(ok.success && ok.data).toEqual({
      name: "Free",
      kind: "GA",
      price_vnd: 0,
      capacity: 100,
    });
    expect(
      TicketClassSchema.safeParse({ name: "X", kind: "GA", price_vnd: "1000", capacity: "0" })
        .success,
    ).toBe(false);
  });

  it("đợt bán phải kết thúc trước giờ diễn", () => {
    const schema = salePhaseSchema("2027-03-13T13:00:00.000Z"); // 20:00 giờ VN
    const phase = {
      starts_local: "2027-03-01T10:00",
      per_user_limit: "4",
      queue_enabled: true,
      admit_rate: "200",
      require_kyc: false,
    };
    expect(schema.safeParse({ ...phase, ends_local: "2027-03-13T19:00" }).success).toBe(true);
    const late = schema.safeParse({ ...phase, ends_local: "2027-03-13T21:00" });
    expect(late.error?.issues[0]?.message).toBe("Đợt bán phải kết thúc trước giờ diễn");
    const reversed = schema.safeParse({ ...phase, ends_local: "2027-02-28T10:00" });
    expect(reversed.error?.issues[0]?.message).toBe("Giờ đóng bán phải sau giờ mở bán");
  });
});

describe("sinh seat map (Block → Khu)", () => {
  it("nhãn chữ: A…Z rồi AA", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(letterLabel)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
    ]);
  });

  it("mỗi hạng là một Block, chia Khu A1, A2…; layout hợp lệ với ràng buộc event-service", () => {
    const plans: BlockPlan[] = [
      { ticketClassId: VIP, khuCount: 2, rowsPerKhu: 3, seatsPerRow: 10 },
      { ticketClassId: STD, khuCount: 1, rowsPerKhu: 2, seatsPerRow: 5 },
    ];
    const layout = buildLayout(plans);
    expect(layout.zones.map((z) => z.name)).toEqual(["Block A", "Block B"]);
    expect(layout.zones[0]?.blocks.map((b) => b.name)).toEqual(["A1", "A2"]);
    expect(layout.zones[0]?.blocks[0]?.rows.map((r) => r.label)).toEqual(["A", "B", "C"]);
    expect(layout.zones[1]?.blocks[0]?.rows.every((r) => r.ticket_class_id === STD)).toBe(true);
    expect(parseLayout(layout)).not.toBeNull();
  });

  it("tổng ghế phải bằng số lượng của hạng; ngoài giới hạn API thì báo", () => {
    const classes = [{ id: VIP, name: "VIP", capacity: 60 }];
    expect(
      checkPlans([{ ticketClassId: VIP, khuCount: 2, rowsPerKhu: 3, seatsPerRow: 10 }], classes),
    ).toEqual([]);
    expect(
      checkPlans([{ ticketClassId: VIP, khuCount: 1, rowsPerKhu: 3, seatsPerRow: 10 }], classes),
    ).toEqual([{ kind: "capacity", ticketClassId: VIP, seats: 30, capacity: 60 }]);
    expect(
      checkPlans(
        [{ ticketClassId: VIP, khuCount: 1, rowsPerKhu: 1, seatsPerRow: LIMITS.seatsPerRow + 1 }],
        classes,
      ),
    ).toEqual([{ kind: "range", ticketClassId: VIP, field: "seatsPerRow" }]);
    expect(checkPlans([], [])).toEqual([{ kind: "blocks" }]);
    const big = [{ id: VIP, name: "VIP", capacity: 100_100 }];
    expect(
      checkPlans([{ ticketClassId: VIP, khuCount: 100, rowsPerKhu: 77, seatsPerRow: 13 }], big),
    ).toContainEqual({ kind: "total", seats: 100_100 });
  });

  it("gợi ý đúng tổng ghế, khu ≤ 400 ghế, hàng ≤ 20 ghế khi chia được", () => {
    const plan = suggestPlan(VIP, 1000);
    expect(plan.seatsPerRow).toBe(20);
    expect(plan.rowsPerKhu * plan.seatsPerRow).toBeLessThanOrEqual(400);
    expect(seatsOf(plan)).toBe(1000);
    expect(seatsOf(suggestPlan(VIP, 7))).toBe(7);
    // 10.000 ghế như Sóng Âm: chia đúng, trong giới hạn API.
    const songAm = suggestPlan(VIP, 10_000);
    expect(seatsOf(songAm)).toBe(10_000);
    expect(checkPlans([songAm], [{ id: VIP, name: "VIP", capacity: 10_000 }])).toEqual([]);
  });
});

describe("điều kiện gửi duyệt", () => {
  const seatMap = (plans: BlockPlan[]) => ({
    id: "m",
    event_id: "e",
    version: 1,
    layout: buildLayout(plans),
    published_at: null,
    created_at: T,
    updated_at: T,
  });

  const gaOnlyMap = (areas: { name: string; ticket_class_id: string }[]) => ({
    id: "m",
    event_id: "e",
    version: 1,
    layout: { zones: [], ga_areas: areas },
    published_at: null,
    created_at: T,
    updated_at: T,
  });

  it("chỉ vé đứng: mỗi hạng GA cần đúng một khu đứng (issue #98)", () => {
    const classes = [ticketClass(GA, "GA", 500)];
    expect(seatMapMatches(bundle({ ticketClasses: classes }))).toBe(false);
    const map = gaOnlyMap([{ name: "Khu đứng A – sát sân khấu", ticket_class_id: GA }]);
    const b = bundle({ ticketClasses: classes, seatMap: map });
    expect(seatMapMatches(b)).toBe(true);
    expect(canSubmit(readiness(b))).toBe(false); // chưa có đợt bán
    // Thêm hạng GA thứ hai sau khi lưu → thiếu khu đứng, không còn khớp.
    const more = [...classes, ticketClass(STD, "GA", 100)];
    expect(seatMapMatches(bundle({ ticketClasses: more, seatMap: map }))).toBe(false);
    // Khu đứng trỏ tới hạng không phải GA của sự kiện → không khớp.
    const wrong = gaOnlyMap([{ name: "Khu", ticket_class_id: VIP }]);
    expect(seatMapMatches(bundle({ ticketClasses: classes, seatMap: wrong }))).toBe(false);
  });

  it("có cả ghế và vé đứng: cần đủ ghế và khu đứng", () => {
    const classes = [ticketClass(VIP, "SEATED", 60), ticketClass(GA, "GA", 500)];
    const seatsOnly = seatMap([
      { ticketClassId: VIP, khuCount: 2, rowsPerKhu: 3, seatsPerRow: 10 },
    ]);
    expect(seatMapMatches(bundle({ ticketClasses: classes, seatMap: seatsOnly }))).toBe(false);
    const both = {
      ...seatsOnly,
      layout: { ...seatsOnly.layout, ga_areas: [{ name: "Fanzone", ticket_class_id: GA }] },
    };
    expect(seatMapMatches(bundle({ ticketClasses: classes, seatMap: both }))).toBe(true);
  });

  it("hạng SEATED: seat map phải đủ hạng và đúng số ghế", () => {
    const classes = [ticketClass(VIP, "SEATED", 60), ticketClass(STD, "SEATED", 10)];
    expect(seatMapMatches(bundle({ ticketClasses: classes }))).toBe(false);
    const full = seatMap([
      { ticketClassId: VIP, khuCount: 2, rowsPerKhu: 3, seatsPerRow: 10 },
      { ticketClassId: STD, khuCount: 1, rowsPerKhu: 2, seatsPerRow: 5 },
    ]);
    expect(seatMapMatches(bundle({ ticketClasses: classes, seatMap: full }))).toBe(true);
    const missing = seatMap([{ ticketClassId: VIP, khuCount: 2, rowsPerKhu: 3, seatsPerRow: 10 }]);
    expect(seatMapMatches(bundle({ ticketClasses: classes, seatMap: missing }))).toBe(false);
    // Đổi số lượng hạng sau khi lưu sơ đồ → không còn khớp.
    const changed = [ticketClass(VIP, "SEATED", 61), ticketClass(STD, "SEATED", 10)];
    expect(seatMapMatches(bundle({ ticketClasses: changed, seatMap: full }))).toBe(false);
  });

  it("banner không bắt buộc", () => {
    const b = bundle({
      ticketClasses: [ticketClass(GA, "GA", 500)],
      seatMap: gaOnlyMap([{ name: "Khu đứng A", ticket_class_id: GA }]),
      salePhases: [
        {
          id: "p",
          event_id: "e",
          starts_at: "2027-03-01T03:00:00.000Z",
          ends_at: "2027-03-13T12:00:00.000Z",
          queue_enabled: false,
          admit_rate: 200,
          per_user_limit: 4,
          require_kyc: false,
          version: 0,
          created_at: T,
          updated_at: T,
        },
      ],
    });
    const r = readiness(b);
    expect(r.banner).toBe(false);
    expect(canSubmit(r)).toBe(true);
  });
});

describe("ảnh banner (kiểm tra ở trình duyệt trước khi tải lên)", () => {
  const file = (type: string, size: number) => new File([new Uint8Array(size)], "banner", { type });

  it("chỉ JPEG/PNG/WebP, không rỗng, tối đa 5 MB", () => {
    expect(checkBannerFile(file("image/jpeg", 1000))).toBeNull();
    expect(checkBannerFile(file("image/webp", BANNER_MAX_BYTES))).toBeNull();
    expect(checkBannerFile(file("image/gif", 1000))).toBe("type");
    expect(checkBannerFile(file("image/png", 0))).toBe("empty");
    expect(checkBannerFile(file("image/png", BANNER_MAX_BYTES + 1))).toBe("size");
  });
});
