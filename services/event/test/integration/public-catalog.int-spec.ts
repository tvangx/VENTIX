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
