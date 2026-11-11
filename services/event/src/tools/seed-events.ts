import type { Prisma } from "../../generated/client";
import type { PrismaService } from "../db/prisma.service";
import { EventLifecycleRepository } from "../modules/organizer/event-lifecycle.repository";
import { OrganizerRepository } from "../modules/organizer/organizer.repository";
import { parseSeatMapLayout } from "../modules/organizer/seat-map.layout";

const organizerId = "a2050000-0000-4000-8000-000000000001";
const adminId = "a2050000-0000-4000-8000-000000000002";
const day = 86_400_000;
const fixtures = [
  {
    id: "a2050000-0000-4000-8000-000000000101",
    venueId: "a2050000-0000-4000-8000-000000000201",
    title: "Đêm nhạc VENTIX",
    venue: "Sân khấu Sông Hồng",
    capacity: 10000,
    seated: true,
  },
  {
    id: "a2050000-0000-4000-8000-000000000102",
    venueId: "a2050000-0000-4000-8000-000000000202",
    title: "Triển lãm sáng tạo",
    venue: "Nhà triển lãm VENTIX",
    capacity: 400,
    seated: false,
  },
  {
    id: "a2050000-0000-4000-8000-000000000103",
    venueId: "a2050000-0000-4000-8000-000000000203",
    title: "Ngày hội phim ngắn",
    venue: "Trung tâm chiếu phim VENTIX",
    capacity: 240,
    seated: false,
  },
];

type Fixture = (typeof fixtures)[number];

async function createClasses(tx: Prisma.TransactionClient, fixture: Fixture) {
  const eventId = fixture.id;
  const classes = fixture.seated
    ? [
        { name: "Khu A", capacity: 5000, kind: "SEATED", priceVnd: 350000 },
        { name: "Khu B", capacity: 5000, kind: "SEATED", priceVnd: 200000 },
      ]
    : [{ name: "Vé vào cửa", capacity: fixture.capacity, kind: "GA", priceVnd: 100000 }];
  return Promise.all(
    classes.map((ticketClass) => tx.ticketClass.create({ data: { eventId, ...ticketClass } })),
  );
}

export async function seedEvents(db: PrismaService): Promise<number> {
  const organizer = new OrganizerRepository(db);
  const lifecycle = new EventLifecycleRepository(db);
  const now = Date.now();

  return db.$transaction(
    async (tx) => {
      let created = 0;
      for (const [index, fixture] of fixtures.entries()) {
        const startAt = new Date(now + (14 + index * 7) * day);
        await tx.venue.createMany({
          data: {
            id: fixture.venueId,
            organizerId,
            name: fixture.venue,
            address: "Hà Nội (địa điểm mẫu)",
            capacity: fixture.capacity,
          },
          skipDuplicates: true,
        });
        const event = await tx.event.createMany({
          data: {
            id: fixture.id,
            organizerId,
            venueId: fixture.venueId,
            title: fixture.title,
            description: "Sự kiện mẫu để kiểm thử VENTIX.",
            startAt,
            endAt: new Date(startAt.getTime() + 3 * 60 * 60 * 1000),
          },
          skipDuplicates: true,
        });
        if (!event.count) continue;

        const classes = await createClasses(tx, fixture);
        await tx.salePhase.create({
          data: {
            eventId: fixture.id,
            startsAt: new Date(now - day),
            endsAt: startAt,
            queueEnabled: fixture.seated,
            admitRate: 100,
            perUserLimit: 4,
          },
        });
        if (fixture.seated) {
          const { layout } = parseSeatMapLayout({
            zones: classes.map((ticketClass) => ({
              name: ticketClass.name,
              blocks: [
                {
                  name: "Khán đài",
                  rows: Array.from({ length: 50 }, (_, row) => ({
                    label: String(row + 1),
                    seats: 100,
                    ticket_class_id: ticketClass.id,
                  })),
                },
              ],
            })),
          });
          await organizer.createSeatMap(tx, organizerId, fixture.id, layout);
        }
        const pending = await lifecycle.submit(tx, organizerId, fixture.id, 0);
        const approved = await lifecycle.decide(tx, organizerId, fixture.id, adminId, {
          version: pending.version,
          decision: "APPROVED",
        });
        await lifecycle.publish(tx, organizerId, fixture.id, approved.version);
        created++;
      }
      return created;
    },
    { timeout: 30_000 },
  );
}
