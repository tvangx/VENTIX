import { randomUUID } from "node:crypto";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { PublicCatalogRepository } from "../../src/modules/public-catalog/public-catalog.repository";
import { organizerApp } from "../helpers/organizer-app";

describe("S-204 public catalog", () => {
  let redis: StartedTestContainer | undefined;
  let app: Awaited<ReturnType<typeof organizerApp>>;
  const eventId = randomUUID();
  const venueId = randomUUID();
  const organizerId = randomUUID();

  beforeAll(async () => {
    redis = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
    app = await organizerApp({
      redisUrl: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
      env: { PUBLIC_ASSET_BASE_URL: "https://cdn.test/event-banners/" },
    });
    await app.db.pool.query(
      "INSERT INTO venues (id,organizer_id,name,address,capacity,updated_at) VALUES ($1,$2,'Main Hall','Hanoi',100,now())",
      [venueId, organizerId],
    );
    await app.db.pool.query(
      "INSERT INTO events (id,organizer_id,venue_id,title,description,status,start_at,end_at,updated_at) VALUES ($1,$2,$3,'Concert A','Public show','DRAFT','2030-01-01T18:00:00Z','2030-01-01T20:00:00Z',now())",
      [eventId, organizerId, venueId],
    );
  });

  afterAll(async () => {
    await app?.close();
    await redis?.stop();
  });

  it("returns card data and combines date, price, sale filters and sorted cursors", async () => {
    const [late, early, earlyPeer, unpriced] = Array.from({ length: 4 }, () => randomUUID()).sort();
    const cardVenue = randomUUID();
    const day = "2032-01-01T00:00:00Z";
    const nextDay = "2032-01-02T00:00:00Z";
    const earlier = "2032-01-01T18:00:00Z";
    await app.db.pool.query(
      "INSERT INTO venues (id,organizer_id,name,address,capacity,updated_at) VALUES ($1,$2,'Lotus Hall','Catalog District',100,now())",
      [cardVenue, organizerId],
    );
    for (const [id, start] of [
      [early, earlier],
      [earlyPeer, earlier],
      [unpriced, earlier],
      [late, nextDay],
    ]) {
      await app.db.pool.query(
        `INSERT INTO events (id,organizer_id,venue_id,title,description,status,start_at,end_at,updated_at)
         VALUES ($1,$2,$3,'Catalog Showcase','Public list fixture','PUBLISHED',$4::timestamptz,$4::timestamptz + interval '1 hour',now())`,
        [id, organizerId, cardVenue, start],
      );
    }
    for (const [id, price, name] of [
      [early, 300, "Standard"],
      [early, 900, "VIP"],
      [earlyPeer, 100, "GA"],
      [late, 100, "GA"],
    ]) {
      await app.db.pool.query(
        `INSERT INTO ticket_classes (id,event_id,name,price_vnd,capacity,kind,updated_at)
         VALUES ($1,$2,$3,$4,100,'GA',now())`,
        [randomUUID(), id, name, price],
      );
    }
    const now = Date.now();
    const future = new Date(now + 3_600_000);
    for (const [id, start, end] of [
      [early, future, new Date(+future + 3_600_000)],
      [earlyPeer, new Date(now - 3_600_000), future],
    ]) {
      await app.db.pool.query(
        `INSERT INTO sale_phases (id,event_id,starts_at,ends_at,queue_enabled,admit_rate,per_user_limit,require_kyc,updated_at)
         VALUES ($1,$2,$3,$4,true,10,4,false,now())`,
        [randomUUID(), id, start, end],
      );
    }
    const request = (query: object) =>
      app.http
        .get("/v1/events")
        .query({ q: "catalog district", ...query })
        .expect(200);
    const ids = (body: { items: Array<{ id: string }> }) => body.items.map(({ id }) => id);
    const first = await request({
      start_from: day,
      start_before: nextDay,
      sort: "start_at",
      limit: 1,
    });
    expect(first.body.items[0]).toMatchObject({
      id: early,
      venue_name: "Lotus Hall",
      venue_address: "Catalog District",
      min_ticket_price_vnd: 300,
      sale_status: "UPCOMING",
      next_sale_starts_at: future.toISOString(),
      sale_queue_enabled: true,
    });
    expect(first.body.items[0]).not.toHaveProperty("windows");
    expect(first.body.next_cursor).toBe(`start_at|${early}|2032-01-01T18:00:00.000000Z`);
    const legacy = await request({ limit: 1 });
    expect(legacy.body.next_cursor).toBe(late);
    expect(ids((await request({ cursor: legacy.body.next_cursor })).body)).toEqual([
      early,
      earlyPeer,
      unpriced,
    ]);
    const priced = await request({ min_price_vnd: 100, max_price_vnd: 200 });
    expect(ids(priced.body)).toEqual([late, earlyPeer]);
    const sorted = await request({ sort: "price_asc", limit: 1 });
    expect(ids(sorted.body)).toEqual([late]);
    const tail = await request({ sort: "price_asc", cursor: sorted.body.next_cursor });
    expect(ids(tail.body)).toEqual([earlyPeer, early, unpriced]);
    expect(tail.body.items[2].min_ticket_price_vnd).toBeNull();
    expect(ids((await request({ sale_status: "ON_SALE" })).body)).toEqual([earlyPeer]);
    expect(ids((await request({ sale_status: "UPCOMING" })).body)).toEqual([early]);
    expect(ids((await request({ sale_status: "CLOSED" })).body)).toEqual([late, unpriced]);
    expect(ids((await request({ start_from: "2032-01-02T07:00:00+07:00" })).body)).toEqual([late]);

    await app.db.pool.query("UPDATE events SET status='CANCELLED' WHERE id=$1", [early]);
    const next = await request({
      start_from: day,
      start_before: nextDay,
      sort: "start_at",
      cursor: first.body.next_cursor,
    });
    expect(ids(next.body)).toEqual([earlyPeer, unpriced]);
  });

  it("S-605 returns banner_url/thumbnail_url for public keys only, null otherwise", async () => {
    const withBanner = randomUUID();
    const seeded = randomUUID();
    const without = randomUUID();
    const bannerVenue = randomUUID();
    const key = `public/events/${withBanner}/${randomUUID()}.webp`;
    const thumb = key.replace(/\.webp$/, "_thumb.webp");
    await app.db.pool.query(
      "INSERT INTO venues (id,organizer_id,name,address,capacity,updated_at) VALUES ($1,$2,'Banner Hall','Banner Quarter',100,now())",
      [bannerVenue, organizerId],
    );
    for (const [id, banner] of [
      [withBanner, key],
      [seeded, "seed/banners/a.jpg"],
      [without, null],
    ]) {
      await app.db.pool.query(
        `INSERT INTO events (id,organizer_id,venue_id,title,description,banner_key,status,start_at,end_at,updated_at)
         VALUES ($1,$2,$3,'Banner Show','Banner fixture',$4,'PUBLISHED','2033-01-01T18:00:00Z','2033-01-01T20:00:00Z',now())`,
        [id, organizerId, bannerVenue, banner],
      );
    }
    const list = await app.http.get("/v1/events").query({ q: "banner quarter" }).expect(200);
    const byId = new Map<string, Record<string, string | null>>(
      list.body.items.map((item: { id: string }) => [item.id, item]),
    );
    expect(byId.get(withBanner)).toMatchObject({
      banner_key: key,
      banner_url: `https://cdn.test/event-banners/${key}`,
      thumbnail_url: `https://cdn.test/event-banners/${thumb}`,
    });
    expect(byId.get(seeded)).toMatchObject({
      banner_key: "seed/banners/a.jpg",
      banner_url: null,
      thumbnail_url: null,
    });
    expect(byId.get(without)).toMatchObject({
      banner_key: null,
      banner_url: null,
      thumbnail_url: null,
    });
    const detail = await app.http.get(`/v1/events/${withBanner}`).expect(200);
    expect(detail.body).toMatchObject({
      banner_url: `https://cdn.test/event-banners/${key}`,
      thumbnail_url: `https://cdn.test/event-banners/${thumb}`,
    });
    const none = await app.http.get(`/v1/events/${without}`).expect(200);
    expect([none.body.banner_url, none.body.thumbnail_url]).toEqual([null, null]);
  });

  it("rejects malformed or reversed catalog filters", async () => {
    for (const query of [
      { start_from: "2032-01-01" },
      { start_from: "2032-01-02T00:00:00Z", start_before: "2032-01-01T00:00:00Z" },
      { min_price_vnd: 200, max_price_vnd: 100 },
      { min_price_vnd: "9007199254740992" },
      { sort: "popular" },
      { sale_status: "LOW_STOCK" },
      { sort: "start_at", cursor: randomUUID() },
      { sort: "price_asc", cursor: `start_at|${randomUUID()}|2032-01-01T18:00:00.000000Z` },
      { sort: "price_asc", cursor: `price_asc|${randomUUID()}|9007199254740992` },
    ]) {
      await app.http.get("/v1/events").query(query).expect(400);
    }
  });

  it("filters unpublished events, caches reads, handles ETags and hides cancelled events despite old cache", async () => {
    await app.http.get(`/v1/events/${eventId}`).expect(404);
    await app.db.pool.query("UPDATE events SET status='APPROVED' WHERE id=$1", [eventId]);
    await app.http.get(`/v1/events/${eventId}`).expect(404);
    await app.db.pool.query("UPDATE events SET status='PUBLISHED' WHERE id=$1", [eventId]);

    const detail = await app.http.get(`/v1/events/${eventId}`).expect(200);
    expect(detail.body.status).toBe("PUBLISHED");
    expect(detail.body.venue.name).toBe("Main Hall");
    expect(detail.headers.etag).toMatch(/^"[a-f0-9]{64}"$/);
    await app.http
      .get(`/v1/events/${eventId}`)
      .set("If-None-Match", detail.headers.etag)
      .expect(304);

    const list = await app.http.get("/v1/events?q=concert%20a&limit=1").expect(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([eventId]);
    await app.http
      .get("/v1/events?q=concert%20a&limit=1")
      .set("If-None-Match", list.headers.etag)
      .expect(304);
    await app.http
      .get("/v1/events?q=missing")
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(0);
      });
    await app.http.get("/v1/events?limit=0").expect(400);
    await app.http.get("/v1/events/not-a-uuid").expect(400);

    const coldId = randomUUID();
    await app.db.pool.query(
      "INSERT INTO events (id,organizer_id,venue_id,title,description,status,start_at,end_at,updated_at) VALUES ($1,$2,$3,'Concert B','Second show','PUBLISHED','2030-01-02T18:00:00Z','2030-01-02T20:00:00Z',now())",
      [coldId, organizerId, venueId],
    );
    const detailSpy = jest.spyOn(app.nest.get(PublicCatalogRepository), "detail");
    const cold = await Promise.all(
      Array.from({ length: 50 }, () => app.http.get(`/v1/events/${coldId}`).expect(200)),
    );
    expect(cold).toHaveLength(50);
    expect(detailSpy).toHaveBeenCalledTimes(1);
    detailSpy.mockRestore();

    async function cacheCounts() {
      const metrics = await app.http.get("/metrics").expect(200);
      return {
        hits: Number(
          metrics.text.match(/event_catalog_cache_requests_total\{result="hit"\} (\d+)/)?.[1] ?? 0,
        ),
        misses: Number(
          metrics.text.match(/event_catalog_cache_requests_total\{result="miss"\} (\d+)/)?.[1] ?? 0,
        ),
      };
    }
    const beforeWarm = await cacheCounts();
    const responses = await Promise.all(
      Array.from({ length: 100 }, () => app.http.get(`/v1/events/${eventId}`).expect(200)),
    );
    expect(responses.every((response) => response.body.id === eventId)).toBe(true);
    const afterWarm = await cacheCounts();
    const hits = afterWarm.hits - beforeWarm.hits;
    const misses = afterWarm.misses - beforeWarm.misses;
    expect(hits + misses).toBe(100);
    expect(hits).toBeGreaterThan(90);

    await app.db.pool.query("UPDATE events SET status='CANCELLED',version=version+1 WHERE id=$1", [
      eventId,
    ]);
    await app.http
      .get(`/v1/events/${eventId}`)
      .set("If-None-Match", detail.headers.etag)
      .expect(404);
    const after = await app.http
      .get("/v1/events?q=concert%20a&limit=1")
      .set("If-None-Match", list.headers.etag)
      .expect(200);
    expect(after.body.items).toHaveLength(0);
    expect(after.headers.etag).not.toBe(list.headers.etag);

    await redis?.stop();
    redis = undefined;
    await app.http.get(`/v1/events/${coldId}`).expect(200);
  });
});
