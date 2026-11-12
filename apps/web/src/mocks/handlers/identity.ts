import { HttpResponse } from "msw";
import { SERVICE_PREFIX, type IdentityPaths, type IdentitySchemas } from "@/lib/api";
import {
  ACCESS_TOKEN_TTL_SEC,
  DEMO_USERS,
  issueAccessToken,
  mockId,
  rolesOf,
  savePersistedUsers,
  setRefreshSession,
  state,
  userById,
} from "../db";
import { authenticate, idempotent, mockService, noContent, problem, UUID_RE } from "./typed";

type Application = IdentitySchemas["schemas"]["ApplicationResponseDto"];
type DocumentMeta = IdentitySchemas["schemas"]["DocumentResponseDto"];

const api = mockService<IdentityPaths>(SERVICE_PREFIX.identity);
const MAX_UPLOAD_BYTES = 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

function tokenResponse(userId: string, organizerId: string | null = null) {
  return {
    access_token: issueAccessToken(userId, organizerId),
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
  };
}

function isAdmin(roles: string[]): boolean {
  return roles.includes("ADMIN");
}

export const identityHandlers = [
  api.get("/v1/whoami", ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    return HttpResponse.json({
      userId: auth.grant.userId,
      roles: auth.roles,
      ...(auth.grant.organizerId ? { organizerId: auth.grant.organizerId } : {}),
    });
  }),

  api.post("/v1/auth/register", async ({ request }) => {
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (!UUID_RE.test(key)) {
      return problem(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key phải là UUID");
    }
    const body = await request.json();
    const email = String(body?.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(body?.password ?? "");
    if (!email.includes("@") || password.length < 12 || password.length > 128) {
      return problem(
        400,
        "VALIDATION_FAILED",
        "Email không hợp lệ hoặc mật khẩu ngoài 12–128 ký tự",
      );
    }
    const idem = idempotent<{ id: string; email: string }>("identity:register", key, {
      email,
      password,
    });
    if (idem.conflict) {
      return problem(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key đã dùng cho nội dung khác");
    }
    if (idem.replay) {
      return HttpResponse.json(idem.replay, { status: 201 });
    }
    if (state.users.has(email)) {
      return problem(409, "EMAIL_EXISTS", "Email đã được sử dụng");
    }
    const user = { id: mockId("00000000"), email, password, roles: ["USER"], memberships: [] };
    state.users.set(email, user);
    savePersistedUsers();
    const created = { id: user.id, email };
    idem.save(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  api.post("/v1/auth/login", async ({ request }) => {
    const body = await request.json();
    const user = state.users.get(
      String(body?.email ?? "")
        .trim()
        .toLowerCase(),
    );
    if (!user || user.password === null || user.password !== body?.password) {
      return problem(401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng");
    }
    setRefreshSession(user.id);
    return HttpResponse.json(tokenResponse(user.id));
  }),

  // Refresh luôn trả token toàn cục (không scope tenant), như identity thật.
  api.post("/v1/auth/refresh", () => {
    const user = state.refreshUserId ? userById(state.refreshUserId) : undefined;
    if (!user) {
      setRefreshSession(null);
      return problem(401, "INVALID_REFRESH_TOKEN", "Phiên đăng nhập không còn hiệu lực");
    }
    return HttpResponse.json(tokenResponse(user.id));
  }),

  api.post("/v1/auth/logout", () => {
    setRefreshSession(null);
    return noContent();
  }),

  api.get("/.well-known/jwks.json", () =>
    HttpResponse.json({
      keys: [{ kty: "RSA", kid: "mock-key", alg: "RS256", use: "sig", n: "mock", e: "AQAB" }],
    }),
  ),

  // Không có Google thật: đặt sẵn phiên cho tài khoản Google demo rồi đưa thẳng về trang callback
  // của frontend, giống kết quả sau khi Google redirect và identity đặt refresh cookie.
  api.get("/v1/auth/google/start", ({ request }) => {
    setRefreshSession(DEMO_USERS.google.id);
    const origin = new URL(request.url).origin;
    return HttpResponse.json({ authorization_url: `${origin}/auth/callback?provider=google` });
  }),

  api.get("/v1/auth/google/link", ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const origin = new URL(request.url).origin;
    return HttpResponse.json({ authorization_url: `${origin}/auth/callback?provider=google` });
  }),

  api.get("/v1/auth/me", ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const user = userById(auth.grant.userId);
    if (!user) return problem(401, "UNAUTHORIZED", "Tài khoản không tồn tại");
    return HttpResponse.json({
      id: user.id,
      email: user.email,
      roles: user.roles,
      memberships: user.memberships,
    });
  }),

  api.post("/v1/auth/tenants/{organizerId}/token", ({ request, params }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const user = userById(auth.grant.userId);
    const member = user?.memberships.some((m) => m.organizer_id === params.organizerId);
    if (!member) return problem(403, "FORBIDDEN", "Không thuộc organizer này");
    return HttpResponse.json(tokenResponse(auth.grant.userId, params.organizerId));
  }),

  api.get("/v1/organizers/{organizerId}/context", ({ request, params }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    if (auth.grant.organizerId !== params.organizerId) {
      return problem(403, "TENANT_MISMATCH", "Token chưa chọn organizer này");
    }
    return HttpResponse.json({ organizer_id: params.organizerId, roles: rolesOf(auth.grant) });
  }),

  api.post("/v1/organizer-applications", async ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (!UUID_RE.test(key)) {
      return problem(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key phải là UUID");
    }
    const body = await request.json();
    const companyName = String(body?.company_name ?? "").trim();
    if (companyName.length === 0) {
      return problem(400, "VALIDATION_FAILED", "Thiếu tên công ty");
    }
    const idem = idempotent<Application>(`identity:apply:${auth.grant.userId}`, key, body);
    if (idem.conflict) {
      return problem(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key đã dùng cho nội dung khác");
    }
    if (idem.replay) {
      return HttpResponse.json(idem.replay, { status: 201 });
    }
    const application: Application = {
      id: mockId("10000000"),
      owner_user_id: auth.grant.userId,
      company_name: companyName,
      tax_code: body?.tax_code ?? null,
      status: "PENDING",
      version: 1,
      created_at: new Date().toISOString(),
      approved_at: null,
    };
    state.applications.set(application.id, application);
    state.documents.set(application.id, []);
    idem.save(application);
    return HttpResponse.json(application, { status: 201 });
  }),

  api.get("/v1/organizer-applications/{organizerId}", ({ request, params }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const application = state.applications.get(params.organizerId);
    if (!application) return problem(404, "ORGANIZER_NOT_FOUND", "Không tìm thấy hồ sơ");
    if (application.owner_user_id !== auth.grant.userId && !isAdmin(auth.roles)) {
      return problem(403, "FORBIDDEN", "Không có quyền xem hồ sơ này");
    }
    return HttpResponse.json({
      ...application,
      documents: state.documents.get(application.id) ?? [],
    });
  }),

  api.post("/v1/organizer-applications/{organizerId}/documents", async ({ request, params }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (!UUID_RE.test(key)) {
      return problem(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key phải là UUID");
    }
    const application = state.applications.get(params.organizerId);
    if (!application) return problem(404, "ORGANIZER_NOT_FOUND", "Không tìm thấy hồ sơ");
    if (application.owner_user_id !== auth.grant.userId) {
      return problem(403, "FORBIDDEN", "Chỉ chủ hồ sơ được upload");
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return problem(400, "LICENSE_REQUIRED", "Thiếu file giấy phép");
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      return problem(400, "INVALID_DOCUMENT_TYPE", "Chỉ nhận PDF, PNG hoặc JPEG");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return problem(400, "LIMIT_FILE_SIZE", "File vượt quá 1 MiB");
    }
    const idem = idempotent<DocumentMeta>(`identity:doc:${application.id}`, key, {
      size: file.size,
      type: file.type,
    });
    if (idem.conflict) {
      return problem(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key đã dùng cho nội dung khác");
    }
    if (idem.replay) {
      return HttpResponse.json(idem.replay, { status: 201 });
    }
    const document: DocumentMeta = {
      id: mockId("11000000"),
      doc_type: "BUSINESS_LICENSE",
      created_at: new Date().toISOString(),
    };
    state.documents.get(application.id)?.push(document);
    idem.save(document);
    return HttpResponse.json(document, { status: 201 });
  }),

  api.get(
    "/v1/organizer-applications/{organizerId}/documents/{documentId}/download",
    ({ request, params }) => {
      const auth = authenticate(request);
      if (!auth.ok) return auth.response;
      const application = state.applications.get(params.organizerId);
      const document = state.documents
        .get(params.organizerId)
        ?.find((doc) => doc.id === params.documentId);
      if (!application || !document) {
        return problem(404, "ORGANIZER_NOT_FOUND", "Không tìm thấy giấy phép");
      }
      if (application.owner_user_id !== auth.grant.userId && !isAdmin(auth.roles)) {
        return problem(403, "FORBIDDEN", "Không có quyền tải giấy phép");
      }
      // Link giả trỏ tới file tĩnh có sẵn; bản thật là presigned URL MinIO 60 giây.
      const origin = new URL(request.url).origin;
      return HttpResponse.json({ url: `${origin}/favicon.svg`, expires_in: 60 });
    },
  ),

  api.get("/v1/admin/organizer-applications", ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    if (!isAdmin(auth.roles)) return problem(403, "FORBIDDEN", "Cần quyền Admin");
    const query = new URL(request.url).searchParams;
    const status = query.get("status");
    const limit = Math.min(Math.max(Number(query.get("limit") ?? 20) || 20, 1), 100);
    const cursor = query.get("cursor");
    const all = [...state.applications.values()]
      .filter((app) => !status || app.status === status)
      .sort((a, b) => a.id.localeCompare(b.id));
    const start = cursor ? all.findIndex((app) => app.id > cursor) : 0;
    const page = start < 0 ? [] : all.slice(start, start + limit);
    const last = page[page.length - 1];
    const hasMore = start >= 0 && start + limit < all.length;
    return HttpResponse.json({ data: page, next_cursor: hasMore && last ? last.id : null });
  }),

  api.patch("/v1/admin/organizer-applications/{organizerId}", async ({ request, params }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    if (!isAdmin(auth.roles)) return problem(403, "FORBIDDEN", "Cần quyền Admin");
    const body = await request.json();
    const application = state.applications.get(params.organizerId);
    if (!application) return problem(404, "ORGANIZER_NOT_FOUND", "Không tìm thấy hồ sơ");
    if (application.status !== "PENDING") {
      return problem(409, "ORGANIZER_NOT_PENDING", "Hồ sơ đã được xử lý");
    }
    if (application.version !== body?.version) {
      return problem(409, "ORGANIZER_VERSION_CONFLICT", "Hồ sơ đã thay đổi, tải lại rồi thử lại");
    }
    const updated = {
      ...application,
      status: body.decision,
      version: application.version + 1,
      approved_at: body.decision === "APPROVED" ? new Date().toISOString() : null,
    };
    state.applications.set(updated.id, updated);
    if (body.decision === "APPROVED") {
      const owner = userById(application.owner_user_id);
      owner?.memberships.push({ organizer_id: application.id, role: "ORGANIZER" });
      savePersistedUsers();
    }
    return HttpResponse.json(updated);
  }),
];
