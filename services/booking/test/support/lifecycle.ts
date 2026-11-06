import { randomUUID } from "node:crypto";
import { newMessage, parseMessage } from "@ticketing/event-contracts";
import { Pool } from "pg";

export const lifecycleData = () => ({
  event_id: randomUUID(),
  organizer_id: randomUUID(),
  title: "Synthetic test event",
  start_at: "2026-12-01T00:00:00.000Z",
  end_at: "2026-12-02T00:00:00.000Z",
  event_version: 2,
  seat_map_version: 1,
  ticket_classes: [
    {
      id: randomUUID(),
      name: "Standard",
      price_vnd: 100000,
      capacity: 10,
      kind: "SEATED" as const,
    },
  ],
  sale_phases: [
    {
      starts_at: "2020-01-01T00:00:00.000Z",
      ends_at: "2099-01-01T00:00:00.000Z",
      queue_enabled: false,
      admit_rate: 100,
      per_user_limit: 6,
      require_kyc: false,
    },
  ],
});
export const lifecycleMessage = (
  data = lifecycleData(),
  type: "EventApproved" | "EventUpdated" = "EventApproved",
) => {
  const message = parseMessage(
    newMessage(type, data, { version: 2, tenant_id: data.organizer_id }),
  );
  if (
    (message.type !== "EventApproved" && message.type !== "EventUpdated") ||
    message.version !== 2
  )
    throw new Error("Expected lifecycle snapshot v2");
  return message;
};

export async function seedAllocation(
  pool: Pool,
  options: {
    event: string;
    seat?: string;
    state?: string;
    status?: string;
    expiryMs?: number;
    user?: string;
  },
) {
  const order = randomUUID();
  const user = options.user ?? randomUUID();
  const seat = options.seat ?? randomUUID();
  const expiry = options.expiryMs ?? Date.now() + 60000;
  await pool.query(
    `INSERT INTO orders (id,user_id,event_id,status,ticket_amount_vnd,merch_amount_vnd,total_amount_vnd,idempotency_key,expires_at)
    VALUES ($1::uuid,$2,$3,$4,100000,0,100000,$1::text,$5)`,
    [order, user, options.event, options.status ?? "AWAITING_PAYMENT", new Date(expiry)],
  );
  await pool.query(
    "INSERT INTO seat_allocations (id,order_id,event_id,seat_id,state) VALUES ($1,$2,$3,$4,$5)",
    [randomUUID(), order, options.event, seat, options.state ?? "HELD"],
  );
  return { order, user, seat, expiry };
}
