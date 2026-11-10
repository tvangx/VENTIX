import { randomUUID } from "node:crypto";
import { EVENTS, VENUES, eventInput, organizerApp, venueInput } from "../helpers/organizer-app";

describe("S-201 Organizer Event CRUD", () => {
  let app: Awaited<ReturnType<typeof organizerApp>>;
  let tenant: string;
  let token: string;
  let outsider: string;

  beforeAll(async () => {
    app = await organizerApp();
    tenant = randomUUID();
    token = await app.token(tenant);
    outsider = await app.token(randomUUID());
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (url: string, auth = token) => app.http.get(url).auth(auth, { type: "bearer" });
  const post = (url: string, data: object, auth = token, key = randomUUID()) =>
    app.http.post(url).auth(auth, { type: "bearer" }).set("Idempotency-Key", key).send(data);
  const patch = (url: string, data: object, auth = token) =>
    app.http
      .patch(url)
      .auth(auth, { type: "bearer" })
      .set("Idempotency-Key", randomUUID())
      .send(data);
  const remove = (url: string, version: number, auth = token) =>
    app.http
      .delete(url)
      .auth(auth, { type: "bearer" })
      .set("Idempotency-Key", randomUUID())
      .query({ version });

  async function createEvent() {
    const venue = await post(VENUES, venueInput).expect(201);
    const event = await post(EVENTS, eventInput(venue.body.id)).expect(201);
    return { venueId: String(venue.body.id), eventId: String(event.body.id) };
  }

  it("requires JWT Organizer and a signed tenant claim", async () => {
    await app.http.get(EVENTS).expect(401);
    await get(EVENTS, await app.token(tenant, ["USER"])).expect(403);
    await get(EVENTS, await app.token()).expect(403);
    await get(EVENTS, await app.token("not-a-uuid")).expect(403);
    await post(VENUES, { ...venueInput, organizer_id: tenant }).expect(400);
  });

  it("scopes reads, writes and foreign keys to the signed tenant", async () => {
    const { venueId, eventId } = await createEvent();
    const outsiderVenue = await post(VENUES, venueInput, outsider).expect(201);
    const outsiderEvent = await post(EVENTS, eventInput(outsiderVenue.body.id), outsider).expect(
      201,
    );
    const classPath = EVENTS + "/" + eventId + "/ticket-classes";
    const classInput = { name: "VIP", price_vnd: 123456, capacity: 20, kind: "GA" };
    const klass = await post(classPath, classInput).expect(201);
    await get(VENUES, outsider)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.map((item: { id: string }) => item.id)).not.toContain(venueId);
      });
    await get(EVENTS + "/" + eventId, outsider).expect(404);
    await patch(EVENTS + "/" + eventId, { title: "Wrong tenant", version: 0 }, outsider).expect(
      404,
    );
    await remove(EVENTS + "/" + eventId, 0, outsider).expect(404);
    await get(VENUES + "/" + venueId, outsider).expect(404);
    await patch(VENUES + "/" + venueId, { name: "Wrong tenant", version: 0 }, outsider).expect(404);
    await remove(VENUES + "/" + venueId, 0, outsider).expect(404);
    await post(EVENTS, eventInput(venueId), outsider).expect(404);
    await get(classPath, outsider).expect(404);
    await post(classPath, classInput, outsider).expect(404);
    await get(
      EVENTS + "/" + outsiderEvent.body.id + "/ticket-classes/" + klass.body.id,
      outsider,
    ).expect(404);
    await expect(
      app.db.pool.query("UPDATE events SET venue_id=$1 WHERE id=$2", [
        outsiderVenue.body.id,
        eventId,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("uses tenant-scoped cursor pages and versions for updates and deletes", async () => {
    const { venueId, eventId } = await createEvent();
    await post(VENUES, venueInput).expect(201);
    const first = await get(VENUES + "?limit=1").expect(200);
    const second = await get(VENUES + "?limit=1&cursor=" + first.body.next_cursor).expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    await patch(VENUES + "/" + venueId, { name: "New name", version: 0 })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ name: "New name", version: 1 }));
    await patch(VENUES + "/" + venueId, { name: "Stale", version: 0 }).expect(409);
    await remove(VENUES + "/" + venueId, 1).expect(409);
    await patch(EVENTS + "/" + eventId, { version: 0, title: "Updated title" })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ title: "Updated title", version: 1, status: "DRAFT" }),
      );
    await remove(EVENTS + "/" + eventId, 0).expect(409);
    await remove(EVENTS + "/" + eventId, 1).expect(204);
    await remove(VENUES + "/" + venueId, 1).expect(204);
  });

  it("validates time ranges, safe integer prices and patch fields", async () => {
    const { venueId, eventId } = await createEvent();
    const invalidEnd = "2029-12-31T00:00:00Z";
    await post(EVENTS, { ...eventInput(venueId), end_at: invalidEnd }).expect(400);
    await patch(EVENTS + "/" + eventId, { version: 0, end_at: invalidEnd }).expect(400);
    await patch(EVENTS + "/" + eventId, { version: 0, title: null }).expect(400);
    await patch(EVENTS + "/" + eventId, { version: 0, status: "APPROVED" }).expect(400);
    await post(EVENTS + "/" + eventId + "/ticket-classes", {
      name: "VIP",
      price_vnd: 1.5,
      capacity: 20,
      kind: "GA",
    }).expect(400);
    await get(VENUES + "?limit=101").expect(400);
  });

  it("manages ticket classes and sale phases while the event is editable", async () => {
    const { venueId, eventId } = await createEvent();
    const event = EVENTS + "/" + eventId;
    const classes = event + "/ticket-classes";
    const phases = event + "/sale-phases";
    const klass = { name: "VIP", price_vnd: 123456, capacity: 20, kind: "GA" };
    const phase = {
      starts_at: "2029-10-01T00:00:00Z",
      ends_at: "2029-12-01T00:00:00Z",
      admit_rate: 5,
      per_user_limit: 2,
    };
    const ticket = await post(classes, klass).expect(201);
    const sale = await post(phases, phase).expect(201);
    const ticketUrl = classes + "/" + ticket.body.id;
    const saleUrl = phases + "/" + sale.body.id;
    await get(ticketUrl)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject(klass));
    await get(phases)
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(1));
    await get(saleUrl).expect(200);
    await post(classes, klass).expect(409);
    await patch(saleUrl, { version: 0, ends_at: phase.starts_at }).expect(400);
    await patch(ticketUrl, { version: 0, price_vnd: 200000 }).expect(200);
    await app.db.pool.query("UPDATE events SET status='PENDING' WHERE id=$1", [eventId]);
    await get(event).expect(200);
    await patch(event, { version: 0, title: "Blocked" }).expect(409);
    await patch(VENUES + "/" + venueId, { version: 0, address: "Blocked" }).expect(409);
    await post(classes, { ...klass, name: "Second" }).expect(409);
    await patch(saleUrl, { version: 0, admit_rate: 6 }).expect(409);
    await remove(ticketUrl, 1).expect(409);
    await app.db.pool.query("UPDATE events SET status='REJECTED' WHERE id=$1", [eventId]);
    await patch(saleUrl, { version: 0, admit_rate: 6 }).expect(200);
    await remove(ticketUrl, 1).expect(204);
    await remove(saleUrl, 1).expect(204);
  });

  it("replays idempotent writes, rejects key reuse, and frees the key after rollback", async () => {
    const key = randomUUID();
    await app.http.post(VENUES).auth(token, { type: "bearer" }).send(venueInput).expect(400);
    await post(EVENTS, eventInput(randomUUID()), token, key).expect(404);
    const first = await post(VENUES, venueInput, token, key).expect(201);
    const replay = await post(
      VENUES,
      { capacity: 100, address: "Test address", name: "Test venue" },
      token,
      key,
    ).expect(201);
    expect(replay.body).toEqual(first.body);
    await post(VENUES, { ...venueInput, capacity: 101 }, token, key)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe("IDEMPOTENCY_KEY_REUSED"));
    const independent = await post(VENUES, venueInput, outsider, key).expect(201);
    expect(independent.body.id).not.toBe(first.body.id);
  });
});
