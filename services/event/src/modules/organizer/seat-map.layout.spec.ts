import { gaClassIdsOf, parseSeatMapLayout } from "./seat-map.layout";

const ticketClassId = "00000000-0000-4000-8000-000000000001";

describe("seat map layout", () => {
  const layout = {
    zones: [
      {
        name: "A",
        blocks: [{ name: "B", rows: [{ label: "R", seats: 10, ticket_class_id: ticketClassId }] }],
      },
    ],
  };

  it("counts valid seats", () => {
    expect(parseSeatMapLayout(layout).seatCount).toBe(10);
  });

  it("rejects duplicate labels, unknown fields and excessive seats", () => {
    expect(() => parseSeatMapLayout({ zones: [layout.zones[0], layout.zones[0]] })).toThrow();
    expect(() => parseSeatMapLayout({ ...layout, extra: true })).toThrow();
    expect(() =>
      parseSeatMapLayout({
        zones: [
          {
            name: "A",
            blocks: [{ name: "B", rows: [{ ...layout.zones[0].blocks[0].rows[0], seats: 1001 }] }],
          },
        ],
      }),
    ).toThrow();
  });

  describe("ga_areas", () => {
    const otherClassId = "00000000-0000-4000-8000-000000000002";
    const area = { name: "Khu đứng A", ticket_class_id: ticketClassId };

    it("accepts a standing-only event with no zones and counts no seats", () => {
      expect(parseSeatMapLayout({ zones: [], ga_areas: [area] })).toEqual({
        layout: { zones: [], ga_areas: [area] },
        seatCount: 0,
      });
    });

    it("accepts standing areas next to seated zones", () => {
      const parsed = parseSeatMapLayout({
        ...layout,
        ga_areas: [{ name: "Fanzone", ticket_class_id: otherClassId }],
      });
      expect(parsed.seatCount).toBe(10);
      expect(gaClassIdsOf(parsed.layout)).toEqual([otherClassId]);
    });

    it("keeps layouts without ga_areas valid", () => {
      expect(gaClassIdsOf(parseSeatMapLayout(layout).layout)).toEqual([]);
    });

    it("rejects a layout with neither zones nor standing areas", () => {
      expect(() => parseSeatMapLayout({ zones: [] })).toThrow();
      expect(() => parseSeatMapLayout({ zones: [], ga_areas: [] })).toThrow();
    });

    it("rejects duplicate names across zones and standing areas", () => {
      expect(() => parseSeatMapLayout({ ...layout, ga_areas: [{ ...area, name: "A" }] })).toThrow(
        expect.objectContaining({ code: "DUPLICATE_SEAT_MAP_LABEL" }),
      );
      expect(() =>
        parseSeatMapLayout({
          zones: [],
          ga_areas: [area, { name: area.name, ticket_class_id: otherClassId }],
        }),
      ).toThrow(expect.objectContaining({ code: "DUPLICATE_SEAT_MAP_LABEL" }));
    });

    it("rejects one GA class bound to two areas", () => {
      expect(() =>
        parseSeatMapLayout({ zones: [], ga_areas: [area, { ...area, name: "Khu đứng B" }] }),
      ).toThrow(expect.objectContaining({ code: "DUPLICATE_GA_CLASS" }));
    });

    it("rejects malformed areas", () => {
      expect(() => parseSeatMapLayout({ zones: [], ga_areas: [{ name: "X" }] })).toThrow();
      expect(() =>
        parseSeatMapLayout({ zones: [], ga_areas: [{ ...area, ticket_class_id: "nope" }] }),
      ).toThrow();
      expect(() =>
        parseSeatMapLayout({ zones: [], ga_areas: [{ ...area, extra: true }] }),
      ).toThrow();
    });
  });

  describe("placement", () => {
    const canvas = { width: 1000, height: 800 };
    const box = { shape: "rect", x: 100, y: 100, width: 200, height: 100 };
    const points = [
      [0, 0],
      [1000, 0],
      [500, 800],
    ];
    const polygon = { shape: { polygon: points } };
    const gaArea = { name: "Fanzone", ticket_class_id: "00000000-0000-4000-8000-000000000002" };

    function placed(position: object = box, extra: object = { canvas }) {
      const [zone] = layout.zones;
      return { ...extra, zones: [{ ...zone, blocks: [{ ...zone.blocks[0], position }] }] };
    }

    function rejects(value: unknown, code = "INVALID_PLACEMENT") {
      expect(() => parseSeatMapLayout(value)).toThrow(expect.objectContaining({ code }));
    }

    it("keeps stage, rect, ellipse and polygon placements unchanged", () => {
      const value = {
        ...placed({ ...box, rotation: -15 }),
        stage: { ...box, shape: "ellipse" },
        ga_areas: [{ ...gaArea, position: polygon }],
      };
      expect(parseSeatMapLayout(value)).toEqual({ layout: value, seatCount: 10 });
    });

    it("accepts a stage or a canvas without area positions", () => {
      expect(() => parseSeatMapLayout({ ...layout, canvas, stage: box })).not.toThrow();
      expect(() => parseSeatMapLayout({ ...layout, canvas })).not.toThrow();
    });

    it("accepts a box touching the canvas edges", () => {
      const full = { shape: "rect", x: 0, y: 0, ...canvas };
      expect(() => parseSeatMapLayout(placed(full))).not.toThrow();
    });

    it("requires a canvas for any placement", () => {
      rejects(placed(box, {}));
      rejects({ ...layout, stage: box });
    });

    it("rejects placements outside the canvas", () => {
      rejects(placed({ ...box, x: 801 }));
      rejects(placed({ ...box, y: 701 }));
      rejects(placed({ ...box, x: -1 }));
      rejects(placed({ shape: { polygon: [...points, [1001, 0]] } }));
      rejects(placed({ shape: { polygon: [...points, [0, 801]] } }));
      rejects({ ...layout, canvas, stage: { ...box, width: 901 } });
    });

    it("rejects malformed canvas and shapes", () => {
      rejects({ ...layout, canvas: { width: 10001, height: 800 } });
      rejects({ ...layout, canvas: { width: 0, height: 800 } });
      rejects(placed({ ...box, width: 0 }));
      rejects(placed({ ...box, rotation: 361 }));
      rejects(placed({ ...box, shape: "arc" }));
      rejects(placed({ shape: "rect", x: 1, y: 1 }));
      rejects(placed({ shape: { polygon: points.slice(0, 2) } }));
      rejects(placed({ shape: { polygon: Array.from({ length: 51 }, () => [1, 1]) } }));
      rejects(placed({ ...polygon, x: 1 }));
    });

    it("rejects positions on only some areas", () => {
      rejects({ ...placed(), ga_areas: [gaArea] }, "PARTIAL_PLACEMENT");
      rejects({ ...layout, canvas, ga_areas: [{ ...gaArea, position: box }] }, "PARTIAL_PLACEMENT");
    });

    it("reports INVALID_SEAT_MAP when other fields are also invalid", () => {
      rejects({ ...placed({ ...box, width: 0 }), extra: true }, "INVALID_SEAT_MAP");
    });
  });
});
