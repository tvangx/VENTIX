import { ProblemException } from "@ticketing/common";
import type { Env } from "../../config/env.schema";
import type { OrganizerRepository } from "../organizer/organizer.repository";
import type { OrganizerWrites } from "../organizer/organizer-writes";
import { BannerService } from "./banner.service";
import type { BannerStorage, StoredBanner } from "./banner.storage";

const TENANT = "5a1f0c3e-7b2d-4c8e-9f10-a1b2c3d4e5f6";
const EVENT = "0b9b7a3e-4c1d-4e2f-9a6b-1d2c3e4f5a6b";
const FILE = "7f1d6c2a-3b4e-4a5f-8c9d-0e1f2a3b4c5d";
const KEY = `events/${EVENT}/${FILE}.png`;
const IDEMPOTENCY = "c3f1a2b4-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const MAX = 1000;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

function rejects(promise: Promise<unknown>, status: number, code: string) {
  return expect(promise).rejects.toMatchObject({
    constructor: ProblemException,
    status,
    code,
  });
}

function setup(over: { status?: string; stored?: StoredBanner | null; owner?: boolean } = {}) {
  const event = { id: EVENT, organizerId: TENANT, status: over.status ?? "DRAFT", version: 3 };
  const updated = {
    ...event,
    venueId: "a1b2c3d4-0000-4000-8000-000000000001",
    title: "t",
    description: "d",
    bannerKey: KEY,
    version: 4,
    createdAt: new Date("2030-01-01T00:00:00Z"),
    updatedAt: new Date("2030-01-01T00:00:00Z"),
    startAt: new Date("2030-02-01T00:00:00Z"),
    endAt: new Date("2030-02-01T02:00:00Z"),
  };
  const repo = {
    event: jest.fn(async (tenant: string) =>
      over.owner === false || tenant !== TENANT ? null : event,
    ),
    updateEvent: jest.fn(async () => updated),
  };
  const writes = {
    run: jest.fn(
      async (
        _tenant: string,
        _key: string | undefined,
        _operation: string,
        _payload: object,
        write: (tx: object) => Promise<object>,
      ) => write({}),
    ),
  };
  const stored =
    over.stored === undefined ? { size: 100, contentType: "image/png", head: PNG } : over.stored;
  const storage = {
    presignUpload: jest.fn(async (_key: string, _type: string, _size: number) => ({
      url: "http://minio.test/event-banners/signed",
      headers: { "Content-Type": "image/png" },
    })),
    inspect: jest.fn(async () => stored),
    remove: jest.fn(async () => undefined),
  };
  const env = { BANNER_MAX_BYTES: MAX, BANNER_PRESIGN_TTL_SECONDS: 300 } as Env;
  const service = new BannerService(
    env,
    repo as unknown as OrganizerRepository,
    writes as unknown as OrganizerWrites,
    storage as unknown as BannerStorage,
  );
  return { service, repo, writes, storage };
}

describe("S-201b BannerService.presign", () => {
  it("issues a server-generated key under the event with a bounded expiry", async () => {
    const { service, storage } = setup();
    const before = Date.now();
    const result = await service.presign(TENANT, EVENT, {
      content_type: "image/png",
      size_bytes: 500,
    });
    expect(result.object_key).toMatch(new RegExp(`^events/${EVENT}/[0-9a-f-]{36}\\.png$`));
    expect(result.method).toBe("PUT");
    expect(result.max_bytes).toBe(MAX);
    expect(Date.parse(result.expires_at) - before).toBeGreaterThan(299_000);
    expect(Date.parse(result.expires_at) - before).toBeLessThan(302_000);
    expect(storage.presignUpload).toHaveBeenCalledWith(result.object_key, "image/png", 500);
  });

  it("hides events of another tenant as 404 and never signs", async () => {
    const { service, storage } = setup();
    await rejects(
      service.presign("9d9d9d9d-0000-4000-8000-000000000009", EVENT, {
        content_type: "image/png",
        size_bytes: 10,
      }),
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
        service.presign(TENANT, EVENT, { content_type: "image/png", size_bytes: 10 }),
        409,
        "EVENT_NOT_EDITABLE",
      );
      expect(storage.presignUpload).not.toHaveBeenCalled();
    },
  );

  it("allows REJECTED events, which are editable again", async () => {
    const { service } = setup({ status: "REJECTED" });
    await expect(
      service.presign(TENANT, EVENT, { content_type: "image/webp", size_bytes: 10 }),
    ).resolves.toMatchObject({ method: "PUT" });
  });

  it("rejects unsupported types and oversize files before touching storage", async () => {
    const { service, storage } = setup();
    await rejects(
      service.presign(TENANT, EVENT, { content_type: "image/gif", size_bytes: 10 }),
      400,
      "INVALID_BANNER_TYPE",
    );
    await rejects(
      service.presign(TENANT, EVENT, { content_type: "image/png", size_bytes: MAX + 1 }),
      400,
      "BANNER_TOO_LARGE",
    );
    expect(storage.presignUpload).not.toHaveBeenCalled();
    await expect(
      service.presign(TENANT, EVENT, { content_type: "image/png", size_bytes: MAX }),
    ).resolves.toBeDefined();
  });
});

describe("S-201b BannerService.confirm", () => {
  const dto = { object_key: KEY, version: 3 };

  it("verifies the stored object then sets banner_key with the caller's version", async () => {
    const { service, repo, writes, storage } = setup();
    const response = await service.confirm(TENANT, EVENT, dto, IDEMPOTENCY);
    expect(response).toMatchObject({ banner_key: KEY, version: 4 });
    expect(storage.inspect).toHaveBeenCalledWith(KEY);
    expect(repo.updateEvent).toHaveBeenCalledWith({}, TENANT, EVENT, {
      banner_key: KEY,
      version: 3,
    });
    // Cùng khóa + cùng payload → OrganizerWrites phát lại; khác payload → 409 (kiểm ở test int).
    expect(writes.run).toHaveBeenCalledWith(
      TENANT,
      IDEMPOTENCY,
      `POST events/${EVENT}/banner/confirm`,
      { object_key: KEY, version: 3 },
      expect.any(Function),
    );
  });

  it.each([
    ["another event", `events/1c0c8b4f-5d2e-4f30-8b7c-2e3d4f5a6b7c/${FILE}.png`],
    ["a seed key", "seed/banners/a.jpg"],
    ["path traversal", `events/${EVENT}/../x/${FILE}.png`],
    ["an unknown extension", `events/${EVENT}/${FILE}.gif`],
  ])("rejects a key of %s without touching storage", async (_name, object_key) => {
    const { service, storage, repo } = setup();
    await rejects(
      service.confirm(TENANT, EVENT, { object_key, version: 3 }, IDEMPOTENCY),
      400,
      "INVALID_BANNER_KEY",
    );
    expect(storage.inspect).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(repo.updateEvent).not.toHaveBeenCalled();
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

  it("returns 409 when nothing was uploaded and does not write", async () => {
    const { service, repo, storage } = setup({ stored: null });
    await rejects(service.confirm(TENANT, EVENT, dto, IDEMPOTENCY), 409, "BANNER_NOT_UPLOADED");
    expect(repo.updateEvent).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it.each([
    ["too large", { size: MAX + 1, contentType: "image/png", head: PNG }, "BANNER_TOO_LARGE"],
    [
      "empty",
      { size: 0, contentType: "image/png", head: Buffer.alloc(0) },
      "INVALID_BANNER_CONTENT",
    ],
    [
      "content-type mismatch",
      { size: 100, contentType: "image/jpeg", head: PNG },
      "BANNER_TYPE_MISMATCH",
    ],
    [
      "missing content-type",
      { size: 100, contentType: undefined, head: PNG },
      "BANNER_TYPE_MISMATCH",
    ],
    [
      "fake magic bytes",
      { size: 100, contentType: "image/png", head: Buffer.from("<html><script>") },
      "INVALID_BANNER_CONTENT",
    ],
  ])("rejects an object that is %s, deletes it and never writes", async (_name, stored, code) => {
    const { service, repo, storage } = setup({ stored });
    await rejects(service.confirm(TENANT, EVENT, dto, IDEMPOTENCY), 400, code);
    expect(storage.remove).toHaveBeenCalledWith(KEY);
    expect(repo.updateEvent).not.toHaveBeenCalled();
  });

  it("accepts a content-type carrying parameters and mixed case", async () => {
    const { service } = setup({
      stored: { size: 100, contentType: "Image/PNG; charset=binary", head: PNG },
    });
    await expect(service.confirm(TENANT, EVENT, dto, IDEMPOTENCY)).resolves.toBeDefined();
  });

  it("propagates version conflicts from the repository", async () => {
    const { service, repo } = setup();
    repo.updateEvent.mockRejectedValueOnce(
      new ProblemException("VERSION_CONFLICT", 409, "Phiên bản tài nguyên đã thay đổi"),
    );
    await rejects(service.confirm(TENANT, EVENT, dto, IDEMPOTENCY), 409, "VERSION_CONFLICT");
  });
});
