/** Tên topic + số partition. Khớp infra/kafka/create-topics.sh và Tài liệu KT mục 4. */
export const Topics = {
  EVENT_LIFECYCLE: "event.lifecycle", // key: event_id
  BOOKING_ORDERS: "booking.orders", // key: order_id
  MERCH_STOCK: "merch.stock", // key: sku_id
  PAYMENT_EVENTS: "payment.events", // key: order_id
  TICKET_EVENTS: "ticket.events", // key: ticket_id
  RESALE_EVENTS: "resale.events", // key: listing_id
  AUDIT_EVENTS: "audit.events", // key: resource_id
} as const;

export type Topic = (typeof Topics)[keyof typeof Topics];

export const dlq = (topic: Topic): string => `${topic}.dlq`;

export const TopicPartitions: Record<Topic, number> = {
  [Topics.BOOKING_ORDERS]: 6,
  [Topics.PAYMENT_EVENTS]: 6,
  [Topics.EVENT_LIFECYCLE]: 3,
  [Topics.MERCH_STOCK]: 3,
  [Topics.TICKET_EVENTS]: 3,
  [Topics.RESALE_EVENTS]: 3,
  [Topics.AUDIT_EVENTS]: 3,
};
