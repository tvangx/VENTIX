import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { EVENTS, VENUES, eventInput, organizerApp } from "../helpers/organizer-app";

describe("S-202 seat map", () => {
  let app: Awaited<ReturnType<typeof organizerApp>>;
  let token: string;
  let outsider: string;
  let eventId: string;
  let classId: string;
  let venueId: string;

  beforeEach(async () => {
    app = await organizerApp();
    token = await app.token(randomUUID());
    outsider = await app.token(randomUUID());
    const venue = await app.http
      .post(VENUES)
      .auth(token, { type: "bearer" })
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Arena", address: "Local", capacity: 10000 })
      .expect(201);
    const event = await app.http
      .post(EVENTS)
      .auth(token, { type: "bearer" })
      .set("Idempotency-Key", randomUUID())
      .send(eventInput(venue.body.id))
      .expect(201);
    venueId = venue.body.id;
    eventId = event.body.id;
    const ticketClass = await app.http
      .post(`${EVENTS}/${eventId}/ticket-classes`)
      .auth(token, { type: "bearer" })
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Seated", price_vnd: 100000, capacity: 10000, kind: "SEATED" })
      .expect(201);
    classId = ticketClass.body.id;
  });

  afterEach(async () => app?.close());

  function post(layout: object, auth = token, key = randomUUID()) {
    return app.http
      .post(`${EVENTS}/${eventId}/seat-maps`)
      .auth(auth, { type: "bearer" })
      .set("Idempotency-Key", key)
      .send({ layout });
  }

  function layout(seats: number) {
    return {
      zones: [
        {
          name: "A",
          blocks: [
            {
              name: "B",
              rows: Array.from({ length: seats / 1000 }, (_, index) => ({
                label: `R${index + 1}`,
                seats: 1000,
                ticket_class_id: classId,
              })),
            },
          ],
        },
      ],
    };
  }

  it("validates tenant, class and layout before writing", async () => {
    await app.http
      .post(`${EVENTS}/${eventId}/seat-maps`)
      .send({ layout: layout(1000) })
      .expect(401);
    await post(layout(1000), await app.token(randomUUID(), ["USER"])).expect(403);
    await post(layout(1000), outsider).expect(404);
    await post({
      zones: [
        {
          name: "A",
          blocks: [{ name: "B", rows: [{ label: "R", seats: 1, ticket_class_id: randomUUID() }] }],
        },
      ],
    }).expect(400);
    await post({
      zones: [
        {
          name: "A",
          blocks: [
            {
              name: "B",
              rows: [
                { label: "R", seats: 1, ticket_class_id: classId },
                { label: "R", seats: 1, ticket_class_id: classId },
              ],
            },
          ],
        },
      ],
    }).expect(400);
    const count = await app.db.pool.query(
      "SELECT count(*)::int AS count FROM seat_maps WHERE event_id=$1",
      [eventId],
    );
    expect(count.rows[0].count).toBe(0);
  });

  it("creates 10,000 seats atomically and replays the idempotency key", async () => {
    const key = randomUUID();
    const started = performance.now();
    const first = await post(layout(10000), token, key).expect(201);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(5000);
    expect(first.body).toMatchObject({ event_id: eventId, version: 1, published_at: null });
    const replay = await post(layout(10000), token, key).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    await post(layout(1000), token, key).expect(409);
    const counts = await app.db.pool.query(
      "SELECT (SELECT count(*)::int FROM zones WHERE seat_map_id=$1) AS zones, (SELECT count(*)::int FROM blocks WHERE zone_id IN (SELECT id FROM zones WHERE seat_map_id=$1)) AS blocks, (SELECT count(*)::int FROM seats WHERE block_id IN (SELECT b.id FROM blocks b JOIN zones z ON z.id=b.zone_id WHERE z.seat_map_id=$1)) AS seats",
      [first.body.id],
    );
    expect(counts.rows[0]).toEqual({ zones: 1, blocks: 1, seats: 10000 });
    await app.http
      .get(`${EVENTS}/${eventId}/seat-maps/1`)
      .auth(outsider, { type: "bearer" })
      .expect(404);
    await app.http
      .get(`${EVENTS}/${eventId}/seat-maps/1`)
      .auth(token, { type: "bearer" })
      .expect(200);
    await app.http
      .get(`${EVENTS}/${eventId}/seat-maps`)
      .auth(token, { type: "bearer" })
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(1));
  });

  describe("ga_areas", () => {
    async function createClass(kind: "SEATED" | "GA", name: string, event = eventId) {
      const response = await app.http
        .post(`${EVENTS}/${event}/ticket-classes`)
        .auth(token, { type: "bearer" })
        .set("Idempotency-Key", randomUUID())
        .send({ name, price_vnd: 50000, capacity: 500, kind })
        .expect(201);
      return String(response.body.id);
    }

    async function seatMapCount() {
      const result = await app.db.pool.query(
        "SELECT count(*)::int AS count FROM seat_maps WHERE event_id=$1",
        [eventId],
      );
      return result.rows[0].count as number;
    }

    it("stores a standing-only layout without creating seats", async () => {
      const gaId = await createClass("GA", "Đứng A");
      const created = await post({
        zones: [],
        ga_areas: [{ name: "Khu đứng A", ticket_class_id: gaId }],
      }).expect(201);
      expect(created.body.layout).toEqual({
        zones: [],
        ga_areas: [{ name: "Khu đứng A", ticket_class_id: gaId }],
      });
      const counts = await app.db.pool.query(
        "SELECT (SELECT count(*)::int FROM zones WHERE seat_map_id=$1) AS zones, (SELECT count(*)::int FROM seats WHERE event_id=$2) AS seats",
        [created.body.id, eventId],
      );
      expect(counts.rows[0]).toEqual({ zones: 0, seats: 0 });
      await app.http
        .get(`${EVENTS}/${eventId}/seat-maps/1`)
        .auth(token, { type: "bearer" })
        .expect(200)
        .expect(({ body }) => expect(body.layout.ga_areas).toHaveLength(1));
    });

    it("stores standing areas next to seated zones", async () => {
      const gaId = await createClass("GA", "Fanzone");
      const created = await post({
        ...layout(1000),
        ga_areas: [{ name: "Fanzone", ticket_class_id: gaId }],
      }).expect(201);
      const seats = await app.db.pool.query(
        "SELECT count(*)::int AS count FROM seats WHERE event_id=$1",
        [eventId],
      );
      expect(seats.rows[0].count).toBe(1000);
      expect(created.body.layout.ga_areas).toHaveLength(1);
    });

    it("rejects areas bound to SEATED, foreign or unknown classes without writing", async () => {
      const otherEvent = await app.http
        .post(EVENTS)
        .auth(token, { type: "bearer" })
        .set("Idempotency-Key", randomUUID())
        .send(eventInput(venueId))
        .expect(201);
      const foreignGa = await createClass("GA", "Đứng ngoài", String(otherEvent.body.id));
      for (const id of [classId, foreignGa, randomUUID()]) {
        await post({ zones: [], ga_areas: [{ name: "Khu đứng", ticket_class_id: id }] })
          .expect(400)
          .expect(({ body }) => expect(body.code).toBe("INVALID_GA_CLASS"));
      }
      expect(await seatMapCount()).toBe(0);
    });

    it("rejects a GA class used as seated rows and invalid area shapes", async () => {
      const gaId = await createClass("GA", "Đứng B");
      await post({
        zones: [
          {
            name: "A",
            blocks: [{ name: "B", rows: [{ label: "R", seats: 1, ticket_class_id: gaId }] }],
          },
        ],
      })
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe("INVALID_SEAT_CLASS"));
      await post({ zones: [] }).expect(400);
      await post({
        zones: [],
        ga_areas: [
          { name: "Khu", ticket_class_id: gaId },
          { name: "Khu 2", ticket_class_id: gaId },
        ],
      })
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe("DUPLICATE_GA_CLASS"));
      expect(await seatMapCount()).toBe(0);
    });

    it("rejects standing areas from another organizer", async () => {
      const gaId = await createClass("GA", "Đứng C");
      await post(
        { zones: [], ga_areas: [{ name: "Khu đứng", ticket_class_id: gaId }] },
        outsider,
      ).expect(404);
    });
  });

  it("rolls back a failed bulk insert and rejects changes after publish", async () => {
    await app.db.pool.query(
      "CREATE FUNCTION reject_seat_map_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.seat_no = 7 THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$",
    );
    await app.db.pool.query(
      "CREATE TRIGGER reject_seat_map_test BEFORE INSERT ON seats FOR EACH ROW EXECUTE FUNCTION reject_seat_map_test()",
    );
    const failed = await post(layout(1000));
    expect(failed.status).toBeGreaterThanOrEqual(500);
    await app.db.pool.query("DROP TRIGGER reject_seat_map_test ON seats");
    await app.db.pool.query("DROP FUNCTION reject_seat_map_test()");
    const maps = await app.db.pool.query(
      "SELECT count(*)::int AS count FROM seat_maps WHERE event_id=$1",
      [eventId],
    );
    expect(maps.rows[0].count).toBe(0);
    const created = await post(layout(1000)).expect(201);
    const first = await app.db.pool.query("SELECT id FROM seat_maps WHERE id=$1", [
      created.body.id,
    ]);
    await app.db.pool.query("UPDATE seat_maps SET published_at=now() WHERE id=$1", [
      first.rows[0].id,
    ]);
    await expect(
      app.db.pool.query("UPDATE seat_maps SET layout='{}'::jsonb WHERE id=$1", [first.rows[0].id]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      app.db.pool.query("DELETE FROM seats WHERE event_id=$1", [eventId]),
    ).rejects.toMatchObject({ code: "23514" });
    await app.db.pool.query("UPDATE events SET status='PUBLISHED' WHERE id=$1", [eventId]);
    await post(layout(1000)).expect(409);
  });
});
