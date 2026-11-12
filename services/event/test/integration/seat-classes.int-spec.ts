import { randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../../src/db/prisma.service";
import { seedEvents } from "../../src/tools/seed-events";
import { organizerApp } from "../helpers/organizer-app";

type SeatMapping = { seat_id: string; ticket_class_id: string };
type SeatPage = {
  event_id: string;
  seat_map_version: number;
  seats: SeatMapping[];
  next_cursor: string | null;
};

describe("S-206 internal seat classes", () => {
  let app: Awaited<ReturnType<typeof organizerApp>>;
  let prisma: PrismaService;
  const internalApiKey = randomBytes(32).toString("hex");
  const eventId = "a2050000-0000-4000-8000-000000000101";
  const path = `/v1/internal/events/${eventId}/seat-classes`;

  beforeAll(async () => {
    app = await organizerApp({ internalApiKey });
    prisma = app.nest.get(PrismaService);
    await seedEvents(prisma);

    const ticketClass = await prisma.ticketClass.findFirstOrThrow({ where: { eventId } });
    const draft = await prisma.seatMap.create({
      data: { eventId, version: 2, layout: { zones: [] } },
    });
    const zone = await prisma.zone.create({
      data: { eventId, seatMapId: draft.id, name: "Draft only" },
    });
    const block = await prisma.block.create({
      data: { eventId, zoneId: zone.id, name: "Draft block" },
    });
    await prisma.seat.create({
      data: { eventId, blockId: block.id, ticketClassId: ticketClass.id, rowLabel: "A", seatNo: 1 },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("requires the shared key even when a valid JWT is present", async () => {
    await app.http
      .get(path)
      .expect(401)
      .expect("Content-Type", /application\/problem\+json/)
      .expect(({ body }) => expect(body.code).toBe("INTERNAL_AUTH_REQUIRED"));
    await app.http
      .get(path)
      .set("X-Internal-Key", randomBytes(32).toString("hex"))
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe("INTERNAL_AUTH_REQUIRED"));
    await app.http
      .get(path)
      .set("Authorization", `Bearer ${await app.token(randomUUID())}`)
      .expect(401);
  });

  it("selects the latest published version, rejects drafts and validates queries", async () => {
    const page = await app.http.get(path).set("X-Internal-Key", internalApiKey).expect(200);
    expect(page.body).toMatchObject({ event_id: eventId, seat_map_version: 1 });
    expect(page.body.seats).toHaveLength(1000);
    expect(page.body.next_cursor).toEqual(page.body.seats[999].seat_id);

    for (const unavailable of [
      `${path}?seat_map_version=2`,
      "/v1/internal/events/a2050000-0000-4000-8000-000000000102/seat-classes",
      `/v1/internal/events/${randomUUID()}/seat-classes`,
    ]) {
      await app.http
        .get(unavailable)
        .set("X-Internal-Key", internalApiKey)
        .expect(404)
        .expect(({ body }) => expect(body.code).toBe("EVENT_NOT_FOUND"));
    }
    for (const invalid of ["limit=5001", "limit=0", "seat_map_version=0", "cursor=invalid"]) {
      await app.http.get(`${path}?${invalid}`).set("X-Internal-Key", internalApiKey).expect(400);
    }
  });

  it("returns every mapping in cursor order, without gaps, duplicates or draft seats", async () => {
    const map = await prisma.seatMap.findUniqueOrThrow({
      where: { eventId_version: { eventId, version: 1 } },
    });
    const expected = (
      await prisma.seat.findMany({
        where: { block: { zone: { seatMapId: map.id } } },
        orderBy: { id: "asc" },
        select: { id: true, ticketClassId: true },
      })
    ).map(({ id, ticketClassId }) => ({ seat_id: id, ticket_class_id: ticketClassId }));
    expect(expected).toHaveLength(10000);
    expect(new Set(expected.map(({ ticket_class_id }) => ticket_class_id)).size).toBe(2);

    const first = await app.http
      .get(path)
      .query({ limit: 5000, seat_map_version: 1 })
      .set("X-Internal-Key", internalApiKey)
      .expect(200);
    const firstPage = first.body as SeatPage;
    expect(firstPage).toMatchObject({ event_id: eventId, seat_map_version: 1 });
    expect(firstPage.seats).toHaveLength(5000);
    expect(firstPage.next_cursor).toBe(firstPage.seats[4999].seat_id);

    const last = await app.http
      .get(path)
      .query({ limit: 5000, seat_map_version: 1, cursor: firstPage.next_cursor })
      .set("X-Internal-Key", internalApiKey)
      .expect(200);
    const lastPage = last.body as SeatPage;
    expect(lastPage).toMatchObject({ event_id: eventId, seat_map_version: 1, next_cursor: null });
    expect(lastPage.seats).toHaveLength(5000);
    expect([...firstPage.seats, ...lastPage.seats]).toEqual(expected);
  });
});
