import { randomUUID } from "node:crypto";
import { newMessage, parseMessage } from "@ticketing/event-contracts";
import { confirmedOrder, fixture } from "../support/ticket";

describe("S-301 issuance with PostgreSQL", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture();
  });
  afterAll(async () => {
    await context?.close();
  });

  it("issues seated and GA units, encrypts secrets and writes contract-valid outbox atomically", async () => {
    const order = confirmedOrder();
    expect(await context.deliver(order)).toBe("processed");
    const rows = await context.repo.pool.query(
      `SELECT ticket.*, secret.secret_enc, secret.key_id FROM tickets ticket
       JOIN ticket_secrets secret ON secret.ticket_id=ticket.id WHERE order_id=$1`,
      [order.data.order_id],
    );
    expect(rows.rowCount).toBe(4);
    expect(rows.rows.filter((row) => row.seat_id !== null)).toHaveLength(1);
    const plaintexts: string[] = [];
    for (const row of rows.rows) {
      expect(row.owner_user_id).toBe(order.data.user_id);
      expect(row.organizer_id).toBe(order.tenant_id);
      expect(row.status).toBe("ACTIVE");
      const plaintext = context.secrets.decrypt(row.id, 1, {
        keyId: row.key_id,
        ciphertext: row.secret_enc,
      });
      expect(plaintext.length).toBe(20);
      plaintexts.push(plaintext.toString("hex"));
    }
    expect(new Set(plaintexts).size).toBe(4);
    const events = await context.repo.pool.query(
      "SELECT * FROM outbox_events WHERE payload->'data'->>'order_id'=$1",
      [order.data.order_id],
    );
    expect(events.rowCount).toBe(4);
    for (const event of events.rows) {
      expect(parseMessage(event.payload).type).toBe("TicketIssued");
      expect(event.topic).toBe("ticket.events");
      expect(event.message_key).toBe(event.payload.data.ticket_id);
      expect(event.payload.trace_id).toBe(order.trace_id);
      expect(JSON.stringify(event.payload)).not.toMatch(/secret|key_id/);
    }
    expect(await context.deliver(order)).toBe("duplicate");
    expect(
      await context.deliver({
        ...order,
        message_id: randomUUID(),
        data: { ...order.data, items: [...order.data.items].reverse() },
      }),
    ).toBe("processed");
    expect(
      (
        await context.repo.pool.query("SELECT id FROM tickets WHERE order_id=$1", [
          order.data.order_id,
        ])
      ).rowCount,
    ).toBe(4);
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM outbox_events WHERE payload->'data'->>'order_id'=$1",
          [order.data.order_id],
        )
      ).rowCount,
    ).toBe(4);
  });

  it("rejects conflicting business replays without issuing extra tickets", async () => {
    const order = confirmedOrder();
    expect(await context.deliver(order)).toBe("processed");
    const replay = {
      ...order,
      message_id: randomUUID(),
      data: { ...order.data, user_id: randomUUID() },
    };
    expect(await context.deliver(replay)).toBe("dead-lettered");
    expect(context.dead.at(-1)?.error).toBe("PermanentError: ORDER_CONFIRMATION_CONFLICT");
    expect(
      (
        await context.repo.pool.query("SELECT * FROM processed_events WHERE message_id=$1", [
          replay.message_id,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("rolls back tickets, secrets, receipt and inbox when outbox insertion fails; retry recovers", async () => {
    const order = confirmedOrder();
    await context.admin.query(
      "ALTER TABLE outbox_events ADD CONSTRAINT synthetic_failure CHECK (event_type <> 'TicketIssued') NOT VALID",
    );
    try {
      expect(await context.deliver(order)).toBe("dead-lettered");
      for (const table of ["tickets", "ticket_issuances"]) {
        expect(
          (
            await context.repo.pool.query(`SELECT * FROM ${table} WHERE order_id=$1`, [
              order.data.order_id,
            ])
          ).rowCount,
        ).toBe(0);
      }
      expect(
        (
          await context.repo.pool.query("SELECT * FROM processed_events WHERE message_id=$1", [
            order.message_id,
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      await context.admin.query("ALTER TABLE outbox_events DROP CONSTRAINT synthetic_failure");
    }
    expect(await context.deliver(order)).toBe("processed");
  });

  it("rejects duplicate item ids and malformed messages before any business writes", async () => {
    const order = confirmedOrder();
    order.data.items[1].order_item_id = order.data.items[0].order_item_id;
    expect(await context.deliver(order)).toBe("dead-lettered");
    expect(context.dead.at(-1)?.error).toBe("PermanentError: DUPLICATE_ORDER_ITEM");
    expect(await context.deliver({ ...confirmedOrder(), version: 99 })).toBe("dead-lettered");
    expect(
      (
        await context.repo.pool.query("SELECT * FROM ticket_issuances WHERE order_id=$1", [
          order.data.order_id,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("does not issue for merch-only orders or unrelated valid booking events", async () => {
    const order = confirmedOrder();
    const merch = {
      ...order,
      data: {
        ...order.data,
        items: [order.data.items[2]],
        ticket_amount_vnd: 0,
        total_amount_vnd: 50,
      },
    };
    expect(await context.deliver(merch)).toBe("processed");
    expect(
      (
        await context.repo.pool.query("SELECT * FROM tickets WHERE order_id=$1", [
          order.data.order_id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      await context.deliver(
        newMessage("OrderExpired", { order_id: randomUUID(), event_id: randomUUID() }),
      ),
    ).toBe("processed");
  });

  it("accepts an absent optional tenant without inventing organizer or seat-class data", async () => {
    const order = { ...confirmedOrder(), tenant_id: undefined };
    expect(await context.deliver(order)).toBe("processed");
    const result = await context.repo.pool.query(
      "SELECT organizer_id, ref_id, seat_id FROM tickets WHERE order_id=$1 AND item_type='TICKET_SEAT'",
      [order.data.order_id],
    );
    expect(result.rows[0]).toEqual({
      organizer_id: null,
      ref_id: order.data.items[0].ref_id,
      seat_id: order.data.items[0].ref_id,
    });
  });

  it("enforces positive version/unit and unique secret version in PostgreSQL", async () => {
    const order = confirmedOrder();
    await context.deliver(order);
    const ticket = (
      await context.repo.pool.query("SELECT id FROM tickets WHERE order_id=$1 LIMIT 1", [
        order.data.order_id,
      ])
    ).rows[0];
    await expect(
      context.repo.pool.query("UPDATE tickets SET unit_index=0 WHERE id=$1", [ticket.id]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      context.repo.pool.query("UPDATE tickets SET status='UNKNOWN' WHERE id=$1", [ticket.id]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      context.repo.pool.query(
        "INSERT INTO ticket_secrets SELECT $2, ticket_id, version, secret_enc, key_id, revoked_at, created_at FROM ticket_secrets WHERE ticket_id=$1",
        [ticket.id, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
