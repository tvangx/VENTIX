import { describe, expect, it } from "vitest";
import { seedEvents } from "@/mocks/seed";
import { mockSeatMapLayout } from "@/mocks/seat-map";
import { buildGeometry, SEAT_RADIUS, SEAT_SPACING, seatKey } from "./geometry";
import { SeatIndex } from "./hit-test";
import { parseLayout, type SeatMapLayout } from "./layout";
import { toggleSeat, type SeatStatus } from "./selection";

const CLASS_A = "31000000-0000-4000-8000-000000000011";
const CLASS_B = "31000000-0000-4000-8000-000000000012";

const SMALL: SeatMapLayout = {
  zones: [
    {
      name: "Block A",
      blocks: [
        { name: "A1", rows: [{ label: "A", seats: 3, ticket_class_id: CLASS_A }] },
        {
          name: "A2",
          rows: [
            { label: "A", seats: 2, ticket_class_id: CLASS_A },
            { label: "B", seats: 4, ticket_class_id: CLASS_B },
          ],
        },
      ],
    },
    {
      name: "Block B",
      blocks: [{ name: "B1", rows: [{ label: "A", seats: 5, ticket_class_id: CLASS_B }] }],
    },
  ],
};

function bigLayout(): SeatMapLayout {
  const event = seedEvents.find((item) => item.slug === "song-am-live-2026");
  const layout = event ? mockSeatMapLayout(event) : null;
  if (!layout) throw new Error("seed thiếu Sóng Âm");
  return layout;
}

describe("parse layout", () => {
  it("nhận layout đúng định dạng event-service, từ chối dạng sai", () => {
    expect(parseLayout(SMALL)).toEqual(SMALL);
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout({ zones: [] })).toBeNull();
    expect(
      parseLayout({
        zones: [
          {
            name: "X",
            blocks: [{ name: "Y", rows: [{ label: "A", seats: 0, ticket_class_id: CLASS_A }] }],
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("dàn sơ đồ", () => {
  it("đủ số ghế, khóa duy nhất, đúng hàng/số ghế/hạng vé", () => {
    const geo = buildGeometry(SMALL);
    expect(geo.seats).toHaveLength(14);
    expect(new Set(geo.seats.map((s) => s.key)).size).toBe(14);
    const seat = geo.seats.find((s) => s.key === seatKey(0, 1, 1, 4));
    expect(seat).toMatchObject({
      rowLabel: "B",
      seatNo: 4,
      ticketClassId: CLASS_B,
      zone: 0,
      block: 1,
    });
    expect(geo.blocks.map((b) => [b.name, b.end - b.start])).toEqual([
      ["A1", 3],
      ["A2", 6],
      ["B1", 5],
    ]);
    expect(geo.zones.map((z) => [z.name, z.seatCount])).toEqual([
      ["Block A", 9],
      ["Block B", 5],
    ]);
  });

  it("ghế nằm phía trên sân khấu, block sau xa sân khấu hơn block trước", () => {
    const geo = buildGeometry(SMALL);
    expect(geo.seats.every((s) => s.y < 0)).toBe(true);
    const dist = (zone: number) =>
      Math.min(...geo.seats.filter((s) => s.zone === zone).map((s) => Math.hypot(s.x, s.y)));
    const far = (zone: number) =>
      Math.max(...geo.seats.filter((s) => s.zone === zone).map((s) => Math.hypot(s.x, s.y)));
    expect(dist(1)).toBeGreaterThan(far(0));
    expect(dist(0)).toBeGreaterThan(geo.stageRadius);
  });

  it("10.000 ghế: không ghế nào chồng lên nhau và dựng nhanh", () => {
    const layout = bigLayout();
    const started = performance.now();
    const geo = buildGeometry(layout);
    const elapsed = performance.now() - started;
    expect(geo.seats).toHaveLength(10_000);
    // Ngưỡng rộng để không chập chờn trên CI; thực tế vài chục ms.
    expect(elapsed).toBeLessThan(500);
    const index = new SeatIndex(geo.seats);
    // Mỗi ghế: ghế gần nhất trong 2 lần bán kính phải là chính nó → không ghế nào đè lên ghế khác.
    for (const seat of geo.seats) {
      expect(index.nearest(seat.x, seat.y, SEAT_RADIUS * 2)?.key).toBe(seat.key);
    }
    // Hai ghế liền kề cách nhau SEAT_SPACING theo cung; đo theo dây cung nên ngắn hơn rất ít.
    const [a, b] = geo.seats;
    expect(a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0).toBeCloseTo(SEAT_SPACING, 1);
  });
});

describe("tra ghế theo điểm bấm", () => {
  const geo = buildGeometry(SMALL);
  const index = new SeatIndex(geo.seats);
  const seat = geo.seats[4];

  it("trúng tâm, lệch trong bán kính, trượt ra ngoài", () => {
    if (!seat) throw new Error("thiếu ghế");
    expect(index.nearest(seat.x, seat.y, SEAT_RADIUS)?.key).toBe(seat.key);
    expect(index.nearest(seat.x + 3, seat.y - 2, SEAT_RADIUS)?.key).toBe(seat.key);
    expect(index.nearest(0, 0, SEAT_RADIUS)).toBeNull();
    expect(index.nearest(seat.x + 50, seat.y, SEAT_RADIUS)).toBeNull();
  });

  it("vùng chạm rộng hơn khoảng cách ghế vẫn chọn ghế gần nhất", () => {
    if (!seat) throw new Error("thiếu ghế");
    expect(index.nearest(seat.x + 1, seat.y, SEAT_SPACING * 3)?.key).toBe(seat.key);
  });
});

describe("chọn ghế", () => {
  const none = new Map<string, SeatStatus>();

  it("thêm, bỏ chọn, giữ thứ tự chọn", () => {
    let selected: string[] = [];
    for (const key of ["a", "b"]) {
      const result = toggleSeat(selected, key, 4, none);
      if (!result.ok) throw new Error(result.reason);
      selected = result.selected;
    }
    expect(selected).toEqual(["a", "b"]);
    expect(toggleSeat(selected, "a", 4, none)).toEqual({ ok: true, selected: ["b"] });
  });

  it("không vượt giới hạn, không chọn ghế đã bán/đang giữ, không chọn khi chưa mở bán", () => {
    expect(toggleSeat(["a", "b"], "c", 2, none)).toEqual({ ok: false, reason: "LIMIT_REACHED" });
    const statuses = new Map<string, SeatStatus>([
      ["s", "sold"],
      ["h", "held"],
    ]);
    expect(toggleSeat([], "s", 4, statuses)).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(toggleSeat([], "h", 4, statuses)).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(toggleSeat([], "a", 0, none)).toEqual({ ok: false, reason: "SELECTION_CLOSED" });
  });

  it("đã chọn rồi thì vẫn bỏ chọn được kể cả khi tới giới hạn", () => {
    expect(toggleSeat(["a", "b"], "b", 2, none)).toEqual({ ok: true, selected: ["a"] });
  });
});
