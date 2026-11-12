import { HttpResponse } from "msw";
import { SERVICE_PREFIX, type BookingPaths, type BookingSchemas } from "@/lib/api";
import {
  activeHolds,
  currentPhase,
  emitSeatChange,
  findEvent,
  HOLD_TTL_MS,
  mockConfig,
  mockId,
  onSeatChange,
  ORDER_TTL_MS,
  priceOf,
  randomToken,
  seatById,
  skuBelongsToEvent,
  skuById,
  soldSeats,
  state,
  type MockOrder,
  type SeatDelta,
} from "../db";
import type { SeedEvent } from "../seed";
import {
  authenticate,
  eventStream,
  idempotent,
  mockService,
  noContent,
  problem,
  UUID_RE,
} from "./typed";

const api = mockService<BookingPaths>(SERVICE_PREFIX.booking);
type CheckoutResponse = BookingSchemas["schemas"]["CheckoutResponseDto"];
type QueueStatus = BookingSchemas["schemas"]["QueueStatusDto"];
const ADMISSION_TTL_MS = 10 * 60 * 1000;

function onSaleEvent(eventId: unknown): SeedEvent | null {
  const event = typeof eventId === "string" ? findEvent(eventId) : undefined;
  return event && event.status === "PUBLISHED" ? event : null;
}

/** Đợt bán có hàng chờ thì phải có X-Admission-Token hợp lệ của đúng người, đúng sự kiện. */
function admitted(request: Request, event: SeedEvent, userId: string): boolean {
  if (!currentPhase(event).queue_enabled) return true;
  const token = request.headers.get("X-Admission-Token") ?? "";
  const grant = state.admissions.get(token);
  return (
    !!grant && grant.userId === userId && grant.eventId === event.id && grant.expiresAt > Date.now()
  );
}

function seatSnapshot(eventId: string) {
  return {
    sold: [...soldSeats(eventId)],
    held: [...activeHolds(eventId).keys()],
    as_of: new Date().toISOString(),
  };
}

function queueStatus(eventId: string, userId: string, step: number): QueueStatus {
  const queue = state.queues.get(eventId) ?? [];
  const index = queue.indexOf(userId);
  if (index < 0) {
    return { status: "not_joined", position: null, estimated_wait_sec: null };
  }
  const position = Math.max(index + mockConfig.queueSteps - step, 0);
  if (position > 0) {
    return { status: "waiting", position, estimated_wait_sec: position };
  }
  const token = randomToken();
  const expiresAt = Date.now() + ADMISSION_TTL_MS;
  state.admissions.set(token, { userId, eventId, expiresAt });
  return {
    status: "admitted",
    position: null,
    estimated_wait_sec: null,
    admission_token: token,
    expires_at: new Date(expiresAt).toISOString(),
  };
}

export const bookingHandlers = [
  api.get("/v1/whoami", ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    return HttpResponse.json({ userId: auth.grant.userId, roles: auth.roles });
  }),

  // Giữ ghế all-or-nothing: một ghế không giữ được thì không ghế nào bị giữ (như Lua hold_seats).
  api.post("/v1/holds", async ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const body = await request.json();
    const seatIds = [...new Set(body?.seat_ids ?? [])];
    if (!UUID_RE.test(String(body?.event_id)) || seatIds.length === 0) {
      return problem(400, "INVALID_INPUT", "Cần event_id và ít nhất một seat_id");
    }
    const event = onSaleEvent(body.event_id);
    if (!event) return problem(404, "EVENT_NOT_ON_SALE", "Sự kiện chưa mở bán");
    if (!admitted(request, event, auth.grant.userId)) {
      return problem(403, "ADMISSION_REQUIRED", "Cần vào hàng chờ trước khi chọn ghế");
    }
    const holds = activeHolds(event.id);
    const sold = soldSeats(event.id);
    for (const seatId of seatIds) {
      const hold = holds.get(seatId);
      if (
        !seatById(event.id, seatId) ||
        sold.has(seatId) ||
        (hold && hold.userId !== auth.grant.userId)
      ) {
        return problem(409, "SEAT_UNAVAILABLE", "Ghế không còn trống", { seat_id: seatId });
      }
    }
    const mine = [...holds.entries()].filter(([, hold]) => hold.userId === auth.grant.userId);
    const total = new Set([...mine.map(([seatId]) => seatId), ...seatIds]).size;
    if (total > currentPhase(event).per_user_limit) {
      return problem(422, "HOLD_LIMIT_EXCEEDED", "Vượt số ghế tối đa mỗi người");
    }
    const expiresAt = Date.now() + HOLD_TTL_MS;
    for (const seatId of seatIds) holds.set(seatId, { userId: auth.grant.userId, expiresAt });
    emitSeatChange(
      event.id,
      seatIds.map((seatId): SeatDelta => `H:${seatId}`),
    );
    return HttpResponse.json(
      { expires_at: new Date(expiresAt).toISOString(), seat_ids: seatIds },
      { status: 201 },
    );
  }),

  api.get("/v1/holds", ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const eventId = new URL(request.url).searchParams.get("event_id") ?? "";
    if (!UUID_RE.test(eventId)) return problem(400, "INVALID_INPUT", "event_id không hợp lệ");
    const mine = [...activeHolds(eventId).entries()].filter(
      ([, hold]) => hold.userId === auth.grant.userId,
    );
    const earliest = Math.min(...mine.map(([, hold]) => hold.expiresAt));
    return HttpResponse.json({
      expires_at: mine.length > 0 ? new Date(earliest).toISOString() : null,
      seat_ids: mine.map(([seatId]) => seatId),
    });
  }),

  api.delete("/v1/holds", async ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const body = await request.json();
    if (!UUID_RE.test(String(body?.event_id))) {
      return problem(400, "INVALID_INPUT", "event_id không hợp lệ");
    }
    const holds = activeHolds(body.event_id);
    const targets = body.seat_ids ?? [...holds.keys()];
    const released: SeatDelta[] = [];
    for (const seatId of targets) {
      if (holds.get(seatId)?.userId === auth.grant.userId) {
        holds.delete(seatId);
        released.push(`A:${seatId}`);
      }
    }
    emitSeatChange(body.event_id, released);
    return noContent();
  }),

  api.get("/v1/events/{id}/seat-status", ({ request, params }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    if (!UUID_RE.test(params.id)) return problem(400, "INVALID_INPUT", "event id không hợp lệ");
    return HttpResponse.json(seatSnapshot(params.id));
  }),

  // SSE: snapshot đầu tiên rồi delta mỗi khi mock đổi trạng thái ghế (bản thật gộp lô 500 ms).
  api.get("/v1/events/{id}/seat-stream", ({ request, params }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    if (!UUID_RE.test(params.id)) return problem(400, "INVALID_INPUT", "event id không hợp lệ");
    return eventStream(request, (writer) => {
      writer.send("snapshot", JSON.stringify(seatSnapshot(params.id)));
      return onSeatChange(params.id, (deltas) => writer.send("delta", JSON.stringify(deltas)));
    });
  }),

  api.post("/v1/checkout", async ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (!UUID_RE.test(key)) return problem(400, "INVALID_INPUT", "Thiếu Idempotency-Key (UUID)");
    const body = await request.json();
    const idem = idempotent<CheckoutResponse>(`booking:checkout:${auth.grant.userId}`, key, body);
    if (idem.conflict) {
      return problem(422, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key đã dùng cho giỏ hàng khác");
    }
    if (idem.replay) return HttpResponse.json(idem.replay, { status: 201 });

    const seatIds = body?.seat_ids ?? [];
    const gaItems = body?.ga_items ?? [];
    const merchItems = body?.merch_items ?? [];
    if (seatIds.length + gaItems.length + merchItems.length === 0) {
      return problem(400, "EMPTY_CHECKOUT", "Giỏ hàng trống");
    }
    if (body.voucher_code) {
      return problem(422, "VOUCHER_NOT_SUPPORTED", "Chưa hỗ trợ voucher");
    }
    const event = onSaleEvent(body.event_id);
    if (!event) return problem(409, "EVENT_NOT_ON_SALE", "Sự kiện chưa mở bán");
    if (!admitted(request, event, auth.grant.userId)) {
      return problem(403, "ADMISSION_REQUIRED", "Cần vào hàng chờ trước khi thanh toán");
    }
    const holds = activeHolds(event.id);
    let ticketAmount = 0;
    for (const seatId of seatIds) {
      const seat = seatById(event.id, seatId);
      if (!seat || holds.get(seatId)?.userId !== auth.grant.userId) {
        return problem(409, "HOLD_NOT_FOUND", "Ghế chưa được giữ hoặc đã hết hạn giữ", {
          seat_id: seatId,
        });
      }
      ticketAmount += priceOf(event.id, seat.ticket_class_id);
    }
    for (const item of gaItems) {
      const ticketClass = event.ticket_classes.find((tc) => tc.id === item.ticket_class_id);
      if (!ticketClass || ticketClass.kind !== "GA" || item.quantity < 1) {
        return problem(422, "INVALID_TICKET_CLASS", "Hạng vé không hợp lệ cho vé đứng");
      }
      ticketAmount += ticketClass.price_vnd * item.quantity;
    }
    let merchAmount = 0;
    for (const item of merchItems) {
      const sku = skuById(item.sku_id);
      if (!sku || !skuBelongsToEvent(sku.id, event.id) || item.quantity > sku.on_hand) {
        return problem(503, "MERCH_UNAVAILABLE", "Sản phẩm không đủ hàng");
      }
      merchAmount += sku.price_vnd * item.quantity;
    }
    const order: MockOrder = {
      id: mockId("40000000"),
      user_id: auth.grant.userId,
      event_id: event.id,
      seat_ids: seatIds,
      ga_items: gaItems,
      merch_items: merchItems,
      status: "AWAITING_PAYMENT",
      ticket_amount_vnd: ticketAmount,
      merch_amount_vnd: merchAmount,
      total_amount_vnd: ticketAmount + merchAmount,
      expires_at: new Date(Date.now() + ORDER_TTL_MS).toISOString(),
    };
    state.orders.set(order.id, order);
    const response: CheckoutResponse = {
      order_id: order.id,
      status: "AWAITING_PAYMENT",
      ticket_amount_vnd: order.ticket_amount_vnd,
      merch_amount_vnd: order.merch_amount_vnd,
      total_amount_vnd: order.total_amount_vnd,
      expires_at: order.expires_at,
    };
    idem.save(response);
    return HttpResponse.json(response, { status: 201 });
  }),

  api.post("/v1/queue/join", async ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const body = await request.json();
    if (!UUID_RE.test(String(body?.event_id))) {
      return problem(400, "INVALID_INPUT", "event_id không hợp lệ");
    }
    const event = onSaleEvent(body.event_id);
    if (!event) return problem(404, "EVENT_NOT_ON_SALE", "Sự kiện chưa mở bán");
    if (!currentPhase(event).queue_enabled) {
      return HttpResponse.json(
        { status: "disabled", position: null, estimated_wait_sec: null },
        { status: 201 },
      );
    }
    const queue = state.queues.get(event.id) ?? [];
    if (!queue.includes(auth.grant.userId)) queue.push(auth.grant.userId);
    state.queues.set(event.id, queue);
    return HttpResponse.json(queueStatus(event.id, auth.grant.userId, 0), { status: 201 });
  }),

  // SSE: đẩy vị trí mỗi `queueTickMs`, kết thúc bằng admitted (kèm admission_token) rồi đóng.
  api.get("/v1/queue/status", ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const eventId = new URL(request.url).searchParams.get("event_id") ?? "";
    if (!UUID_RE.test(eventId)) return problem(400, "INVALID_INPUT", "event_id không hợp lệ");
    const event = onSaleEvent(eventId);
    if (!event) return problem(404, "EVENT_NOT_ON_SALE", "Sự kiện chưa mở bán");
    return eventStream(request, (writer) => {
      if (!currentPhase(event).queue_enabled) {
        const disabled: QueueStatus = {
          status: "disabled",
          position: null,
          estimated_wait_sec: null,
        };
        writer.send("status", JSON.stringify(disabled));
        writer.close();
        return;
      }
      let step = 0;
      const tick = () => {
        const status = queueStatus(eventId, auth.grant.userId, step);
        writer.send("status", JSON.stringify(status));
        if (status.status !== "waiting") {
          writer.close();
          return;
        }
        step += 1;
        timer = setTimeout(tick, mockConfig.queueTickMs);
      };
      let timer = setTimeout(tick, 0);
      return () => clearTimeout(timer);
    });
  }),
];

/** Dùng khi thanh toán xong: ghế giữ → đã bán, phát delta `S:`. */
export function markOrderSeatsSold(order: MockOrder): void {
  const holds = activeHolds(order.event_id);
  const sold = soldSeats(order.event_id);
  for (const seatId of order.seat_ids) {
    holds.delete(seatId);
    sold.add(seatId);
  }
  emitSeatChange(
    order.event_id,
    order.seat_ids.map((seatId): SeatDelta => `S:${seatId}`),
  );
}
