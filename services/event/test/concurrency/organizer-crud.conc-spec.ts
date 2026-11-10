import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { EVENTS, VENUES, eventInput, organizerApp, venueInput } from "../helpers/organizer-app";

describe("S-201 Organizer concurrent writes", () => {
  let app: Awaited<ReturnType<typeof organizerApp>>;
  let tenant: string;
  let token: string;
  beforeAll(async () => {
    app = await organizerApp();
    tenant = randomUUID();
    token = await app.token(tenant);
  });
  afterAll(async () => {
    await app?.close();
  });

  const post = (url: string, data: object, key = randomUUID()) =>
    app.http.post(url).auth(token, { type: "bearer" }).set("Idempotency-Key", key).send(data);

  it("returns one venue for 50 simultaneous POSTs using the same key", async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => post(VENUES, venueInput, key).expect(201)),
    );
    expect(new Set(results.map(({ body }) => body.id)).size).toBe(1);
    const result = await app.db.pool.query(
      "SELECT count(*)::int AS count FROM venues WHERE organizer_id=$1",
      [tenant],
    );
    expect(result.rows[0].count).toBe(1);
  });

  it("keeps the child's write behind an in-flight event state change", async () => {
    const venue = await post(VENUES, venueInput).expect(201);
    const event = await post(EVENTS, eventInput(venue.body.id)).expect(201);
    const db = await app.db.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("UPDATE events SET status='PENDING' WHERE id=$1", [event.body.id]);
      const attempted = post(EVENTS + "/" + event.body.id + "/ticket-classes", {
        name: "GA",
        price_vnd: 10000,
        capacity: 20,
        kind: "GA",
      }).then((response) => response);
      const owner = await db.query("SELECT pg_backend_pid() AS pid");
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        const result = await app.db.pool.query<{ waiting: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) AS waiting",
          [owner.rows[0].pid],
        );
        waiting = result.rows[0].waiting;
        if (!waiting) await setTimeout(25);
      }
      await db.query("COMMIT");
      expect(waiting).toBe(true);
      expect((await attempted).status).toBe(409);
      const result = await db.query(
        "SELECT count(*)::int AS count FROM ticket_classes WHERE event_id=$1",
        [event.body.id],
      );
      expect(result.rows[0].count).toBe(0);
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });
});
