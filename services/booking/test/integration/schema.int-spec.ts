import { randomUUID } from "node:crypto";
import { BookingDb, startBookingDb } from "../support/booking-db";

describe("booking schema (Postgres constraints)", () => {
  let db: BookingDb;
  beforeAll(async () => {
    db = await startBookingDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  const order = async (status = "PENDING") => {
    const id = randomUUID();
    await db.pool.query(
      `INSERT INTO orders (id, user_id, event_id, status, ticket_amount_vnd,
        merch_amount_vnd, total_amount_vnd, idempotency_key, expires_at)
       VALUES ($1, $2, $3, $4, 100000, 0, 100000, $5, now() + interval '15 minutes')`,
      [id, randomUUID(), randomUUID(), status, id],
    );
    return id;
  };

  const allocate = (orderId: string, eventId: string, seatId: string, state = "HELD") =>
    db.pool.query(
      "INSERT INTO seat_allocations (id, order_id, event_id, seat_id, state) VALUES ($1,$2,$3,$4,$5)",
      [randomUUID(), orderId, eventId, seatId, state],
    );

  it("deploys the migration from an empty DB using a non-superuser booking_user", async () => {
    expect(db.migrationOutput).toContain("All migrations have been successfully applied");
    const role = await db.pool.query(
      "SELECT current_user, current_database(), rolsuper, rolcreatedb FROM pg_roles WHERE rolname = current_user",
    );
    expect(role.rows).toEqual([
      {
        current_user: "booking_user",
        current_database: "booking_db",
        rolsuper: false,
        rolcreatedb: false,
      },
    ]);
    const tables = await db.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY table_name",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "event_snapshots",
      "idempotency_keys",
      "order_items",
      "orders",
      "outbox_events",
      "processed_events",
      "seat_allocations",
      "seat_pricing",
      "ticket_class_stock",
      "voucher_redemptions",
      "vouchers",
    ]);
  });

  it("rejects a second HELD allocation with 23505 and allows reuse after RELEASED", async () => {
    const first = await order();
    const second = await order();
    const event = randomUUID();
    const seat = randomUUID();
    await allocate(first, event, seat);
    await expect(allocate(second, event, seat)).rejects.toMatchObject({
      code: "23505",
      constraint: "uq_seat_active",
    });
    await db.pool.query("UPDATE seat_allocations SET state = 'RELEASED' WHERE order_id = $1", [
      first,
    ]);
    await expect(allocate(second, event, seat)).resolves.toMatchObject({ rowCount: 1 });
  });

  it.each(["HELD", "SOLD"])(
    "blocks a HELD allocation when an existing allocation is %s",
    async (state) => {
      const event = randomUUID();
      const seat = randomUUID();
      await allocate(await order(), event, seat, state);
      await expect(allocate(await order(), event, seat)).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_seat_active",
      });
    },
  );

  it("scopes active seat uniqueness to the event", async () => {
    const seat = randomUUID();
    await allocate(await order(), randomUUID(), seat);
    await expect(allocate(await order(), randomUUID(), seat)).resolves.toMatchObject({
      rowCount: 1,
    });
  });

  it("rejects an unknown seat state", async () => {
    await expect(
      allocate(await order(), randomUUID(), randomUUID(), "UNKNOWN"),
    ).rejects.toMatchObject({ code: "23514", constraint: "ck_seat_alloc_state" });
  });

  it.each([-1, 11])("rejects stock sold=%i outside [0, total]", async (sold) => {
    await expect(
      db.pool.query("INSERT INTO ticket_class_stock (class_id, total, sold) VALUES ($1, 10, $2)", [
        randomUUID(),
        sold,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "ck_stock_range" });
  });

  it("accepts stock boundaries and rejects an UPDATE above total", async () => {
    const id = randomUUID();
    await db.pool.query(
      "INSERT INTO ticket_class_stock (class_id, total, sold) VALUES ($1, 10, 0)",
      [id],
    );
    await db.pool.query("UPDATE ticket_class_stock SET sold = 10 WHERE class_id = $1", [id]);
    await expect(
      db.pool.query("UPDATE ticket_class_stock SET sold = 11 WHERE class_id = $1", [id]),
    ).rejects.toMatchObject({ code: "23514", constraint: "ck_stock_range" });
  });

  it.each(["COMBO", "UNKNOWN"])("rejects item_type=%s", async (type) => {
    await expect(
      db.pool.query(
        "INSERT INTO order_items (id, order_id, item_type, ref_id, quantity, unit_price_vnd) VALUES ($1,$2,$3,$4,1,100000)",
        [randomUUID(), await order(), type, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "ck_order_items_type" });
  });

  it.each(["TICKET_SEAT", "TICKET_GA", "MERCH"])("accepts item_type=%s", async (type) => {
    await expect(
      db.pool.query(
        "INSERT INTO order_items (id, order_id, item_type, ref_id, quantity, unit_price_vnd) VALUES ($1,$2,$3,$4,1,100000)",
        [randomUUID(), await order(), type, randomUUID()],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it("rejects an unknown order status", async () => {
    await expect(order("UNKNOWN")).rejects.toMatchObject({
      code: "23514",
      constraint: "ck_orders_status",
    });
  });

  it.each([
    "PENDING",
    "AWAITING_PAYMENT",
    "CONFIRMED",
    "EXPIRED",
    "FAILED",
    "CANCELLED",
    "REFUND_REQUIRED",
    "REFUNDED",
  ])("accepts order status %s", async (status) => {
    await expect(order(status)).resolves.toEqual(expect.any(String));
  });

  it("defaults pricing_ready to false and enforces the composite seat_pricing key", async () => {
    const event = randomUUID();
    const seat = randomUUID();
    const snapshot = await db.pool.query(
      "INSERT INTO event_snapshots (event_id, organizer_id, status, event_version, seat_map_version, ticket_classes, sale_window) VALUES ($1,$2,'APPROVED',1,1,'[]','{}') RETURNING pricing_ready",
      [event, randomUUID()],
    );
    expect(snapshot.rows[0].pricing_ready).toBe(false);
    const insert = () =>
      db.pool.query(
        "INSERT INTO seat_pricing (event_id, seat_id, seat_map_version, ticket_class_id) VALUES ($1,$2,1,$3)",
        [event, seat, randomUUID()],
      );
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: "23505" });
  });

  it("enforces order idempotency and inbox composite uniqueness", async () => {
    const id = await order();
    await expect(
      db.pool.query("UPDATE orders SET idempotency_key = $1 WHERE id = $2", [id, await order()]),
    ).rejects.toMatchObject({ code: "23505" });
    const message = randomUUID();
    await db.pool.query(
      "INSERT INTO processed_events (message_id, consumer) VALUES ($1, 'booking')",
      [message],
    );
    await expect(
      db.pool.query("INSERT INTO processed_events (message_id, consumer) VALUES ($1, 'booking')", [
        message,
      ]),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      db.pool.query(
        "INSERT INTO processed_events (message_id, consumer) VALUES ($1, 'another-consumer')",
        [message],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it("rolls back business and outbox writes in the same transaction", async () => {
    const client = await db.pool.connect();
    const id = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO idempotency_keys (key, user_id, request_hash, response) VALUES ($1,$2,'hash','{}')",
        [id, randomUUID()],
      );
      await client.query(
        "INSERT INTO outbox_events (id, topic, message_key, event_type, payload) VALUES ($1,'booking.orders',$2,'OrderCreated','{}')",
        [id, id],
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    expect(
      (await db.pool.query("SELECT key FROM idempotency_keys WHERE key=$1", [id])).rowCount,
    ).toBe(0);
    expect((await db.pool.query("SELECT id FROM outbox_events WHERE id=$1", [id])).rowCount).toBe(
      0,
    );
  });
});
