import { randomUUID } from "node:crypto";
import { EVENTS, VENUES, eventInput, organizerApp, venueInput } from "../helpers/organizer-app";
import { JPEG_BYTES, PNG_BYTES, WEBP_BYTES, startFakeS3, type FakeS3 } from "../helpers/fake-s3";

const BUCKET = "event-banners";
const MAX = 2048;

describe("S-201b banner upload (presign, PUT, confirm)", () => {
  let app: Awaited<ReturnType<typeof organizerApp>>;
  let s3: FakeS3;
  let tenant: string;
  let token: string;
  let outsider: string;

  beforeAll(async () => {
    s3 = await startFakeS3();
    app = await organizerApp({
      env: {
        MINIO_ENDPOINT: s3.endpoint,
        MINIO_BUCKET: BUCKET,
        MINIO_ACCESS_KEY: "test-access",
        MINIO_SECRET_KEY: "test-secret",
        BANNER_MAX_BYTES: String(MAX),
      },
    });
    tenant = randomUUID();
    token = await app.token(tenant);
    outsider = await app.token(randomUUID());
  });

  afterAll(async () => {
    await app?.close();
    await s3?.close();
  });

  const post = (url: string, data: object, auth = token, key: string | null = randomUUID()) => {
    const req = app.http.post(url).auth(auth, { type: "bearer" });
    return (key ? req.set("Idempotency-Key", key) : req).send(data);
  };

  async function createEvent() {
    const venue = await post(VENUES, venueInput).expect(201);
    const event = await post(EVENTS, eventInput(venue.body.id)).expect(201);
    return event.body as { id: string; version: number };
  }

  async function presign(eventId: string, contentType: string, bytes: Buffer, auth = token) {
    return post(
      `${EVENTS}/${eventId}/banner/presign`,
      { content_type: contentType, size_bytes: bytes.length },
      auth,
      null,
    );
  }

  /** Presign và PUT thật tới S3 giả; trả object_key. */
  async function upload(eventId: string, contentType: string, bytes: Buffer) {
    const signed = await presign(eventId, contentType, bytes).then((res) => {
      expect(res.status).toBe(200);
      return res.body as {
        object_key: string;
        upload_url: string;
        headers: Record<string, string>;
      };
    });
    const put = await fetch(signed.upload_url, {
      method: "PUT",
      headers: signed.headers,
      body: bytes,
    });
    expect(put.status).toBe(200);
    return signed.object_key;
  }

  const confirm = (
    eventId: string,
    object_key: string,
    version: number,
    auth = token,
    key?: string,
  ) =>
    post(`${EVENTS}/${eventId}/banner/confirm`, { object_key, version }, auth, key ?? randomUUID());

  it("requires an Organizer token with a tenant", async () => {
    const { id } = await createEvent();
    await app.http.post(`${EVENTS}/${id}/banner/presign`).send({}).expect(401);
    await presign(id, "image/png", PNG_BYTES, await app.token(tenant, ["USER"])).then((res) =>
      expect(res.status).toBe(403),
    );
    await presign(id, "image/png", PNG_BYTES, await app.token()).then((res) =>
      expect(res.status).toBe(403),
    );
  });

  it("uploads and confirms a PNG, JPEG and WebP banner end to end", async () => {
    for (const [type, bytes] of [
      ["image/png", PNG_BYTES],
      ["image/jpeg", JPEG_BYTES],
      ["image/webp", WEBP_BYTES],
    ] as const) {
      const event = await createEvent();
      const key = await upload(event.id, type, bytes);
      const res = await confirm(event.id, key, event.version);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: event.id, banner_key: key, version: event.version + 1 });
      const read = await app.http.get(`${EVENTS}/${event.id}`).auth(token, { type: "bearer" });
      expect(read.body.banner_key).toBe(key);
    }
  });

  it("validates presign input and hides other tenants' events", async () => {
    const { id } = await createEvent();
    expect((await presign(id, "image/gif", PNG_BYTES)).status).toBe(400);
    expect((await presign(id, "image/png", Buffer.alloc(MAX + 1))).status).toBe(400);
    expect((await presign(id, "image/png", Buffer.alloc(0))).status).toBe(400);
    expect(
      (
        await post(`${EVENTS}/${id}/banner/presign`, {
          content_type: "image/png",
          size_bytes: 10,
          object_key: "events/x/y.png",
        })
      ).status,
    ).toBe(400);
    expect((await presign(id, "image/png", PNG_BYTES, outsider)).status).toBe(404);
    expect((await presign(randomUUID(), "image/png", PNG_BYTES)).status).toBe(404);
  });

  it("refuses banner changes once the event left DRAFT/REJECTED", async () => {
    const event = await createEvent();
    const key = await upload(event.id, "image/png", PNG_BYTES);
    await app.db.pool.query("UPDATE events SET status='PENDING' WHERE id=$1", [event.id]);
    expect((await presign(event.id, "image/png", PNG_BYTES)).body.code).toBe("EVENT_NOT_EDITABLE");
    const res = await confirm(event.id, key, event.version);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVENT_NOT_EDITABLE");
  });

  it("is idempotent: same key + payload replays, different payload is rejected", async () => {
    const event = await createEvent();
    const first = await upload(event.id, "image/png", PNG_BYTES);
    const idem = randomUUID();
    const a = await confirm(event.id, first, event.version, token, idem);
    const b = await confirm(event.id, first, event.version, token, idem);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.body).toEqual(a.body);
    expect(a.body.version).toBe(event.version + 1);

    const second = await upload(event.id, "image/png", PNG_BYTES);
    const reused = await confirm(event.id, second, event.version, token, idem);
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const missing = await post(
      `${EVENTS}/${event.id}/banner/confirm`,
      { object_key: second, version: a.body.version },
      token,
      null,
    );
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("INVALID_IDEMPOTENCY_KEY");
  });

  it("rejects a stale version and keeps the old banner", async () => {
    const event = await createEvent();
    const first = await upload(event.id, "image/png", PNG_BYTES);
    const ok = await confirm(event.id, first, event.version);
    expect(ok.status).toBe(200);
    const second = await upload(event.id, "image/png", PNG_BYTES);
    const stale = await confirm(event.id, second, event.version);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("VERSION_CONFLICT");
    const read = await app.http.get(`${EVENTS}/${event.id}`).auth(token, { type: "bearer" });
    expect(read.body.banner_key).toBe(first);
  });

  it("rejects keys that are not the issued shape or belong to another event", async () => {
    const event = await createEvent();
    const other = await createEvent();
    const foreign = await upload(other.id, "image/png", PNG_BYTES);
    for (const key of [
      foreign,
      "seed/banners/a.jpg",
      `events/${event.id}/../${other.id}/x.png`,
      `events/${event.id}/${randomUUID()}.gif`,
    ]) {
      const res = await confirm(event.id, key, event.version);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_BANNER_KEY");
    }
  });

  it("returns 404 to another tenant and does not probe storage for it", async () => {
    const event = await createEvent();
    const key = await upload(event.id, "image/png", PNG_BYTES);
    const before = s3.requests.length;
    const res = await confirm(event.id, key, event.version, outsider);
    expect(res.status).toBe(404);
    expect(s3.requests.length).toBe(before);
  });

  it("returns 409 BANNER_NOT_UPLOADED when the PUT never happened", async () => {
    const event = await createEvent();
    const signed = await presign(event.id, "image/png", PNG_BYTES);
    const res = await confirm(event.id, signed.body.object_key, event.version);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("BANNER_NOT_UPLOADED");
  });

  it("rejects and deletes fake content, wrong content-type and oversize uploads", async () => {
    const event = await createEvent();
    const cases: Array<[string, string, Buffer, string]> = [
      [
        "image/png",
        "image/png",
        Buffer.from("<html><script>alert(1)</script></html>"),
        "INVALID_BANNER_CONTENT",
      ],
      ["image/png", "image/jpeg", PNG_BYTES, "BANNER_TYPE_MISMATCH"],
      ["image/png", "image/png", Buffer.concat([PNG_BYTES, Buffer.alloc(MAX)]), "BANNER_TOO_LARGE"],
    ];
    for (const [issuedAs, putAs, bytes, code] of cases) {
      const signed = (await presign(event.id, issuedAs, PNG_BYTES)).body;
      // Mô phỏng client không tuân thủ chữ ký: S3 giả không kiểm chữ ký nên ghi trực tiếp.
      s3.put(BUCKET, signed.object_key, bytes, putAs);
      const res = await confirm(event.id, signed.object_key, event.version);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(code);
      expect(s3.has(BUCKET, signed.object_key)).toBe(false);
    }
    const read = await app.http.get(`${EVENTS}/${event.id}`).auth(token, { type: "bearer" });
    expect(read.body.banner_key).toBeNull();
    expect(read.body.version).toBe(event.version);
  });
});
