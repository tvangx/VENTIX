import { http, HttpResponse, type JsonBodyType } from "msw";
import { SERVICE_PREFIX, type EventPaths } from "@/lib/api";
import { BANNER_MAX_BYTES, BANNER_TYPES } from "@/lib/organizer/banner-upload";
import { parseAnyLayout, type SeatMapLayout } from "@/lib/seatmap/layout";
import { state } from "../db";
import type {
  MockBannerUpload,
  MockOrgEvent,
  MockSalePhase,
  MockSeatMap,
  MockTicketClass,
  MockVenue,
} from "../organizer-store";
import { authenticate, idempotent, mockService, noContent, problem, UUID_RE } from "./typed";

// API organizer của event-service (S-201/S-202/S-203), bám services/event/src/modules/organizer:
// - token phải đã chọn tenant và có role ORGANIZER; dữ liệu lọc theo organizer trong token;
// - ghi cần Idempotency-Key (UUID), sửa/xóa cần `version` khớp, chỉ sửa khi DRAFT/REJECTED;
// - khoảng thời gian bắt đầu < kết thúc; tên hạng vé không trùng trong sự kiện;
// - seat map: hàng ghế chỉ dùng hạng SEATED, khu đứng (`ga_areas`, issue #98) chỉ dùng hạng GA của
//   chính sự kiện; tên zone/khu đứng không trùng; mỗi lần tạo là một version mới.

const api = mockService<EventPaths>(SERVICE_PREFIX.event);
const org = () => state.organizer;
const now = () => new Date().toISOString();

type Guard = { ok: true; orgId: string } | { ok: false; response: HttpResponse<never> };

function tenant(request: Request): Guard {
  const auth = authenticate(request);
  if (!auth.ok) return auth;
  const orgId = auth.grant.organizerId;
  if (!orgId) {
    return {
      ok: false,
      response: problem(403, "TENANT_MISMATCH", "Thiếu thông tin Organizer hợp lệ"),
    };
  }
  if (!auth.roles.includes("ORGANIZER")) {
    return { ok: false, response: problem(403, "FORBIDDEN", "Thiếu quyền ORGANIZER") };
  }
  return { ok: true, orgId };
}

function idemKey(request: Request): string | null {
  const key = request.headers.get("Idempotency-Key") ?? "";
  return UUID_RE.test(key) ? key.toLowerCase() : null;
}

const badKey = () => problem(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key phải là UUID");
const notFound = () => problem(404, "NOT_FOUND", "Không tìm thấy tài nguyên trong tenant");
const versionConflict = () => problem(409, "VERSION_CONFLICT", "Phiên bản tài nguyên đã thay đổi");
const notEditable = () =>
  problem(409, "EVENT_NOT_EDITABLE", "Chỉ sửa sự kiện ở DRAFT hoặc REJECTED");
const badRange = () =>
  problem(400, "INVALID_TIME_RANGE", "Thời điểm kết thúc phải sau thời điểm bắt đầu");
const invalid = (detail: string) => problem(400, "VALIDATION_FAILED", detail);
const emptyPatch = () => problem(400, "EMPTY_PATCH", "Cần ít nhất một trường thay đổi");

// Kho ảnh giả thay cho MinIO: URL PUT có chữ ký và gốc URL công khai (PUBLIC_ASSET_BASE_URL).
const STAGING_PREFIX = "/mock-storage/staging/";
const PUBLIC_ASSET_PREFIX = "/mock-assets/";

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const isTime = (v: unknown): v is string => typeof v === "string" && TIMESTAMP_RE.test(v);
const isText = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isInt = (v: unknown, min: number, max = 2147483647): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const iso = (v: string) => new Date(v).toISOString();

/** Phản hồi JSON dùng chung cho mọi handler (kiểu body đã kiểm ở chỗ tạo dữ liệu). */
function json(body: unknown, status: number): HttpResponse<never> {
  const response = HttpResponse.json(body as JsonBodyType, { status });
  return response as unknown as HttpResponse<never>;
}

/** Ghi idempotent: cùng key + cùng nội dung → trả lại kết quả cũ; khác nội dung → 422. */
function withIdempotency<T>(
  orgId: string,
  key: string,
  operation: string,
  payload: unknown,
  status: number,
  write: () => T | HttpResponse<never>,
): HttpResponse<never> {
  const idem = idempotent<T>(`event:organizer:${orgId}`, key, [operation, payload]);
  if (idem.conflict) {
    return problem(422, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key đã dùng cho nội dung khác");
  }
  if (idem.replay) {
    return json(idem.replay, status);
  }
  const result = write();
  if (result instanceof HttpResponse) return result;
  idem.save(result);
  return json(result, status);
}

function page<T extends { id: string }>(items: T[], url: string) {
  const cursor = new URL(url).searchParams.get("cursor");
  const limitRaw = Number(new URL(url).searchParams.get("limit") ?? 20);
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 100 ? limitRaw : 20;
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const rest = cursor ? sorted.filter((item) => item.id > cursor) : sorted;
  const pageItems = rest.slice(0, limit);
  return {
    items: pageItems,
    next_cursor: rest.length > limit ? (pageItems[pageItems.length - 1]?.id ?? null) : null,
  };
}

function ownEvent(orgId: string, id: string): MockOrgEvent | undefined {
  const event = org().events.get(id);
  return event?.organizer_id === orgId ? event : undefined;
}

/** Sự kiện để sửa bảng con: phải thuộc tenant và còn ở DRAFT/REJECTED. */
function editableEvent(orgId: string, id: string): MockOrgEvent | HttpResponse<never> {
  const event = ownEvent(orgId, id);
  if (!event) return notFound();
  if (event.status !== "DRAFT" && event.status !== "REJECTED") return notEditable();
  return event;
}

function bump<T extends { version: number; updated_at: string }>(row: T, changes: Partial<T>): T {
  return { ...row, ...changes, version: row.version + 1, updated_at: now() };
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const organizerHandlers = [
  // ---------- Venue ----------
  api.get("/v1/organizer/venues", ({ request }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const items = [...org().venues.values()].filter((v) => v.organizer_id === t.orgId);
    return HttpResponse.json(page(items, request.url));
  }),

  api.post("/v1/organizer/venues", async ({ request }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const key = idemKey(request);
    if (!key) return badKey();
    const body = await request.json();
    if (!isText(body.name, 255) || !isText(body.address, 512) || !isInt(body.capacity, 1)) {
      return invalid("Tên, địa chỉ hoặc sức chứa không hợp lệ");
    }
    return withIdempotency<MockVenue>(t.orgId, key, "venue.create", body, 201, () => {
      const venue: MockVenue = {
        id: crypto.randomUUID(),
        organizer_id: t.orgId,
        name: body.name.trim(),
        address: body.address.trim(),
        capacity: body.capacity,
        version: 0,
        created_at: now(),
        updated_at: now(),
      };
      org().venues.set(venue.id, venue);
      return venue;
    });
  }),

  // ---------- Event ----------
  api.get("/v1/organizer/events", ({ request }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const items = [...org().events.values()].filter((e) => e.organizer_id === t.orgId);
    return HttpResponse.json(page(items, request.url));
  }),

  api.post("/v1/organizer/events", async ({ request }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const key = idemKey(request);
    if (!key) return badKey();
    const body = await request.json();
    if (
      !isText(body.title, 255) ||
      typeof body.description !== "string" ||
      body.description.length > 10000 ||
      !isTime(body.start_at) ||
      !isTime(body.end_at)
    ) {
      return invalid("Thông tin sự kiện không hợp lệ");
    }
    if (Date.parse(body.start_at) >= Date.parse(body.end_at)) return badRange();
    const venue = org().venues.get(body.venue_id);
    if (!venue || venue.organizer_id !== t.orgId) return notFound();
    return withIdempotency<MockOrgEvent>(t.orgId, key, "event.create", body, 201, () => {
      const event: MockOrgEvent = {
        id: crypto.randomUUID(),
        organizer_id: t.orgId,
        status: "DRAFT",
        venue_id: venue.id,
        title: body.title.trim(),
        description: body.description,
        banner_key: body.banner_key ?? null,
        start_at: iso(body.start_at),
        end_at: iso(body.end_at),
        version: 0,
        created_at: now(),
        updated_at: now(),
      };
      org().events.set(event.id, event);
      return event;
    });
  }),

  api.get("/v1/organizer/events/{id}", ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const event = ownEvent(t.orgId, params.id);
    return event ? HttpResponse.json(event) : notFound();
  }),

  api.patch("/v1/organizer/events/{id}", async ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const key = idemKey(request);
    if (!key) return badKey();
    const body = await request.json();
    const { version, ...changes } = body;
    if (!isInt(version, 0)) return invalid("Thiếu version");
    if (Object.values(changes).every((v) => v === undefined)) return emptyPatch();
    if (
      (changes.title !== undefined && !isText(changes.title, 255)) ||
      (changes.description !== undefined &&
        (typeof changes.description !== "string" || changes.description.length > 10000)) ||
      (changes.banner_key !== undefined &&
        changes.banner_key !== null &&
        !isText(changes.banner_key, 512)) ||
      (changes.start_at !== undefined && !isTime(changes.start_at)) ||
      (changes.end_at !== undefined && !isTime(changes.end_at))
    ) {
      return invalid("Thông tin sự kiện không hợp lệ");
    }
    return withIdempotency<MockOrgEvent | HttpResponse<never>>(
      t.orgId,
      key,
      `event.update:${params.id}`,
      body,
      200,
      () => {
        const current = ownEvent(t.orgId, params.id);
        if (!current) return notFound();
        if (current.status !== "DRAFT" && current.status !== "REJECTED") return notEditable();
        if (current.version !== version) return versionConflict();
        if (changes.venue_id !== undefined) {
          const venue = org().venues.get(changes.venue_id);
          if (!venue || venue.organizer_id !== t.orgId) return notFound();
        }
        const start = changes.start_at ? iso(changes.start_at) : current.start_at;
        const end = changes.end_at ? iso(changes.end_at) : current.end_at;
        if (Date.parse(start) >= Date.parse(end)) return badRange();
        const next = bump(current, {
          ...defined(changes),
          start_at: start,
          end_at: end,
        } as Partial<MockOrgEvent>);
        org().events.set(next.id, next);
        return next;
      },
    );
  }),

  api.post("/v1/organizer/events/{id}/submit", async ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const key = idemKey(request);
    if (!key) return badKey();
    const body = await request.json();
    if (!isInt(body.version, 0)) return invalid("Thiếu version");
    return withIdempotency<MockOrgEvent | HttpResponse<never>>(
      t.orgId,
      key,
      `event.submit:${params.id}`,
      body,
      200,
      () => {
        const current = ownEvent(t.orgId, params.id);
        if (!current) return notFound();
        if (current.version !== body.version) return versionConflict();
        if (current.status !== "DRAFT" && current.status !== "REJECTED") {
          return problem(
            409,
            "EVENT_TRANSITION_NOT_ALLOWED",
            "Trạng thái sự kiện không cho phép thao tác",
          );
        }
        const next = bump(current, { status: "PENDING" });
        org().events.set(next.id, next);
        return next;
      },
    );
  }),

  // ---------- Hạng vé ----------
  api.get("/v1/organizer/events/{eventId}/ticket-classes", ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    if (!ownEvent(t.orgId, params.eventId)) return notFound();
    const items = [...org().ticketClasses.values()].filter((c) => c.event_id === params.eventId);
    return HttpResponse.json(page(items, request.url));
  }),

  api.post("/v1/organizer/events/{eventId}/ticket-classes", async ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const key = idemKey(request);
    if (!key) return badKey();
    const body = await request.json();
    if (
      !isText(body.name, 128) ||
      !isInt(body.price_vnd, 0, Number.MAX_SAFE_INTEGER) ||
      !isInt(body.capacity, 1) ||
      (body.kind !== "GA" && body.kind !== "SEATED")
    ) {
      return invalid("Hạng vé không hợp lệ");
    }
    return withIdempotency<MockTicketClass | HttpResponse<never>>(
      t.orgId,
      key,
      `class.create:${params.eventId}`,
      body,
      201,
      () => {
        const event = editableEvent(t.orgId, params.eventId);
        if (event instanceof HttpResponse) return event;
        const name = body.name.trim();
        const duplicate = [...org().ticketClasses.values()].some(
          (c) => c.event_id === event.id && c.name === name,
        );
        if (duplicate) return problem(409, "RESOURCE_CONFLICT", "Tài nguyên trùng lặp");
        const row: MockTicketClass = {
          id: crypto.randomUUID(),
          event_id: event.id,
          name,
          price_vnd: body.price_vnd,
          capacity: body.capacity,
          kind: body.kind,
          version: 0,
          created_at: now(),
          updated_at: now(),
        };
        org().ticketClasses.set(row.id, row);
        return row;
      },
    );
  }),

  api.patch("/v1/organizer/events/{eventId}/ticket-classes/{id}", async ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const key = idemKey(request);
    if (!key) return badKey();
    const body = await request.json();
    const { version, ...changes } = body;
    if (!isInt(version, 0)) return invalid("Thiếu version");
    if (Object.values(changes).every((v) => v === undefined)) return emptyPatch();
    if (
      (changes.name !== undefined && !isText(changes.name, 128)) ||
      (changes.price_vnd !== undefined && !isInt(changes.price_vnd, 0, Number.MAX_SAFE_INTEGER)) ||
      (changes.capacity !== undefined && !isInt(changes.capacity, 1)) ||
      (changes.kind !== undefined && changes.kind !== "GA" && changes.kind !== "SEATED")
    ) {
      return invalid("Hạng vé không hợp lệ");
    }
    return withIdempotency<MockTicketClass | HttpResponse<never>>(
      t.orgId,
      key,
      `class.update:${params.id}`,
      body,
      200,
      () => {
        const event = editableEvent(t.orgId, params.eventId);
        if (event instanceof HttpResponse) return event;
        const current = org().ticketClasses.get(params.id);
        if (!current || current.event_id !== event.id) return notFound();
        if (current.version !== version) return versionConflict();
        const name = changes.name?.trim();
        if (
          name !== undefined &&
          [...org().ticketClasses.values()].some(
            (c) => c.event_id === event.id && c.id !== current.id && c.name === name,
          )
        ) {
          return problem(409, "RESOURCE_CONFLICT", "Tài nguyên trùng lặp");
        }
        const next = bump(current, { ...defined(changes), ...(name ? { name } : {}) });
        org().ticketClasses.set(next.id, next);
        return next;
      },
    );
  }),

  api.delete("/v1/organizer/events/{eventId}/ticket-classes/{id}", ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const key = idemKey(request);
    if (!key) return badKey();
    const version = Number(new URL(request.url).searchParams.get("version"));
    if (!isInt(version, 0)) return invalid("Thiếu version");
    const event = editableEvent(t.orgId, params.eventId);
    if (event instanceof HttpResponse) return event;
    const current = org().ticketClasses.get(params.id);
    if (!current || current.event_id !== event.id) return notFound();
    if (current.version !== version) return versionConflict();
    // Ghế của seat map tham chiếu hạng vé (FK): như P2003 của event-service. Khu đứng chỉ nằm
    // trong JSON layout nên không chặn xóa (giống server).
    const inUse = [...org().seatMaps.values()].some(
      (map) => map.event_id === event.id && seatClassIds(map.layout).has(current.id),
    );
    if (inUse) {
      return problem(
        409,
        "RESOURCE_IN_USE",
        "Quan hệ tài nguyên đang được sử dụng hoặc đã thay đổi",
      );
    }
    org().ticketClasses.delete(current.id);
    return noContent();
  }),

  // ---------- Đợt mở bán ----------
  api.get("/v1/organizer/events/{eventId}/sale-phases", ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    if (!ownEvent(t.orgId, params.eventId)) return notFound();
    const items = [...org().salePhases.values()].filter((p) => p.event_id === params.eventId);
    return HttpResponse.json(page(items, request.url));
  }),

  api.post("/v1/organizer/events/{eventId}/sale-phases", async ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const key = idemKey(request);
    if (!key) return badKey();
    const body = await request.json();
    if (
      !isTime(body.starts_at) ||
      !isTime(body.ends_at) ||
      !isInt(body.admit_rate, 1) ||
      !isInt(body.per_user_limit, 1)
    ) {
      return invalid("Đợt mở bán không hợp lệ");
    }
    if (Date.parse(body.starts_at) >= Date.parse(body.ends_at)) return badRange();
    return withIdempotency<MockSalePhase | HttpResponse<never>>(
      t.orgId,
      key,
      `phase.create:${params.eventId}`,
      body,
      201,
      () => {
        const event = editableEvent(t.orgId, params.eventId);
        if (event instanceof HttpResponse) return event;
        const row: MockSalePhase = {
          id: crypto.randomUUID(),
          event_id: event.id,
          starts_at: iso(body.starts_at),
          ends_at: iso(body.ends_at),
          queue_enabled: body.queue_enabled ?? false,
          admit_rate: body.admit_rate,
          per_user_limit: body.per_user_limit,
          require_kyc: body.require_kyc ?? false,
          version: 0,
          created_at: now(),
          updated_at: now(),
        };
        org().salePhases.set(row.id, row);
        return row;
      },
    );
  }),

  api.patch("/v1/organizer/events/{eventId}/sale-phases/{id}", async ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const key = idemKey(request);
    if (!key) return badKey();
    const body = await request.json();
    const { version, ...changes } = body;
    if (!isInt(version, 0)) return invalid("Thiếu version");
    if (Object.values(changes).every((v) => v === undefined)) return emptyPatch();
    if (
      (changes.starts_at !== undefined && !isTime(changes.starts_at)) ||
      (changes.ends_at !== undefined && !isTime(changes.ends_at)) ||
      (changes.admit_rate !== undefined && !isInt(changes.admit_rate, 1)) ||
      (changes.per_user_limit !== undefined && !isInt(changes.per_user_limit, 1))
    ) {
      return invalid("Đợt mở bán không hợp lệ");
    }
    return withIdempotency<MockSalePhase | HttpResponse<never>>(
      t.orgId,
      key,
      `phase.update:${params.id}`,
      body,
      200,
      () => {
        const event = editableEvent(t.orgId, params.eventId);
        if (event instanceof HttpResponse) return event;
        const current = org().salePhases.get(params.id);
        if (!current || current.event_id !== event.id) return notFound();
        if (current.version !== version) return versionConflict();
        const start = changes.starts_at ? iso(changes.starts_at) : current.starts_at;
        const end = changes.ends_at ? iso(changes.ends_at) : current.ends_at;
        if (Date.parse(start) >= Date.parse(end)) return badRange();
        const next = bump(current, { ...defined(changes), starts_at: start, ends_at: end });
        org().salePhases.set(next.id, next);
        return next;
      },
    );
  }),

  api.delete("/v1/organizer/events/{eventId}/sale-phases/{id}", ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const key = idemKey(request);
    if (!key) return badKey();
    const version = Number(new URL(request.url).searchParams.get("version"));
    if (!isInt(version, 0)) return invalid("Thiếu version");
    const event = editableEvent(t.orgId, params.eventId);
    if (event instanceof HttpResponse) return event;
    const current = org().salePhases.get(params.id);
    if (!current || current.event_id !== event.id) return notFound();
    if (current.version !== version) return versionConflict();
    org().salePhases.delete(current.id);
    return noContent();
  }),

  // ---------- Seat map ----------
  api.get("/v1/organizer/events/{eventId}/seat-maps", ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    if (!ownEvent(t.orgId, params.eventId)) return notFound();
    const items = [...org().seatMaps.values()].filter((m) => m.event_id === params.eventId);
    return HttpResponse.json(page(items, request.url));
  }),

  api.post("/v1/organizer/events/{eventId}/seat-maps", async ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const key = idemKey(request);
    if (!key) return badKey();
    const body = await request.json();
    const layout = parseAnyLayout(body.layout);
    if (!layout) {
      return problem(400, "INVALID_SEAT_MAP", "Layout seat map không hợp lệ");
    }
    const duplicate = layoutDuplicate(layout);
    if (duplicate) return duplicate;
    return withIdempotency<MockSeatMap | HttpResponse<never>>(
      t.orgId,
      key,
      `seatmap.create:${params.eventId}`,
      body,
      201,
      () => {
        const event = editableEvent(t.orgId, params.eventId);
        if (event instanceof HttpResponse) return event;
        const ids = seatClassIds(layout);
        const valid = [...ids].every((id) => {
          const c = org().ticketClasses.get(id);
          return c?.event_id === event.id && c.kind === "SEATED";
        });
        if (!valid) {
          return problem(
            400,
            "INVALID_SEAT_CLASS",
            "Hạng vé ghế không thuộc sự kiện hoặc không phải SEATED",
          );
        }
        const validGa = (layout.ga_areas ?? []).every((area) => {
          const c = org().ticketClasses.get(area.ticket_class_id);
          return c?.event_id === event.id && c.kind === "GA";
        });
        if (!validGa) {
          return problem(
            400,
            "INVALID_GA_CLASS",
            "Hạng vé của khu đứng không thuộc sự kiện hoặc không phải GA",
          );
        }
        const latest = Math.max(
          0,
          ...[...org().seatMaps.values()]
            .filter((m) => m.event_id === event.id)
            .map((m) => m.version),
        );
        const map: MockSeatMap = {
          id: crypto.randomUUID(),
          event_id: event.id,
          layout,
          published_at: null,
          version: latest + 1,
          created_at: now(),
          updated_at: now(),
        };
        org().seatMaps.set(map.id, map);
        return map;
      },
    );
  }),

  // ---------- Banner (S-201b/S-605) ----------
  // Như services/event/src/modules/banners: presign → PUT vào staging → confirm kiểm magic bytes,
  // ghi `public/events/{eventId}/{uuid}.webp` + `_thumb.webp`, gắn `banner_key`, tăng version.
  // Mock không đổi ảnh sang WebP: object công khai giữ nguyên byte và kiểu gốc.
  api.post("/v1/organizer/events/{eventId}/banner/presign", async ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const key = idemKey(request);
    if (!key) return badKey();
    const body = await request.json();
    const event = editableEvent(t.orgId, params.eventId);
    if (event instanceof HttpResponse) return event;
    if (!(BANNER_TYPES as readonly string[]).includes(body.content_type)) {
      return problem(400, "INVALID_IMAGE_TYPE", "Chỉ nhận ảnh JPEG, PNG hoặc WebP");
    }
    if (!isInt(body.size_bytes, 1, Number.MAX_SAFE_INTEGER)) return invalid("size_bytes sai");
    if (body.size_bytes > BANNER_MAX_BYTES) {
      return problem(400, "IMAGE_TOO_LARGE", `Ảnh tối đa ${BANNER_MAX_BYTES} byte`);
    }
    const origin = new URL(request.url).origin;
    return withIdempotency(t.orgId, key, `event.banner.presign:${event.id}`, body, 201, () => {
      const uploadId = crypto.randomUUID();
      org().bannerStaging.set(uploadId, {
        organizerId: t.orgId,
        eventId: event.id,
        contentType: body.content_type,
        size: body.size_bytes,
        bytes: null,
      });
      return {
        upload_id: uploadId,
        method: "PUT" as const,
        url: `${origin}${STAGING_PREFIX}${uploadId}`,
        headers: { "Content-Type": body.content_type },
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        max_bytes: BANNER_MAX_BYTES,
      };
    });
  }),

  // URL có chữ ký giả: như MinIO, Content-Type và số byte phải đúng như lúc presign.
  http.put(`*${STAGING_PREFIX}:uploadId`, async ({ request, params }) => {
    const upload = org().bannerStaging.get(String(params.uploadId));
    if (!upload) return new HttpResponse(null, { status: 403 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (
      request.headers.get("Content-Type") !== upload.contentType ||
      bytes.length !== upload.size
    ) {
      return new HttpResponse(null, { status: 403 });
    }
    upload.bytes = bytes;
    return new HttpResponse(null, { status: 200 });
  }),

  api.post("/v1/organizer/events/{eventId}/banner/confirm", async ({ request, params }) => {
    const t = tenant(request);
    if (!t.ok) return t.response;
    const key = idemKey(request);
    if (!key) return badKey();
    const body = await request.json();
    if (!UUID_RE.test(body.upload_id ?? "") || !isInt(body.version, 0)) {
      return invalid("Thiếu upload_id hoặc version");
    }
    // Kiểm tenant trước khi đụng tới kho, như server.
    if (!ownEvent(t.orgId, params.eventId)) return notFound();
    const origin = new URL(request.url).origin;
    const payload = { upload_id: body.upload_id.toLowerCase(), version: body.version };
    return withIdempotency(
      t.orgId,
      key,
      `event.banner.confirm:${params.eventId}`,
      payload,
      200,
      () => {
        const uploadId = payload.upload_id;
        const upload = org().bannerStaging.get(uploadId);
        if (!upload?.bytes || upload.eventId !== params.eventId || upload.organizerId !== t.orgId) {
          return problem(404, "UPLOAD_NOT_FOUND", "Không thấy ảnh tải lên");
        }
        if (!matchesMagicBytes(upload)) {
          org().bannerStaging.delete(uploadId);
          return problem(400, "INVALID_IMAGE_CONTENT", "Nội dung file không đúng định dạng ảnh");
        }
        const current = editableEvent(t.orgId, params.eventId);
        if (current instanceof HttpResponse) return current;
        if (current.version !== payload.version) return versionConflict();
        const base = `public/events/${current.id}/${crypto.randomUUID()}`;
        const keys = { banner: `${base}.webp`, thumbnail: `${base}_thumb.webp` };
        for (const objectKey of [keys.banner, keys.thumbnail]) {
          org().bannerPublic.set(objectKey, {
            contentType: upload.contentType,
            bytes: upload.bytes,
          });
        }
        const next = bump(current, { banner_key: keys.banner });
        org().events.set(next.id, next);
        org().bannerStaging.delete(uploadId);
        return {
          banner_key: keys.banner,
          banner_url: `${origin}${PUBLIC_ASSET_PREFIX}${keys.banner}`,
          thumbnail_url: `${origin}${PUBLIC_ASSET_PREFIX}${keys.thumbnail}`,
          version: next.version,
        };
      },
    );
  }),

  // Thay cho PUBLIC_ASSET_BASE_URL: phục vụ ảnh banner đã confirm để `dev:mock` hiện được ảnh.
  http.get(`*${PUBLIC_ASSET_PREFIX}public/events/:eventId/:file`, ({ params }) => {
    const object = org().bannerPublic.get(`public/events/${params.eventId}/${params.file}`);
    if (!object) return new HttpResponse(null, { status: 404 });
    return new HttpResponse(object.bytes.slice().buffer, {
      headers: { "Content-Type": object.contentType },
    });
  }),
];

function seatClassIds(value: unknown): Set<string> {
  const layout = parseAnyLayout(value);
  return new Set(
    (layout?.zones ?? []).flatMap((z) =>
      z.blocks.flatMap((b) => b.rows.map((r) => r.ticket_class_id)),
    ),
  );
}

/** Kiểm tra trùng như parseSeatMapLayout của event-service (trả 400 trước khi vào transaction). */
function layoutDuplicate(layout: SeatMapLayout): HttpResponse<never> | null {
  const dup = () =>
    problem(400, "DUPLICATE_SEAT_MAP_LABEL", "Tên zone, khu đứng, block hoặc row bị trùng");
  const names = new Set<string>();
  const gaClasses = new Set<string>();
  for (const area of layout.ga_areas ?? []) {
    if (names.has(area.name)) return dup();
    names.add(area.name);
    if (gaClasses.has(area.ticket_class_id)) {
      return problem(400, "DUPLICATE_GA_CLASS", "Mỗi hạng vé GA chỉ gắn với một khu đứng");
    }
    gaClasses.add(area.ticket_class_id);
  }
  for (const zone of layout.zones) {
    if (names.has(zone.name)) return dup();
    names.add(zone.name);
    const blocks = new Set<string>();
    for (const block of zone.blocks) {
      if (blocks.has(block.name)) return dup();
      blocks.add(block.name);
      const rows = new Set<string>();
      for (const row of block.rows) {
        if (rows.has(row.label)) return dup();
        rows.add(row.label);
      }
    }
  }
  return null;
}

/** Byte đầu khớp định dạng khai báo (JPEG/PNG/WebP), như `matchesMagicBytes` của event-service. */
function matchesMagicBytes(upload: MockBannerUpload): boolean {
  const head = upload.bytes ?? new Uint8Array();
  const starts = (sig: number[], at = 0) => sig.every((byte, i) => head[at + i] === byte);
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
  switch (upload.contentType) {
    case "image/png":
      return starts([137, 80, 78, 71, 13, 10, 26, 10]);
    case "image/jpeg":
      return starts([255, 216, 255]);
    case "image/webp":
      return starts(ascii("RIFF")) && starts(ascii("WEBP"), 8);
    default:
      return false;
  }
}
