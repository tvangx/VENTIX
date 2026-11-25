import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { EVENTS, VENUES, eventInput, organizerApp, venueInput } from "../helpers/organizer-app";
import { startFakeS3, type FakeS3 } from "../helpers/fake-s3";
import { CONTENT_TYPE, realImage, type ImageFormat } from "../helpers/images";

const BUCKET = "event-banners";
const MAX = 200_000;
const BASE = "https://cdn.test/event-banners";

describe("S-605 banner upload (presign, PUT, confirm)", () => {
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
        PUBLIC_ASSET_BASE_URL: BASE,
        UPLOAD_MAX_BYTES: String(MAX),
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

  const presign = (eventId: string, contentType: string, bytes: Buffer, auth = token) =>
    post(
      `${EVENTS}/${eventId}/banner/presign`,
      { content_type: contentType, size_bytes: bytes.length },
      auth,
    );

  /** Presign và PUT thật tới S3 giả; trả upload_id. */
  async function upload(eventId: string, bytes: Buffer, contentType = "image/png") {
    const res = await presign(eventId, contentType, bytes);
    expect(res.status).toBe(201);
    const put = await fetch(res.body.url, {
      method: "PUT",
      headers: res.body.headers,
      body: bytes,
    });
    expect(put.status).toBe(200);
    return res.body.upload_id as string;
  }

  const confirm = (
    eventId: string,
    upload_id: string,
    version: number,
    auth = token,
    key?: string,
  ) =>
    post(`${EVENTS}/${eventId}/banner/confirm`, { upload_id, version }, auth, key ?? randomUUID());

  const staged = (eventId: string, uploadId: string) =>
    s3.has(BUCKET, `staging/events/${eventId}/${uploadId}`);

  const publicKeys = (eventId: string) =>
    [...s3.objects.keys()].filter((key) => key.includes(`/public/events/${eventId}/`));

  it("requires an Organizer token with a tenant", async () => {
    const { id } = await createEvent();
    await app.http.post(`${EVENTS}/${id}/banner/presign`).send({}).expect(401);
    const png = await realImage("png");
    expect((await presign(id, "image/png", png, await app.token(tenant, ["USER"]))).status).toBe(
      403,
    );
    expect((await presign(id, "image/png", png, await app.token())).status).toBe(403);
  });

  it.each(["jpeg", "png", "webp"] as ImageFormat[])(
    "uploads a %s banner, publishes WebP banner + thumbnail and sets banner_key",
    async (format) => {
      const event = await createEvent();
      const bytes = await realImage(format, 2400, 800);
      const uploadId = await upload(event.id, bytes, CONTENT_TYPE[format]);
      expect(staged(event.id, uploadId)).toBe(true);

      const res = await confirm(event.id, uploadId, event.version);
      expect(res.status).toBe(200);
      const { banner_key, banner_url, thumbnail_url, version } = res.body;
      expect(banner_key).toMatch(new RegExp(`^public/events/${event.id}/[0-9a-f-]{36}\\.webp$`));
      expect(banner_url).toBe(`${BASE}/${banner_key}`);
      expect(thumbnail_url).toBe(`${BASE}/${banner_key.replace(/\.webp$/, "_thumb.webp")}`);
      expect(version).toBe(event.version + 1);

      const big = s3.stored(BUCKET, banner_key);
      const thumb = s3.stored(BUCKET, banner_key.replace(/\.webp$/, "_thumb.webp"));
      expect(await sharp(big?.body).metadata()).toMatchObject({ format: "webp", width: 1920 });
      expect(await sharp(thumb?.body).metadata()).toMatchObject({ format: "webp", width: 480 });
      expect(staged(event.id, uploadId)).toBe(false);

      const read = await app.http.get(`${EVENTS}/${event.id}`).auth(token, { type: "bearer" });
      expect(read.body).toMatchObject({ banner_key, version: event.version + 1 });
    },
  );

  it("validates presign input and hides other tenants' events", async () => {
    const { id } = await createEvent();
    const png = await realImage("png");
    expect((await presign(id, "image/gif", png)).status).toBe(400);
    expect((await presign(id, "image/png", Buffer.alloc(MAX + 1))).status).toBe(400);
    expect((await presign(id, "image/png", Buffer.alloc(0))).status).toBe(400);
    const extra = await post(`${EVENTS}/${id}/banner/presign`, {
      content_type: "image/png",
      size_bytes: 10,
      staging_key: "x",
    });
    expect(extra.status).toBe(400);
    expect((await presign(id, "image/png", png, outsider)).status).toBe(404);
    expect((await presign(randomUUID(), "image/png", png)).status).toBe(404);
  });

  it("refuses banner changes once the event left DRAFT/REJECTED", async () => {
    const event = await createEvent();
    const png = await realImage("png");
    const uploadId = await upload(event.id, png);
    await app.db.pool.query("UPDATE events SET status='PENDING' WHERE id=$1", [event.id]);
    expect((await presign(event.id, "image/png", png)).body.code).toBe("EVENT_NOT_EDITABLE");
    const res = await confirm(event.id, uploadId, event.version);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVENT_NOT_EDITABLE");
    expect(publicKeys(event.id)).toEqual([]);
  });

  it("replays presign and confirm with the same Idempotency-Key", async () => {
    const event = await createEvent();
    const png = await realImage("png");
    const body = { content_type: "image/png", size_bytes: png.length };
    const presignKey = randomUUID();
    const a = await post(`${EVENTS}/${event.id}/banner/presign`, body, token, presignKey);
    const b = await post(`${EVENTS}/${event.id}/banner/presign`, body, token, presignKey);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body.upload_id).toBe(a.body.upload_id);

    await fetch(a.body.url, { method: "PUT", headers: a.body.headers, body: png });
    const idem = randomUUID();
    const first = await confirm(event.id, a.body.upload_id, event.version, token, idem);
    const second = await confirm(event.id, a.body.upload_id, event.version, token, idem);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body).toEqual(first.body);
    expect(first.body.version).toBe(event.version + 1);
    const { rows } = await app.db.pool.query("SELECT version FROM events WHERE id=$1", [event.id]);
    expect(rows[0].version).toBe(event.version + 1);
  });

  it("rejects the same Idempotency-Key with a different payload, and a missing key", async () => {
    const event = await createEvent();
    const png = await realImage("png");
    const one = await upload(event.id, png);
    const two = await upload(event.id, png);
    const idem = randomUUID();
    expect((await confirm(event.id, one, event.version, token, idem)).status).toBe(200);
    const reused = await confirm(event.id, two, event.version, token, idem);
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const missing = await post(
      `${EVENTS}/${event.id}/banner/confirm`,
      { upload_id: two, version: event.version + 1 },
      token,
      null,
    );
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("INVALID_IDEMPOTENCY_KEY");
  });

  it("returns 404 UPLOAD_NOT_FOUND on a second confirm with a fresh key", async () => {
    const event = await createEvent();
    const uploadId = await upload(event.id, await realImage("png"));
    expect((await confirm(event.id, uploadId, event.version)).status).toBe(200);
    const again = await confirm(event.id, uploadId, event.version + 1);
    expect(again.status).toBe(404);
    expect(again.body.code).toBe("UPLOAD_NOT_FOUND");
  });

  it("rejects a stale version, keeps the old banner and leaves no public orphan", async () => {
    const event = await createEvent();
    const png = await realImage("png");
    const ok = await confirm(event.id, await upload(event.id, png), event.version);
    expect(ok.status).toBe(200);
    const publicBefore = publicKeys(event.id);
    const second = await upload(event.id, png);
    const stale = await confirm(event.id, second, event.version);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("VERSION_CONFLICT");
    expect(publicKeys(event.id)).toEqual(publicBefore);
    expect(staged(event.id, second)).toBe(true);
    const read = await app.http.get(`${EVENTS}/${event.id}`).auth(token, { type: "bearer" });
    expect(read.body.banner_key).toBe(ok.body.banner_key);
  });

  it("does not let an upload_id of one event be confirmed on another event", async () => {
    const event = await createEvent();
    const other = await createEvent();
    const uploadId = await upload(other.id, await realImage("png"));
    const res = await confirm(event.id, uploadId, event.version);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("UPLOAD_NOT_FOUND");
    expect(staged(other.id, uploadId)).toBe(true);
  });

  it("returns 404 to another tenant and does not probe storage for it", async () => {
    const event = await createEvent();
    const uploadId = await upload(event.id, await realImage("png"));
    const before = s3.requests.length;
    const res = await confirm(event.id, uploadId, event.version, outsider);
    expect(res.status).toBe(404);
    expect(s3.requests.length).toBe(before);
  });

  it("rejects malformed upload_id and returns 404 when the PUT never happened", async () => {
    const event = await createEvent();
    expect((await confirm(event.id, "not-a-uuid", event.version)).status).toBe(400);
    const signed = await presign(event.id, "image/png", await realImage("png"));
    const res = await confirm(event.id, signed.body.upload_id, event.version);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("UPLOAD_NOT_FOUND");
  });

  it("rejects and deletes fake content, undecodable images and oversize uploads", async () => {
    const event = await createEvent();
    const png = await realImage("png");
    const cases: Array<[string, Buffer, string]> = [
      ["image/png", Buffer.from("<html><script>alert(1)</script></html>"), "INVALID_IMAGE_CONTENT"],
      ["image/jpeg", png, "INVALID_IMAGE_CONTENT"],
      ["image/gif", png, "INVALID_IMAGE_TYPE"],
      [
        "image/png",
        Buffer.concat([png.subarray(0, 40), Buffer.alloc(200)]),
        "INVALID_IMAGE_CONTENT",
      ],
      ["image/png", Buffer.concat([png, Buffer.alloc(MAX)]), "IMAGE_TOO_LARGE"],
    ];
    for (const [putAs, bytes, code] of cases) {
      const signed = (await presign(event.id, "image/png", png)).body;
      // Mô phỏng client không tuân thủ chữ ký: S3 giả không kiểm chữ ký nên ghi trực tiếp.
      s3.put(BUCKET, `staging/events/${event.id}/${signed.upload_id}`, bytes, putAs);
      const res = await confirm(event.id, signed.upload_id, event.version);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(code);
      expect(staged(event.id, signed.upload_id)).toBe(false);
    }
    expect(publicKeys(event.id)).toEqual([]);
    const read = await app.http.get(`${EVENTS}/${event.id}`).auth(token, { type: "bearer" });
    expect(read.body.banner_key).toBeNull();
    expect(read.body.version).toBe(event.version);
  });
});
