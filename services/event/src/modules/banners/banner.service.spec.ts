import sharp from "sharp";
import { ProblemException } from "@ticketing/common";
import type { Env } from "../../config/env.schema";
import type { OrganizerRepository } from "../organizer/organizer.repository";
import type { OrganizerWrites } from "../organizer/organizer-writes";
import { BannerService } from "./banner.service";
import type { BannerStorage, StoredBanner } from "./banner.storage";

const TENANT = "5a1f0c3e-7b2d-4c8e-9f10-a1b2c3d4e5f6";
const EVENT = "0b9b7a3e-4c1d-4e2f-9a6b-1d2c3e4f5a6b";
const UPLOAD = "7f1d6c2a-3b4e-4a5f-8c9d-0e1f2a3b4c5d";
const STAGING = `staging/events/${EVENT}/${UPLOAD}`;
const IDEMPOTENCY = "c3f1a2b4-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const MAX = 100_000;
const BASE = "https://cdn.test/event-banners";

let png: Buffer;
beforeAll(async () => {
  png = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#123456" } })
    .png()
    .toBuffer();
});

function rejects(promise: Promise<unknown>, status: number, code: string) {
  return expect(promise).rejects.toMatchObject({ constructor: ProblemException, status, code });
}

function setup(over: { status?: string; stored?: StoredBanner | null; body?: Buffer } = {}) {
  const event = { id: EVENT, organizerId: TENANT, status: over.status ?? "DRAFT", version: 3 };
  const repo = {
    event: jest.fn(async (tenant: string) => (tenant === TENANT ? event : null)),
    updateEvent: jest.fn(async () => ({ ...event, version: 4 })),
  };
  const writes = {
    run: jest.fn(
      async (
        _t: string,
        _k: string | undefined,
        _op: string,
        _payload: object,
        write: (tx: object) => Promise<object>,
      ) => write({}),
    ),
  };
  const stored =
    over.stored === undefined
      ? { size: png.length, contentType: "image/png", head: png.subarray(0, 12) }
      : over.stored;
  const storage = {
    presignUpload: jest.fn(async (_key: string, _type: string, _size: number) => ({
      url: "http://minio.test/event-banners/signed",
      headers: { "Content-Type": "image/png" },
    })),
    inspect: jest.fn(async () => stored),
    read: jest.fn(async () => over.body ?? png),
    putPublic: jest.fn(async (_key: string, _body: Buffer, _type: string) => undefined),
    remove: jest.fn(async (_key: string) => undefined),
  };
  const env = {
    UPLOAD_MAX_BYTES: MAX,
    UPLOAD_PRESIGN_TTL_SECONDS: 300,
    PUBLIC_ASSET_BASE_URL: BASE,
  } as Env;
  const service = new BannerService(
    env,
    repo as unknown as OrganizerRepository,
    writes as unknown as OrganizerWrites,
    storage as unknown as BannerStorage,
  );
  return { service, repo, writes, storage };
}

const presignDto = { content_type: "image/png", size_bytes: 500 };

describe("S-605 BannerService.presign", () => {
  it("issues a staging upload_id with a bounded expiry under the Idempotency-Key", async () => {
    const { service, storage, writes } = setup();
    const before = Date.now();
    const result = (await service.presign(TENANT, EVENT, presignDto, IDEMPOTENCY)) as Record<
      string,
      string | number
    >;
    expect(result.upload_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).toMatchObject({ method: "PUT", max_bytes: MAX });
    expect(Date.parse(String(result.expires_at)) - before).toBeGreaterThan(299_000);
    expect(Date.parse(String(result.expires_at)) - before).toBeLessThan(302_000);
    expect(storage.presignUpload).toHaveBeenCalledWith(
      `staging/events/${EVENT}/${result.upload_id}`,
      "image/png",
      500,
    );
    expect(writes.run).toHaveBeenCalledWith(
      TENANT,
      IDEMPOTENCY,
      `POST events/${EVENT}/banner/presign`,
      presignDto,
      expect.any(Function),
    );
  });

  it("hides events of another tenant as 404 and never signs", async () => {
    const { service, storage } = setup();
    await rejects(
      service.presign("9d9d9d9d-0000-4000-8000-000000000009", EVENT, presignDto, IDEMPOTENCY),
      404,
      "NOT_FOUND",
    );
    expect(storage.presignUpload).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "APPROVED", "PUBLISHED", "ENDED", "CANCELLED"])(
    "refuses to sign when the event is %s",
    async (status) => {
      const { service, storage } = setup({ status });
      await rejects(
        service.presign(TENANT, EVENT, presignDto, IDEMPOTENCY),
        409,
        "EVENT_NOT_EDITABLE",
      );
      expect(storage.presignUpload).not.toHaveBeenCalled();
    },
  );

  it("allows REJECTED events, which are editable again", async () => {
    const { service } = setup({ status: "REJECTED" });
    await expect(
      service.presign(TENANT, EVENT, { ...presignDto, content_type: "image/webp" }, IDEMPOTENCY),
    ).resolves.toMatchObject({ method: "PUT" });
  });

  it("rejects unsupported types and oversize files before touching storage", async () => {
    const { service, storage } = setup();
    await rejects(
      service.presign(TENANT, EVENT, { content_type: "image/gif", size_bytes: 10 }, IDEMPOTENCY),
      400,
      "INVALID_IMAGE_TYPE",
    );
    await rejects(
      service.presign(
        TENANT,
        EVENT,
        { content_type: "image/png", size_bytes: MAX + 1 },
        IDEMPOTENCY,
      ),
      400,
      "IMAGE_TOO_LARGE",
    );
    expect(storage.presignUpload).not.toHaveBeenCalled();
    await expect(
      service.presign(TENANT, EVENT, { content_type: "image/png", size_bytes: MAX }, IDEMPOTENCY),
    ).resolves.toBeDefined();
  });
});

describe("S-605 BannerService.confirm", () => {
  const dto = { upload_id: UPLOAD, version: 3 };

  it("publishes banner + thumbnail, sets banner_key and drops staging", async () => {
    const { service, repo, writes, storage } = setup();
    const response = (await service.confirm(TENANT, EVENT, dto, IDEMPOTENCY)) as {
      banner_key: string;
      banner_url: string;
      thumbnail_url: string;
      version: number;
    };
    expect(response.banner_key).toMatch(
      new RegExp(`^public/events/${EVENT}/[0-9a-f-]{36}\\.webp$`),
    );
    expect(response.banner_url).toBe(`${BASE}/${response.banner_key}`);
    expect(response.thumbnail_url).toBe(
      `${BASE}/${response.banner_key.replace(/\.webp$/, "_thumb.webp")}`,
    );
    expect(response.version).toBe(4);
    expect(storage.inspect).toHaveBeenCalledWith(STAGING);
    expect(storage.putPublic).toHaveBeenCalledTimes(2);
    for (const [, body, type] of storage.putPublic.mock.calls) {
      expect(type).toBe("image/webp");
      expect((await sharp(body).metadata()).format).toBe("webp");
    }
    expect(repo.updateEvent).toHaveBeenCalledWith({}, TENANT, EVENT, {
      banner_key: response.banner_key,
      version: 3,
    });
    expect(storage.remove).toHaveBeenCalledWith(STAGING);
    expect(writes.run).toHaveBeenCalledWith(
      TENANT,
      IDEMPOTENCY,
      `POST events/${EVENT}/banner/confirm`,
      { upload_id: UPLOAD, version: 3 },
      expect.any(Function),
    );
  });

  it("returns 404 for another tenant before probing storage", async () => {
    const { service, storage } = setup();
    await rejects(
      service.confirm("9d9d9d9d-0000-4000-8000-000000000009", EVENT, dto, IDEMPOTENCY),
      404,
      "NOT_FOUND",
    );
    expect(storage.inspect).not.toHaveBeenCalled();
  });

  it("returns 404 UPLOAD_NOT_FOUND when nothing is staged or it was already confirmed", async () => {
    const { service, repo, storage } = setup({ stored: null });
    await rejects(service.confirm(TENANT, EVENT, dto, IDEMPOTENCY), 404, "UPLOAD_NOT_FOUND");
    expect(repo.updateEvent).not.toHaveBeenCalled();
    expect(storage.putPublic).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  const bytes12 = Buffer.alloc(12);
  it.each([
    ["too large", { size: MAX + 1, contentType: "image/png", head: bytes12 }, "IMAGE_TOO_LARGE"],
    [
      "empty",
      { size: 0, contentType: "image/png", head: Buffer.alloc(0) },
      "INVALID_IMAGE_CONTENT",
    ],
    [
      "an unsupported type",
      { size: 100, contentType: "image/gif", head: bytes12 },
      "INVALID_IMAGE_TYPE",
    ],
    ["without a type", { size: 100, contentType: undefined, head: bytes12 }, "INVALID_IMAGE_TYPE"],
    [
      "fake magic bytes",
      { size: 100, contentType: "image/png", head: Buffer.from("<html><script>") },
      "INVALID_IMAGE_CONTENT",
    ],
    [
      "png declared but jpeg bytes",
      {
        size: 100,
        contentType: "image/png",
        head: Buffer.from([255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 0, 0]),
      },
      "INVALID_IMAGE_CONTENT",
    ],
  ])("rejects an object that is %s, deletes it and never publishes", async (_n, stored, code) => {
    const { service, repo, storage } = setup({ stored });
    await rejects(service.confirm(TENANT, EVENT, dto, IDEMPOTENCY), 400, code);
    expect(storage.remove).toHaveBeenCalledWith(STAGING);
    expect(storage.read).not.toHaveBeenCalled();
    expect(storage.putPublic).not.toHaveBeenCalled();
    expect(repo.updateEvent).not.toHaveBeenCalled();
  });

  it("accepts a content-type carrying parameters and mixed case", async () => {
    const { service } = setup({
      stored: {
        size: png.length,
        contentType: "Image/PNG; charset=binary",
        head: png.subarray(0, 12),
      },
    });
    await expect(service.confirm(TENANT, EVENT, dto, IDEMPOTENCY)).resolves.toBeDefined();
  });

  it("rejects bytes that pass the sniff but do not decode, , deletes staging and never publishes", async () => {
    const { service, storage } = setup({
      body: Buffer.concat([png.subarray(0, 12), Buffer.alloc(50)]),
    });
    await rejects(service.confirm(TENANT, EVENT, dto, IDEMPOTENCY), 400, "INVALID_IMAGE_CONTENT");
    expect(storage.putPublic).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith(STAGING);
  });

  it("removes published copies and keeps staging when the version check fails", async () => {
    const { service, repo, storage } = setup();
    repo.updateEvent.mockRejectedValueOnce(
      new ProblemException("VERSION_CONFLICT", 409, "Phiên bản tài nguyên đã thay đổi"),
    );
    await rejects(service.confirm(TENANT, EVENT, dto, IDEMPOTENCY), 409, "VERSION_CONFLICT");
    const published = storage.putPublic.mock.calls.map(([key]) => key);
    expect(published).toHaveLength(2);
    for (const key of published) expect(storage.remove).toHaveBeenCalledWith(key);
    expect(storage.remove).not.toHaveBeenCalledWith(STAGING);
  });

  it("removes published copies when the second upload to storage fails", async () => {
    const { service, repo, storage } = setup();
    storage.putPublic
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ProblemException("STORAGE_UNAVAILABLE", 503, "down"));
    await rejects(service.confirm(TENANT, EVENT, dto, IDEMPOTENCY), 503, "STORAGE_UNAVAILABLE");
    expect(repo.updateEvent).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledTimes(2);
  });
});
