import { PublicSeatsRepository } from "./public-seats";
import { PrismaService } from "../../db/prisma.service";
describe("public seat UUID mapping", () => {
  it("refuses missing/unpublished/version-mismatched maps", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const findMany = jest.fn();
    const tx = { seatMap: { findFirst }, seat: { findMany } };
    const repo = new PublicSeatsRepository({
      $transaction: (run: (t: typeof tx) => unknown) => run(tx),
    } as unknown as PrismaService);
    await expect(repo.list("event", { seat_map_version: 4, limit: 1 })).rejects.toMatchObject({
      code: "EVENT_NOT_FOUND",
    });
    expect(findMany).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        eventId: "event",
        version: 4,
        publishedAt: { not: null },
        event: { status: "PUBLISHED" },
      },
    });
  });
  it("maps position and paginates UUIDs within the requested published map", async () => {
    const seat = {
      id: "seat1",
      ticketClassId: "class",
      rowLabel: "A",
      seatNo: 1,
      block: { name: "Block", zone: { name: "Zone" } },
    };
    const findMany = jest.fn().mockResolvedValue([seat, { ...seat, id: "seat2" }]);
    const tx = {
      seatMap: { findFirst: jest.fn().mockResolvedValue({ id: "map", version: 4 }) },
      seat: { findMany },
    };
    const repo = new PublicSeatsRepository({
      $transaction: (run: (t: typeof tx) => unknown) => run(tx),
    } as unknown as PrismaService);
    expect(await repo.list("event", { seat_map_version: 4, limit: 1, cursor: "previous" })).toEqual(
      {
        seat_map_version: 4,
        next_cursor: "seat1",
        items: [
          {
            seat_id: "seat1",
            ticket_class_id: "class",
            row_label: "A",
            seat_no: 1,
            block_name: "Block",
            zone_name: "Zone",
          },
        ],
      },
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "event", id: { gt: "previous" }, block: { zone: { seatMapId: "map" } } },
        take: 2,
      }),
    );
  });
});
