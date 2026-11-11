import { PrismaService } from "../../src/db/prisma.service";
import { seedEvents } from "../../src/tools/seed-events";
import { testDatabase } from "../helpers/database";

describe("S-205 Event seed", () => {
  it("publishes three fixtures atomically and preserves data on repeated and concurrent runs", async () => {
    const database = await testDatabase();
    const prisma = new PrismaService({ DATABASE_URL: database.url });
    try {
      const conflictingVenue = await prisma.venue.create({
        data: {
          id: "a2050000-0000-4000-8000-000000000203",
          organizerId: "a2050000-0000-4000-8000-000000000099",
          name: "Existing venue",
          address: "Existing address",
          capacity: 100,
        },
      });
      await expect(seedEvents(prisma)).rejects.toThrow();
      expect(await prisma.event.count()).toBe(0);
      expect(await prisma.venue.count()).toBe(1);
      expect(await prisma.outboxEvent.count()).toBe(0);
      await prisma.venue.delete({ where: { id: conflictingVenue.id } });

      const counts = await Promise.all([seedEvents(prisma), seedEvents(prisma)]);
      expect(counts.sort()).toEqual([0, 3]);
      const events = await prisma.event.findMany({
        orderBy: { id: "asc" },
        include: { ticketClasses: true, salePhases: true, seatMaps: true },
      });
      expect(events).toHaveLength(3);
      expect(events.every((event) => event.status === "PUBLISHED")).toBe(true);
      expect(events.every((event) => event.salePhases.length === 1)).toBe(true);
      expect(events.map((event) => event.ticketClasses.length)).toEqual([2, 1, 1]);
      expect(events[0].seatMaps[0]).toMatchObject({ version: 1, publishedAt: expect.any(Date) });
      const byClass = await prisma.seat.groupBy({ by: ["ticketClassId"], _count: { _all: true } });
      expect(byClass.map((entry) => entry._count._all)).toEqual([5000, 5000]);
      expect(await prisma.eventApproval.count()).toBe(3);
      expect(await prisma.outboxEvent.count()).toBe(3);

      await expect(seedEvents(prisma)).resolves.toBe(0);
      expect(await prisma.seat.count()).toBe(10000);
      expect(await prisma.outboxEvent.count()).toBe(3);
      const finalEvents = await prisma.event.findMany({ orderBy: { id: "asc" } });
      expect(finalEvents.map(({ version, updatedAt }) => [version, updatedAt])).toEqual(
        events.map(({ version, updatedAt }) => [version, updatedAt]),
      );
    } finally {
      await prisma.$disconnect();
      await database.close();
    }
  });
});
