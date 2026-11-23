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
});
