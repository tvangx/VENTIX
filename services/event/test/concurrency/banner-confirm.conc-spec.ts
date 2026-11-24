import { randomUUID } from "node:crypto";
import { EVENTS, VENUES, eventInput, organizerApp, venueInput } from "../helpers/organizer-app";
import { PNG_BYTES, startFakeS3, type FakeS3 } from "../helpers/fake-s3";

const CONCURRENCY = 50;

describe("S-201b banner confirm under concurrency", () => {
  let app: Awaited<ReturnType<typeof organizerApp>>;
  let s3: FakeS3;
  let token: string;

  beforeAll(async () => {
    s3 = await startFakeS3();
    app = await organizerApp({
      env: {
        MINIO_ENDPOINT: s3.endpoint,
        MINIO_ACCESS_KEY: "test-access",
        MINIO_SECRET_KEY: "test-secret",
      },
    });
    token = await app.token(randomUUID());
  });

  afterAll(async () => {
    await app?.close();
    await s3?.close();
  });

  const post = (url: string, data: object, key = randomUUID()) =>
    app.http.post(url).auth(token, { type: "bearer" }).set("Idempotency-Key", key).send(data);

  async function eventWithUploads(count: number) {
    const venue = await post(VENUES, venueInput).expect(201);
    const event = (await post(EVENTS, eventInput(venue.body.id)).expect(201)).body as {
      id: string;
      version: number;
    };
    const keys: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const signed = (
        await post(`${EVENTS}/${event.id}/banner/presign`, {
          content_type: "image/png",
          size_bytes: PNG_BYTES.length,
        }).expect(200)
      ).body;
      const put = await fetch(signed.upload_url, {
        method: "PUT",
        headers: signed.headers,
        body: PNG_BYTES,
      });
      expect(put.status).toBe(200);
      keys.push(signed.object_key);
    }
    return { event, keys };
  }

  it("applies one confirm exactly once when 50 requests share an Idempotency-Key", async () => {
    const { event, keys } = await eventWithUploads(1);
    const idem = randomUUID();
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        post(
          `${EVENTS}/${event.id}/banner/confirm`,
          { object_key: keys[0], version: event.version },
          idem,
        ),
      ),
    );
    expect(results.map((res) => res.status)).toEqual(Array(CONCURRENCY).fill(200));
    for (const res of results) expect(res.body).toEqual(results[0].body);
    expect(results[0].body.version).toBe(event.version + 1);
    const { rows } = await app.db.pool.query("SELECT version, banner_key FROM events WHERE id=$1", [
      event.id,
    ]);
    expect(rows[0]).toEqual({ version: event.version + 1, banner_key: keys[0] });
  });

  it("lets exactly one of 50 competing confirms win the same version", async () => {
    const { event, keys } = await eventWithUploads(CONCURRENCY);
    const results = await Promise.all(
      keys.map((key) =>
        post(`${EVENTS}/${event.id}/banner/confirm`, { object_key: key, version: event.version }),
      ),
    );
    const won = results.filter((res) => res.status === 200);
    const lost = results.filter((res) => res.status === 409);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(CONCURRENCY - 1);
    for (const res of lost) expect(res.body.code).toBe("VERSION_CONFLICT");
    const { rows } = await app.db.pool.query("SELECT version, banner_key FROM events WHERE id=$1", [
      event.id,
    ]);
    expect(rows[0]).toEqual({ version: event.version + 1, banner_key: won[0].body.banner_key });
  });
});
