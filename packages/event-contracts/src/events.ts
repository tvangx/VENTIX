import { z } from "zod";
import { envelope } from "./envelope";
import { Topics } from "./topics";

// ---- kiểu dùng chung ----
const id = z.string().uuid();
const iso = z.string().datetime();
const vnd = z.number().int().nonnegative(); // VND, không số thực
const qty = z.number().int().positive();

// ===================== event.lifecycle =====================
export const EventApproved = envelope(
  "EventApproved",
  z.object({
    event_id: id,
    organizer_id: id,
    title: z.string(),
    start_at: iso,
    end_at: iso,
    event_version: z.number().int(),
    ticket_classes: z.array(
      z.object({
        id,
        name: z.string(),
        price_vnd: vnd,
        capacity: qty,
        kind: z.enum(["SEATED", "GA"]),
      }),
    ),
    sale_phases: z.array(
      z.object({
        starts_at: iso,
        ends_at: iso,
        queue_enabled: z.boolean(),
        admit_rate: qty,
        per_user_limit: qty,
        require_kyc: z.boolean(),
      }),
    ),
  }),
);

export const EventUpdated = envelope(
  "EventUpdated",
  z.object({ event_id: id, organizer_id: id, event_version: z.number().int() }),
);

export const EventCancelled = envelope(
  "EventCancelled",
  z.object({ event_id: id, organizer_id: id, reason: z.string() }),
);

// ===================== booking.orders =====================
// item_type: TICKET_SEAT => ref_id là seat_id, quantity = 1 · TICKET_GA => ref_id là ticket_class_id
//            MERCH => ref_id là sku_id · COMBO được giữ trong enum cho tương lai: booking KHÔNG phát COMBO (ADR-0010).
export const OrderCreated = envelope(
  "OrderCreated",
  z.object({
    order_id: id,
    user_id: id,
    event_id: id,
    items: z.array(
      z.object({
        item_type: z.enum(["TICKET_SEAT", "TICKET_GA", "MERCH", "COMBO"]),
        ref_id: id,
        quantity: qty,
        unit_price_vnd: vnd,
        combo_id: id.optional(),
      }),
    ),
    ticket_amount_vnd: vnd,
    merch_amount_vnd: vnd,
    total_amount_vnd: vnd,
    expires_at: iso,
  }),
);

/** Order đã sẵn sàng thanh toán: payment-service dựng read-model `payable_orders` từ sự kiện này (ADR-0009, C1). */
export const OrderAwaitingPayment = envelope(
  "OrderAwaitingPayment",
  z.object({
    order_id: id,
    user_id: id,
    event_id: id,
    amount_vnd: vnd,
    expires_at: iso,
  }),
);

/**
 * Điểm kích hoạt SAU thanh toán (ADR-0009, C2): ticket phát vé, merch commit kho, finance ghi doanh thu,
 * notification gửi thông báo. Chỉ phát khi ghế đã chuyển SOLD trong booking_db.
 * `unit_price_vnd` là giá thực thu (đã trừ giảm giá nếu có) nên tổng tiền luôn khớp các dòng.
 */
export const OrderConfirmed = envelope(
  "OrderConfirmed",
  z
    .object({
      order_id: id,
      user_id: id,
      event_id: id,
      payment_id: id,
      items: z
        .array(
          z.object({
            order_item_id: id,
            item_type: z.enum(["TICKET_SEAT", "TICKET_GA", "MERCH"]),
            ref_id: id,
            quantity: qty,
            unit_price_vnd: vnd,
            combo_id: id.optional(),
          }),
        )
        .min(1),
      ticket_amount_vnd: vnd,
      merch_amount_vnd: vnd,
      total_amount_vnd: vnd,
      confirmed_at: iso,
    })
    .superRefine((d, ctx) => {
      const sum = (types: string[]) =>
        d.items
          .filter((i) => types.includes(i.item_type))
          .reduce((acc, i) => acc + i.quantity * i.unit_price_vnd, 0);
      if (sum(["TICKET_SEAT", "TICKET_GA"]) !== d.ticket_amount_vnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ticket_amount_vnd"],
          message: "ticket_amount_vnd must equal the sum of ticket items",
        });
      }
      if (sum(["MERCH"]) !== d.merch_amount_vnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["merch_amount_vnd"],
          message: "merch_amount_vnd must equal the sum of merch items",
        });
      }
      if (d.ticket_amount_vnd + d.merch_amount_vnd !== d.total_amount_vnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["total_amount_vnd"],
          message: "total_amount_vnd must equal ticket_amount_vnd + merch_amount_vnd",
        });
      }
      d.items.forEach((i, idx) => {
        if (i.item_type === "TICKET_SEAT" && i.quantity !== 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["items", idx, "quantity"],
            message: "TICKET_SEAT quantity must be 1",
          });
        }
      });
    }),
);

export const OrderExpired = envelope("OrderExpired", z.object({ order_id: id, event_id: id }));

export const OrderCancelled = envelope(
  "OrderCancelled",
  z.object({
    order_id: id,
    event_id: id,
    reason: z.enum([
      "PAYMENT_FAILED",
      "STOCK_REJECTED",
      "USER_CANCELLED",
      "EVENT_CANCELLED",
      "EXPIRED",
      "LATE_PAYMENT",
    ]),
  }),
);

// ===================== merch.stock =====================
export const StockReserved = envelope(
  "StockReserved",
  z.object({
    order_id: id,
    reservations: z.array(z.object({ sku_id: id, quantity: qty })),
  }),
);

export const StockRejected = envelope(
  "StockRejected",
  z.object({ order_id: id, sku_id: id, reason: z.string() }),
);

export const StockCommitted = envelope("StockCommitted", z.object({ order_id: id }));

export const StockLow = envelope(
  "StockLow",
  z.object({
    sku_id: id,
    organizer_id: id,
    on_hand: z.number().int(),
    threshold: z.number().int(),
  }),
);

// ===================== payment.events =====================
export const PaymentSucceeded = envelope(
  "PaymentSucceeded",
  z.object({
    payment_id: id,
    purpose: z.enum(["ORDER", "RESALE"]),
    order_id: id.optional(), // purpose = ORDER
    resale_order_id: id.optional(), // purpose = RESALE
    amount_vnd: vnd,
    provider: z.enum(["VNPAY", "MOMO", "MOCK"]),
    provider_txn_id: z.string(),
    paid_at: iso,
  }),
);

export const PaymentFailed = envelope(
  "PaymentFailed",
  z.object({
    payment_id: id,
    purpose: z.enum(["ORDER", "RESALE"]),
    order_id: id.optional(),
    resale_order_id: id.optional(),
    reason: z.string(),
  }),
);

export const RefundCompleted = envelope(
  "RefundCompleted",
  z.object({
    refund_id: id,
    payment_id: id,
    order_id: id,
    amount_vnd: vnd,
    batch_id: id.optional(),
  }),
);

// ===================== ticket.events =====================
export const TicketIssued = envelope(
  "TicketIssued",
  z.object({
    ticket_id: id,
    order_id: id,
    order_item_id: id,
    event_id: id,
    seat_id: id.nullable(),
    owner_user_id: id,
  }),
);

export const TicketTransferred = envelope(
  "TicketTransferred",
  z.object({
    ticket_id: id,
    from_user_id: id,
    to_user_id: id,
    secret_version: z.number().int().positive(),
    resale_order_id: id,
  }),
);

export const TicketRevoked = envelope(
  "TicketRevoked",
  z.object({
    ticket_id: id,
    reason: z.enum(["REFUNDED", "TRANSFERRED", "ADMIN", "EVENT_CANCELLED"]),
  }),
);

export const TicketCheckedIn = envelope(
  "TicketCheckedIn",
  z.object({
    ticket_id: id,
    event_id: id,
    gate_id: id,
    scanned_at: iso,
    offline: z.boolean(),
  }),
);

// ===================== resale.events =====================
export const ListingCreated = envelope(
  "ListingCreated",
  z.object({
    listing_id: id,
    ticket_id: id,
    seller_id: id,
    event_id: id,
    ask_price_vnd: vnd,
  }),
);

export const ListingCancelled = envelope(
  "ListingCancelled",
  z.object({ listing_id: id, ticket_id: id }),
);

export const ResaleCompleted = envelope(
  "ResaleCompleted",
  z.object({
    resale_order_id: id,
    listing_id: id,
    ticket_id: id,
    seller_id: id,
    buyer_id: id,
    amount_vnd: vnd,
  }),
);

// ===================== audit.events =====================
export const AuditRecorded = envelope(
  "AuditRecorded",
  z.object({
    actor_id: id.nullable(),
    action: z.string(),
    resource_type: z.string(),
    resource_id: z.string(),
    before_state: z.unknown().optional(),
    after_state: z.unknown().optional(),
  }),
);

// ===================== registry =====================
export const eventSchemas = {
  EventApproved,
  EventUpdated,
  EventCancelled,
  OrderCreated,
  OrderAwaitingPayment,
  OrderConfirmed,
  OrderExpired,
  OrderCancelled,
  StockReserved,
  StockRejected,
  StockCommitted,
  StockLow,
  PaymentSucceeded,
  PaymentFailed,
  RefundCompleted,
  TicketIssued,
  TicketTransferred,
  TicketRevoked,
  TicketCheckedIn,
  ListingCreated,
  ListingCancelled,
  ResaleCompleted,
  AuditRecorded,
} as const;

export type EventType = keyof typeof eventSchemas;

/** Loại sự kiện nào đi vào topic nào (producer PHẢI publish đúng topic). */
export const topicOf: Record<EventType, string> = {
  EventApproved: Topics.EVENT_LIFECYCLE,
  EventUpdated: Topics.EVENT_LIFECYCLE,
  EventCancelled: Topics.EVENT_LIFECYCLE,
  OrderCreated: Topics.BOOKING_ORDERS,
  OrderAwaitingPayment: Topics.BOOKING_ORDERS,
  OrderConfirmed: Topics.BOOKING_ORDERS,
  OrderExpired: Topics.BOOKING_ORDERS,
  OrderCancelled: Topics.BOOKING_ORDERS,
  StockReserved: Topics.MERCH_STOCK,
  StockRejected: Topics.MERCH_STOCK,
  StockCommitted: Topics.MERCH_STOCK,
  StockLow: Topics.MERCH_STOCK,
  PaymentSucceeded: Topics.PAYMENT_EVENTS,
  PaymentFailed: Topics.PAYMENT_EVENTS,
  RefundCompleted: Topics.PAYMENT_EVENTS,
  TicketIssued: Topics.TICKET_EVENTS,
  TicketTransferred: Topics.TICKET_EVENTS,
  TicketRevoked: Topics.TICKET_EVENTS,
  TicketCheckedIn: Topics.TICKET_EVENTS,
  ListingCreated: Topics.RESALE_EVENTS,
  ListingCancelled: Topics.RESALE_EVENTS,
  ResaleCompleted: Topics.RESALE_EVENTS,
  AuditRecorded: Topics.AUDIT_EVENTS,
};

export type EventMessage<T extends EventType> = z.infer<(typeof eventSchemas)[T]>;

/** Parse + validate 1 message thô từ Kafka. Ném lỗi nếu type lạ hoặc sai schema. */
export function parseMessage(raw: unknown): { [K in EventType]: EventMessage<K> }[EventType] {
  const type = (raw as { type?: string } | null)?.type;
  if (!type || !(type in eventSchemas)) {
    throw new Error(`Unknown event type: ${String(type)}`);
  }
  return eventSchemas[type as EventType].parse(raw) as never;
}
