import axios, { type AxiosInstance } from "axios";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  SERVICE_PREFIX,
  toProblem,
  type BookingPaths,
  type FinancePaths,
  type IdentityPaths,
  type PaymentPaths,
} from "@/lib/api";
import { createServiceClient } from "@/lib/api/typed-client";
import {
  DEMO_ORGANIZER_ID,
  DEMO_PASSWORD,
  DEMO_USERS,
  mockConfig,
  resetMockState,
  seatsOf,
  soldSeats,
} from "./db";
import { mockServer } from "./node";
import { seedEvents } from "./seed";

const ORIGIN = "http://localhost";

function eventBySlug(slug: string) {
  const event = seedEvents.find((item) => item.slug === slug);
  if (!event) throw new Error(`seed thiếu sự kiện ${slug}`);
  return event;
}

const seatedEvent = eventBySlug("giao-huong-mua-xuan-2027"); // không hàng chờ, giới hạn 6
const gaEvent = eventBySlug("gio-mua-festival-2027");
const queueEvent = eventBySlug("song-am-live-2026"); // có hàng chờ, giới hạn 2
const pendingEvent = eventBySlug("neon-pulse-2027");

/** Client như app thật nhưng token gắn tay (interceptor refresh đã có test riêng ở V-101). */
function clients(token?: string) {
  const http: AxiosInstance = axios.create({
    baseURL: `${ORIGIN}/api`,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return {
    identity: createServiceClient<IdentityPaths>(http, SERVICE_PREFIX.identity),
    booking: createServiceClient<BookingPaths>(http, SERVICE_PREFIX.booking),
    payment: createServiceClient<PaymentPaths>(http, SERVICE_PREFIX.payment),
    finance: createServiceClient<FinancePaths>(http, SERVICE_PREFIX.finance),
  };
}

async function login(email: string): Promise<string> {
  const { access_token } = await clients().identity.post("/v1/auth/login", {
    body: { email, password: DEMO_PASSWORD },
  });
  return access_token;
}

async function problemOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return toProblem(error);
  }
  throw new Error("Request lẽ ra phải lỗi");
}

/** Đọc SSE qua fetch (EventSource không gửi được header Authorization). */
async function readSse(
  path: string,
  token: string,
  until: (event: string, data: string) => boolean,
  onEvent?: (event: string) => void,
) {
  const response = await fetch(`${ORIGIN}/api${path}`, {
    headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
  });
  if (!response.body) throw new Error("SSE không có body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: { event: string; data: string }[] = [];
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = /^event:(.*)$/m.exec(block)?.[1]?.trim() ?? "message";
      const data = /^data:(.*)$/m.exec(block)?.[1]?.trim() ?? "";
      events.push({ event, data });
      onEvent?.(event);
      if (until(event, data)) {
        // Không await: với stream server còn mở, cancel có thể không bao giờ resolve trong undici.
        void reader.cancel().catch(() => undefined);
        return events;
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  return events;
}

beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  resetMockState();
  mockConfig.queueTickMs = 5;
});
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());

describe("mock identity", () => {
  it("đăng ký idempotent theo key; cùng key khác nội dung bị từ chối; email trùng → 409", async () => {
    const { identity } = clients();
    const key = crypto.randomUUID();
    const body = { email: "new@ventix.test", password: "mat-khau-dai-12" };
    const first = await identity.post("/v1/auth/register", {
      body,
      headers: { "Idempotency-Key": key },
    });
    const again = await identity.post("/v1/auth/register", {
      body,
      headers: { "Idempotency-Key": key },
    });
    expect(again).toEqual(first);

    const reused = await problemOf(
      identity.post("/v1/auth/register", {
        body: { ...body, email: "other@ventix.test" },
        headers: { "Idempotency-Key": key },
      }),
    );
    expect(reused?.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const duplicate = await problemOf(
      identity.post("/v1/auth/register", {
        body,
        headers: { "Idempotency-Key": crypto.randomUUID() },
      }),
    );
    expect(duplicate).toMatchObject({ status: 409, code: "EMAIL_EXISTS" });
  });

  it("đăng nhập sai mật khẩu → 401 problem+json; đúng thì /me trả tài khoản", async () => {
    const wrong = await problemOf(
      clients().identity.post("/v1/auth/login", {
        body: { email: DEMO_USERS.user.email, password: "sai-mat-khau-123" },
      }),
    );
    expect(wrong).toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
      type: "urn:ticketing:problem:invalid_credentials",
    });

    const token = await login(DEMO_USERS.user.email);
    const me = await clients(token).identity.get("/v1/auth/me");
    expect(me).toMatchObject({ id: DEMO_USERS.user.id, roles: ["USER"], memberships: [] });
  });

  it("thiếu token → 401; refresh sau logout → INVALID_REFRESH_TOKEN", async () => {
    expect(await problemOf(clients().identity.get("/v1/auth/me"))).toMatchObject({ status: 401 });

    await login(DEMO_USERS.user.email);
    const refreshed = await clients().identity.post("/v1/auth/refresh");
    expect(refreshed.access_token).toMatch(/^mock\./);

    await clients().identity.post("/v1/auth/logout");
    const afterLogout = await problemOf(clients().identity.post("/v1/auth/refresh"));
    expect(afterLogout?.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("token tenant: thành viên lấy được, người ngoài bị 403; context đòi token đúng tenant", async () => {
    const orgToken = await login(DEMO_USERS.organizer.email);
    const globalContext = await problemOf(
      clients(orgToken).identity.get("/v1/organizers/{organizerId}/context", {
        path: { organizerId: DEMO_ORGANIZER_ID },
      }),
    );
    expect(globalContext?.code).toBe("TENANT_MISMATCH");

    const tenant = await clients(orgToken).identity.post("/v1/auth/tenants/{organizerId}/token", {
      path: { organizerId: DEMO_ORGANIZER_ID },
    });
    const context = await clients(tenant.access_token).identity.get(
      "/v1/organizers/{organizerId}/context",
      { path: { organizerId: DEMO_ORGANIZER_ID } },
    );
    expect(context.roles).toContain("ORGANIZER");

    const outsider = await login(DEMO_USERS.user.email);
    const denied = await problemOf(
      clients(outsider).identity.post("/v1/auth/tenants/{organizerId}/token", {
        path: { organizerId: DEMO_ORGANIZER_ID },
      }),
    );
    expect(denied?.status).toBe(403);
  });

  it("nộp hồ sơ organizer → upload giấy phép → Admin duyệt; version cũ bị 409", async () => {
    const userToken = await login(DEMO_USERS.user.email);
    const user = clients(userToken).identity;
    const application = await user.post("/v1/organizer-applications", {
      body: { company_name: "Công ty Thử" },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    expect(application.status).toBe("PENDING");

    const form = new FormData();
    form.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "license.pdf");
    await user.post("/v1/organizer-applications/{organizerId}/documents", {
      path: { organizerId: application.id },
      body: form,
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    const badForm = new FormData();
    badForm.append("file", new Blob(["x"], { type: "text/plain" }), "x.txt");
    const badType = await problemOf(
      user.post("/v1/organizer-applications/{organizerId}/documents", {
        path: { organizerId: application.id },
        body: badForm,
        headers: { "Idempotency-Key": crypto.randomUUID() },
      }),
    );
    expect(badType?.code).toBe("INVALID_DOCUMENT_TYPE");

    expect(await problemOf(user.get("/v1/admin/organizer-applications"))).toMatchObject({
      status: 403,
    });

    const admin = clients(await login(DEMO_USERS.admin.email)).identity;
    const list = await admin.get("/v1/admin/organizer-applications", {
      query: { status: "PENDING" },
    });
    expect(list.data.map((app) => app.id)).toContain(application.id);

    const approved = await admin.patch("/v1/admin/organizer-applications/{organizerId}", {
      path: { organizerId: application.id },
      body: { decision: "APPROVED", version: application.version },
    });
    expect(approved).toMatchObject({ status: "APPROVED", version: application.version + 1 });

    const stale = await problemOf(
      admin.patch("/v1/admin/organizer-applications/{organizerId}", {
        path: { organizerId: application.id },
        body: { decision: "REJECTED", version: application.version },
      }),
    );
    expect(stale?.status).toBe(409);

    const me = await user.get("/v1/auth/me");
    expect(me.memberships).toContainEqual({ organizer_id: application.id, role: "ORGANIZER" });
  });
});

describe("mock booking + payment", () => {
  const [seatA, seatB, seatC] = seatsOf(seatedEvent.id).map((seat) => seat.id);

  it("giữ ghế all-or-nothing: một ghế người khác giữ → 409 và không ghế nào bị giữ", async () => {
    const alice = clients(await login(DEMO_USERS.user.email)).booking;
    const bob = clients(await login(DEMO_USERS.admin.email)).booking;
    await bob.post("/v1/holds", {
      body: { event_id: seatedEvent.id, seat_ids: [seatB as string] },
    });

    const conflict = await problemOf(
      alice.post("/v1/holds", {
        body: { event_id: seatedEvent.id, seat_ids: [seatA as string, seatB as string] },
      }),
    );
    expect(conflict).toMatchObject({ status: 409, code: "SEAT_UNAVAILABLE", seat_id: seatB });

    const mine = await alice.get("/v1/holds", { query: { event_id: seatedEvent.id } });
    expect(mine).toEqual({ expires_at: null, seat_ids: [] });
  });

  it("ghế đã bán → 409; vượt giới hạn mỗi người → 422; nhả ghế → trống lại", async () => {
    const alice = clients(await login(DEMO_USERS.user.email)).booking;
    const soldSeat = [...soldSeats(seatedEvent.id)][0] as string;
    const sold = await problemOf(
      alice.post("/v1/holds", { body: { event_id: seatedEvent.id, seat_ids: [soldSeat] } }),
    );
    expect(sold?.code).toBe("SEAT_UNAVAILABLE");

    const seven = seatsOf(seatedEvent.id)
      .map((seat) => seat.id)
      .filter((id) => !soldSeats(seatedEvent.id).has(id))
      .slice(0, 7);
    const limit = await problemOf(
      alice.post("/v1/holds", { body: { event_id: seatedEvent.id, seat_ids: seven } }),
    );
    expect(limit?.code).toBe("HOLD_LIMIT_EXCEEDED");

    await alice.post("/v1/holds", {
      body: { event_id: seatedEvent.id, seat_ids: [seatC as string] },
    });
    await alice.delete("/v1/holds", { body: { event_id: seatedEvent.id } });
    const status = await alice.get("/v1/events/{id}/seat-status", { path: { id: seatedEvent.id } });
    expect(status.held).not.toContain(seatC);
  });

  it("sự kiện chưa PUBLISHED → EVENT_NOT_ON_SALE", async () => {
    const alice = clients(await login(DEMO_USERS.user.email)).booking;
    const seat = seatsOf(pendingEvent.id)[0]?.id as string;
    const error = await problemOf(
      alice.post("/v1/holds", { body: { event_id: pendingEvent.id, seat_ids: [seat] } }),
    );
    expect(error).toMatchObject({ status: 404, code: "EVENT_NOT_ON_SALE" });
  });

  it("checkout idempotent → thanh toán MOCK → đơn PAID, ghế thành sold", async () => {
    const token = await login(DEMO_USERS.user.email);
    const { booking, payment } = clients(token);
    const seats = [seatA as string, seatB as string];
    await booking.post("/v1/holds", { body: { event_id: seatedEvent.id, seat_ids: seats } });

    const key = crypto.randomUUID();
    const cart = { event_id: seatedEvent.id, seat_ids: seats, ga_items: [], merch_items: [] };
    const order = await booking.post("/v1/checkout", {
      body: cart,
      headers: { "Idempotency-Key": key },
    });
    const again = await booking.post("/v1/checkout", {
      body: cart,
      headers: { "Idempotency-Key": key },
    });
    expect(again).toEqual(order);
    const expected = seats
      .map((id) => seatsOf(seatedEvent.id).find((seat) => seat.id === id)?.ticket_class_id)
      .map((tc) => seatedEvent.ticket_classes.find((item) => item.id === tc)?.price_vnd ?? 0)
      .reduce((sum, price) => sum + price, 0);
    expect(order).toMatchObject({ status: "AWAITING_PAYMENT", total_amount_vnd: expected });

    const reused = await problemOf(
      booking.post("/v1/checkout", {
        body: { ...cart, seat_ids: [seatA as string] },
        headers: { "Idempotency-Key": key },
      }),
    );
    expect(reused?.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const stranger = clients(await login(DEMO_USERS.admin.email)).payment;
    const forbidden = await problemOf(
      stranger.post("/v1/payments", {
        body: { order_id: order.order_id, provider: "MOCK" },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      }),
    );
    expect(forbidden?.code).toBe("PAYMENT_FORBIDDEN");

    const pay = await payment.post("/v1/payments", {
      body: { order_id: order.order_id, provider: "MOCK" },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    expect(pay.redirect_url).toMatch(/^https:\/\/mock\.invalid\/payments\//);
    const status = await booking.get("/v1/events/{id}/seat-status", {
      path: { id: seatedEvent.id },
    });
    expect(status.sold).toEqual(expect.arrayContaining(seats));
    expect(status.held).not.toEqual(expect.arrayContaining(seats));

    const paidAgain = await problemOf(
      payment.post("/v1/payments", {
        body: { order_id: order.order_id, provider: "MOCK" },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      }),
    );
    expect(paidAgain?.code).toBe("PAYABLE_EXPIRED");
  });

  it("VNPay giả: redirect về trang return, gọi return → thanh toán xong", async () => {
    const token = await login(DEMO_USERS.user.email);
    const { booking, payment } = clients(token);
    const ga = gaEvent.ticket_classes[0];
    const order = await booking.post("/v1/checkout", {
      body: {
        event_id: gaEvent.id,
        seat_ids: [],
        ga_items: [{ ticket_class_id: ga?.id as string, quantity: 2 }],
        merch_items: [],
      },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    expect(order.total_amount_vnd).toBe((ga?.price_vnd ?? 0) * 2);

    const { redirect_url } = await payment.post("/v1/payments", {
      body: { order_id: order.order_id, provider: "VNPAY" },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    const returned = new URL(redirect_url);
    expect(returned.pathname).toBe("/payment/vnpay-return");
    const param = (name: string) => returned.searchParams.get(name) ?? "";
    const result = await payment.get("/v1/payments/vnpay/return", {
      query: {
        vnp_TmnCode: param("vnp_TmnCode"),
        vnp_Amount: param("vnp_Amount"),
        vnp_BankCode: param("vnp_BankCode"),
        vnp_OrderInfo: param("vnp_OrderInfo"),
        vnp_TransactionNo: param("vnp_TransactionNo"),
        vnp_ResponseCode: param("vnp_ResponseCode"),
        vnp_TransactionStatus: param("vnp_TransactionStatus"),
        vnp_TxnRef: param("vnp_TxnRef"),
        vnp_SecureHash: param("vnp_SecureHash"),
      },
    });
    expect(result).toEqual({ signature_valid: true, provider_succeeded: true });
  });

  it("đợt bán có hàng chờ: thiếu admission → 403; SSE hàng chờ cấp token rồi giữ ghế được", async () => {
    const token = await login(DEMO_USERS.user.email);
    const { booking } = clients(token);
    const seat = seatsOf(queueEvent.id)[0]?.id as string;
    const denied = await problemOf(
      booking.post("/v1/holds", { body: { event_id: queueEvent.id, seat_ids: [seat] } }),
    );
    expect(denied?.code).toBe("ADMISSION_REQUIRED");

    const joined = await booking.post("/v1/queue/join", { body: { event_id: queueEvent.id } });
    expect(joined.status).toBe("waiting");

    const events = await readSse(
      `/booking/v1/queue/status?event_id=${queueEvent.id}`,
      token,
      (_e, data) => data.includes('"admitted"'),
    );
    const statuses = events.map(
      (event) => JSON.parse(event.data) as { status: string; admission_token?: string },
    );
    expect(statuses.slice(0, -1).every((s) => s.status === "waiting")).toBe(true);
    const admission = statuses[statuses.length - 1];
    expect(admission?.status).toBe("admitted");

    const held = await booking.post("/v1/holds", {
      body: { event_id: queueEvent.id, seat_ids: [seat] },
      headers: { "X-Admission-Token": admission?.admission_token as string },
    });
    expect(held.seat_ids).toEqual([seat]);
  });

  it("SSE seat-stream gửi snapshot trước, rồi delta khi có người giữ ghế", async () => {
    const token = await login(DEMO_USERS.user.email);
    const { booking } = clients(token);
    let holding: Promise<unknown> = Promise.resolve();
    // Giữ ghế ngay khi nhận snapshot: lúc đó stream chắc chắn đã đăng ký nhận delta.
    const streamed = readSse(
      `/booking/v1/events/${seatedEvent.id}/seat-stream`,
      token,
      (event) => event === "delta",
      (event) => {
        if (event === "snapshot") {
          holding = booking.post("/v1/holds", {
            body: { event_id: seatedEvent.id, seat_ids: [seatA as string] },
          });
        }
      },
    );
    const events = await streamed;
    await holding;
    expect(events[0]?.event).toBe("snapshot");
    expect(JSON.parse(events[events.length - 1]?.data ?? "[]")).toEqual([`H:${seatA}`]);
  });
});

describe("mock finance", () => {
  it("thống kê: organizer cần token tenant; Admin xem được; VAT tách half-up", async () => {
    const organizer = await login(DEMO_USERS.organizer.email);
    const noTenant = await problemOf(
      clients(organizer).finance.get("/v1/organizer/events/{id}/stats", {
        path: { id: seatedEvent.id },
      }),
    );
    expect(noTenant?.status).toBe(403);

    const tenant = await clients(organizer).identity.post("/v1/auth/tenants/{organizerId}/token", {
      path: { organizerId: DEMO_ORGANIZER_ID },
    });
    const owned = seedEvents.find((event) => event.organizer_id === DEMO_ORGANIZER_ID);
    const stats = await clients(tenant.access_token).finance.get(
      "/v1/organizer/events/{id}/stats",
      {
        path: { id: owned?.id as string },
      },
    );
    const ticket = stats.revenue.find((row) => row.category === "TICKET");
    expect(BigInt(ticket?.net_vnd ?? "0") + BigInt(ticket?.vat_vnd ?? "0")).toBe(
      BigInt(ticket?.gross_vnd ?? "-1"),
    );

    const missing = await problemOf(
      clients(await login(DEMO_USERS.admin.email)).finance.get("/v1/organizer/events/{id}/stats", {
        path: { id: crypto.randomUUID() },
      }),
    );
    expect(missing?.code).toBe("EVENT_NOT_FOUND");
  });

  it("DLQ: chỉ Admin; replay một lần, lần hai → 409", async () => {
    const user = clients(await login(DEMO_USERS.user.email)).finance;
    expect(await problemOf(user.get("/v1/admin/dlq"))).toMatchObject({ status: 403 });

    const admin = clients(await login(DEMO_USERS.admin.email)).finance;
    const { items } = await admin.get("/v1/admin/dlq");
    const id = items[0]?.id as string;
    const replayed = await admin.post("/v1/admin/dlq/{id}/replay", { path: { id } });
    expect(replayed.status).toBe("REPLAYED");
    const twice = await problemOf(admin.post("/v1/admin/dlq/{id}/discard", { path: { id } }));
    expect(twice?.code).toBe("DLQ_REPLAY_STARTED");
  });
});
