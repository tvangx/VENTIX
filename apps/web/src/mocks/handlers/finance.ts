import { HttpResponse } from "msw";
import { SERVICE_PREFIX, type FinancePaths, type FinanceSchemas } from "@/lib/api";
import { findEvent, priceOf, seatsOf, soldSeats, splitVat, state, skuById } from "../db";
import { authenticate, mockService, problem } from "./typed";

const api = mockService<FinancePaths>(SERVICE_PREFIX.finance);
type StatsResponse = FinanceSchemas["schemas"]["StatsResponse"];

function page<T extends { id: string }>(items: T[], request: Request) {
  const query = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(Number(query.get("limit") ?? 50) || 50, 1), 200);
  const cursor = query.get("cursor");
  const start = cursor ? items.findIndex((item) => item.id === cursor) + 1 : 0;
  const slice = items.slice(start, start + limit);
  const last = slice[slice.length - 1];
  return { items: slice, next_cursor: start + limit < items.length && last ? last.id : null };
}

/** Thống kê theo ghế đã bán + đơn đã thanh toán trong mock; VAT tách theo ADR-0012. */
function statsOf(eventId: string): StatsResponse | null {
  const event = findEvent(eventId);
  if (!event) return null;
  const sold = soldSeats(eventId);
  const byClass = new Map<string, number>();
  for (const seat of seatsOf(eventId)) {
    if (sold.has(seat.id))
      byClass.set(seat.ticket_class_id, (byClass.get(seat.ticket_class_id) ?? 0) + 1);
  }
  let merchGross = 0;
  for (const order of state.orders.values()) {
    if (order.event_id !== eventId || order.status !== "PAID") continue;
    for (const item of order.ga_items) {
      byClass.set(item.ticket_class_id, (byClass.get(item.ticket_class_id) ?? 0) + item.quantity);
    }
    for (const item of order.merch_items) {
      merchGross += (skuById(item.sku_id)?.price_vnd ?? 0) * item.quantity;
    }
  }
  const sales = event.ticket_classes.map((tc) => {
    const count = byClass.get(tc.id) ?? 0;
    return {
      ticket_class_id: tc.id,
      sold: count,
      revenue_vnd: String(count * priceOf(eventId, tc.id)),
    };
  });
  const ticketGross = sales.reduce((sum, row) => sum + Number(row.revenue_vnd), 0);
  const ticketVat = splitVat(ticketGross);
  const merchVat = splitVat(merchGross);
  return {
    event_id: eventId,
    title: event.title,
    sales,
    revenue: [
      {
        category: "TICKET",
        gross_vnd: String(ticketGross),
        net_vnd: ticketVat.net,
        vat_vnd: ticketVat.vat,
      },
      {
        category: "MERCH",
        gross_vnd: String(merchGross),
        net_vnd: merchVat.net,
        vat_vnd: merchVat.vat,
      },
    ],
  };
}

export const financeHandlers = [
  api.get("/v1/whoami", ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    return HttpResponse.json({ userId: auth.grant.userId, roles: auth.roles });
  }),

  api.get("/v1/organizer/events/{id}/stats", ({ request, params }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const event = findEvent(params.id);
    if (!event) return problem(404, "EVENT_NOT_FOUND", "Không tìm thấy sự kiện");
    const isOwner =
      auth.grant.organizerId === event.organizer_id && auth.roles.includes("ORGANIZER");
    if (!isOwner && !auth.roles.includes("ADMIN")) {
      return problem(403, "FORBIDDEN", "Chỉ organizer của sự kiện xem được thống kê");
    }
    const stats = statsOf(params.id);
    return stats
      ? HttpResponse.json(stats)
      : problem(404, "EVENT_NOT_FOUND", "Không tìm thấy sự kiện");
  }),

  api.get("/v1/admin/audit/verify", ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    if (!auth.roles.includes("ADMIN")) return problem(403, "FORBIDDEN", "Cần quyền Admin");
    return HttpResponse.json({ ok: true, checked: state.audit.length });
  }),

  api.get("/v1/admin/audit", ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    if (!auth.roles.includes("ADMIN")) return problem(403, "FORBIDDEN", "Cần quyền Admin");
    const query = new URL(request.url).searchParams;
    const action = query.get("action");
    const resourceType = query.get("resource_type");
    const rows = state.audit.filter(
      (row) =>
        (!action || row.action === action) && (!resourceType || row.resource_type === resourceType),
    );
    return HttpResponse.json(page(rows, request));
  }),

  api.get("/v1/admin/dlq", ({ request }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    if (!auth.roles.includes("ADMIN")) return problem(403, "FORBIDDEN", "Cần quyền Admin");
    return HttpResponse.json(page(state.dlq, request));
  }),

  ...(["replay", "discard"] as const).map((action) =>
    api.post(`/v1/admin/dlq/{id}/${action}`, ({ request, params }) => {
      const auth = authenticate(request);
      if (!auth.ok) return auth.response;
      if (!auth.roles.includes("ADMIN")) return problem(403, "FORBIDDEN", "Cần quyền Admin");
      const row = state.dlq.find((item) => item.id === params.id);
      if (!row) return problem(404, "DLQ_NOT_FOUND", "Không tìm thấy message");
      if (row.status === "DISCARDED") return problem(409, "DLQ_DISCARDED", "Message đã bị bỏ");
      if (row.status !== "PENDING") {
        return problem(409, "DLQ_REPLAY_STARTED", "Message đã được phát lại");
      }
      // Mock không có Kafka: phát lại coi như xong ngay.
      row.status = action === "replay" ? "REPLAYED" : "DISCARDED";
      row.version += 1;
      row.updated_at = new Date().toISOString();
      return HttpResponse.json({ id: row.id, status: row.status }, { status: 201 });
    }),
  ),
];
