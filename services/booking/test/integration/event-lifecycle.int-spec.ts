import { randomUUID } from "node:crypto";
import { newMessage, parseMessage } from "@ticketing/event-contracts";
import { InboxProcessor, pgDatabase } from "@ticketing/outbox-inbox";
import { handleEventLifecycle } from "../../src/messaging/event-lifecycle.handler";
import { BookingDb, startBookingDb } from "../support/booking-db";
import { lifecycleData, lifecycleMessage } from "../support/lifecycle";

describe("lifecycle snapshot and Inbox transaction (PostgreSQL)", () => {
  let db: BookingDb;
  beforeAll(async () => {
    db = await startBookingDb();
  });
  afterAll(async () => {
    await db?.close();
  });
  const apply = (
    data = lifecycleData(),
    type: "EventApproved" | "EventUpdated" = "EventApproved",
  ) =>
    pgDatabase(db.pool).transaction((exec) =>
      handleEventLifecycle(exec, lifecycleMessage(data, type)),
    );

  it("applies newer full snapshots, ignores older/equal versions including stock", async () => {
    const data = lifecycleData();
    await apply(data);
    await apply(
      {
        ...data,
        event_version: 5,
        seat_map_version: 2,
        ticket_classes: [{ ...data.ticket_classes[0], capacity: 20 }],
      },
      "EventUpdated",
    );
    await apply({ ...data, event_version: 3 });
    await apply({ ...data, event_version: 5 });
    expect(
      (await db.pool.query("SELECT * FROM event_snapshots WHERE event_id=$1", [data.event_id]))
        .rows[0],
    ).toMatchObject({
      event_version: 5,
      seat_map_version: 2,
      pricing_ready: false,
      ticket_classes: [{ ...data.ticket_classes[0], capacity: 20 }],
    });
    expect(
      (
        await db.pool.query("SELECT total FROM ticket_class_stock WHERE class_id=$1", [
          data.ticket_classes[0].id,
        ])
      ).rows[0].total,
    ).toBe(20);
  });
  it("never reduces total below sold; preserves ready only when seat map is unchanged", async () => {
    const data = lifecycleData();
    await apply(data);
    await db.pool.query("UPDATE ticket_class_stock SET sold=8 WHERE class_id=$1", [
      data.ticket_classes[0].id,
    ]);
    await db.pool.query("UPDATE event_snapshots SET pricing_ready=true WHERE event_id=$1", [
      data.event_id,
    ]);
    await apply(
      { ...data, event_version: 3, ticket_classes: [{ ...data.ticket_classes[0], capacity: 3 }] },
      "EventUpdated",
    );
    expect(
      (
        await db.pool.query("SELECT total,sold FROM ticket_class_stock WHERE class_id=$1", [
          data.ticket_classes[0].id,
        ])
      ).rows[0],
    ).toEqual({ total: 8, sold: 8 });
    expect(
      (
        await db.pool.query("SELECT pricing_ready FROM event_snapshots WHERE event_id=$1", [
          data.event_id,
        ])
      ).rows[0].pricing_ready,
    ).toBe(true);
    await apply({ ...data, event_version: 4, seat_map_version: 2 }, "EventUpdated");
    expect(
      (
        await db.pool.query("SELECT pricing_ready FROM event_snapshots WHERE event_id=$1", [
          data.event_id,
        ])
      ).rows[0].pricing_ready,
    ).toBe(false);
  });
  it("a cancellation arriving before approval creates a versioned tombstone", async () => {
    const data = lifecycleData();
    const cancelled = parseMessage(
      newMessage(
        "EventCancelled",
        { ...data, event_version: 9, reason: "Synthetic cancellation" },
        { version: 2 },
      ),
    );
    await pgDatabase(db.pool).transaction((exec) => handleEventLifecycle(exec, cancelled));
    await apply(data);
    expect(
      (
        await db.pool.query(
          "SELECT status,event_version,pricing_ready FROM event_snapshots WHERE event_id=$1",
          [data.event_id],
        )
      ).rows[0],
    ).toEqual({ status: "CANCELLED", event_version: 9, pricing_ready: false });
    expect(
      (
        await db.pool.query("SELECT * FROM ticket_class_stock WHERE class_id=$1", [
          data.ticket_classes[0].id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("cancellation preserves known map and blocks sales without touching stock", async () => {
    const data = lifecycleData();
    await apply(data);
    await pgDatabase(db.pool).transaction((exec) =>
      handleEventLifecycle(
        exec,
        parseMessage(
          newMessage(
            "EventCancelled",
            {
              event_id: data.event_id,
              organizer_id: data.organizer_id,
              event_version: 3,
              reason: "Cancelled",
            },
            { version: 2 },
          ),
        ),
      ),
    );
    expect(
      (
        await db.pool.query(
          "SELECT status,seat_map_version,ticket_classes FROM event_snapshots WHERE event_id=$1",
          [data.event_id],
        )
      ).rows[0],
    ).toMatchObject({
      status: "CANCELLED",
      seat_map_version: 1,
      ticket_classes: data.ticket_classes,
    });
  });
  it("processes duplicate once; rolls back Inbox and snapshot together on SQL failure", async () => {
    const data = lifecycleData();
    const message = lifecycleMessage(data);
    const deadLetter = jest.fn();
    const processor = new InboxProcessor({
      db: pgDatabase(db.pool),
      consumerName: "transaction-test",
      handler: handleEventLifecycle,
      deadLetter,
      maxAttempts: 1,
    });
    const record = {
      topic: "event.lifecycle",
      partition: 0,
      offset: "0",
      key: null,
      value: Buffer.from(JSON.stringify(message)),
    };
    expect(await processor.process(record)).toBe("processed");
    expect(await processor.process(record)).toBe("duplicate");
    expect(
      (
        await db.pool.query("SELECT version FROM ticket_class_stock WHERE class_id=$1", [
          data.ticket_classes[0].id,
        ])
      ).rows[0].version,
    ).toBe(0);
    const invalid = lifecycleMessage({
      ...lifecycleData(),
      ticket_classes: [{ ...data.ticket_classes[0], id: randomUUID(), capacity: 2147483648 }],
    });
    expect(
      await processor.process({ ...record, value: Buffer.from(JSON.stringify(invalid)) }),
    ).toBe("dead-lettered");
    expect(deadLetter).toHaveBeenCalledTimes(1);
    expect(
      (
        await db.pool.query("SELECT * FROM processed_events WHERE message_id=$1", [
          invalid.message_id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.pool.query("SELECT * FROM event_snapshots WHERE event_id=$1", [
          invalid.data.event_id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("rejects changing a snapshot organizer, even with a newer version", async () => {
    const data = lifecycleData();
    await apply(data);
    await expect(apply({ ...data, organizer_id: randomUUID(), event_version: 3 })).rejects.toThrow(
      /organizer/,
    );
  });
});
