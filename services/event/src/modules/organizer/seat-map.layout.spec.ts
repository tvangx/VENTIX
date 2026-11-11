import { parseSeatMapLayout } from "./seat-map.layout";

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
});
