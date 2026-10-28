import { randomUUID } from "node:crypto";
import { BookingDb, startBookingDb } from "../support/booking-db";

describe("seat allocation contention (Postgres)", () => {
  let db: BookingDb;
  beforeAll(async () => {
    db = await startBookingDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  it("allows exactly one of 50 concurrent allocations for the same event/seat", async () => {
    const event = randomUUID();
    const seat = randomUUID();
    const orders = Array.from({ length: 50 }, () => randomUUID());
    await Promise.all(
      orders.map((id) =>
        db.pool.query(
          `INSERT INTO orders (id,user_id,event_id,status,ticket_amount_vnd,merch_amount_vnd,total_amount_vnd,idempotency_key,expires_at)
       VALUES ($1,$2,$3,'PENDING',100000,0,100000,$4,now() + interval '15 minutes')`,
          [id, randomUUID(), event, id],
        ),
      ),
    );
    const results = await Promise.allSettled(
      orders.map((id) =>
        db.pool.query(
          "INSERT INTO seat_allocations (id,order_id,event_id,seat_id,state) VALUES ($1,$2,$3,$4,'HELD')",
          [randomUUID(), id, event, seat],
        ),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failures = results.filter((result) => result.status === "rejected");
    expect(failures).toHaveLength(49);
    for (const result of failures) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "23505", constraint: "uq_seat_active" });
      }
    }
    const active = await db.pool.query(
      "SELECT id FROM seat_allocations WHERE event_id=$1 AND seat_id=$2 AND state IN ('HELD','SOLD')",
      [event, seat],
    );
    expect(active.rowCount).toBe(1);
  });
});
