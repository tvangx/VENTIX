import { InboxProcessor, pgDatabase } from "@ticketing/outbox-inbox";
import { handleEventLifecycle } from "../../src/messaging/event-lifecycle.handler";
import { BookingDb, startBookingDb } from "../support/booking-db";
import { lifecycleData, lifecycleMessage } from "../support/lifecycle";

describe("lifecycle version and duplicate contention", () => {
  let db: BookingDb;
  beforeAll(async () => {
    db = await startBookingDb();
  });
  afterAll(async () => {
    await db?.close();
  });
  it("50 versions in parallel converge on highest snapshot and stock", async () => {
    const data = lifecycleData();
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        pgDatabase(db.pool).transaction((exec) =>
          handleEventLifecycle(
            exec,
            lifecycleMessage({
              ...data,
              event_version: i + 1,
              seat_map_version: i + 1,
              ticket_classes: [{ ...data.ticket_classes[0], capacity: i + 1 }],
            }),
          ),
        ),
      ),
    );
    expect(
      (
        await db.pool.query(
          "SELECT event_version,seat_map_version FROM event_snapshots WHERE event_id=$1",
          [data.event_id],
        )
      ).rows[0],
    ).toEqual({ event_version: 50, seat_map_version: 50 });
    expect(
      (
        await db.pool.query("SELECT total FROM ticket_class_stock WHERE class_id=$1", [
          data.ticket_classes[0].id,
        ])
      ).rows[0].total,
    ).toBe(50);
  });
  it("50 duplicate deliveries run the transactional handler exactly once", async () => {
    const message = lifecycleMessage();
    const deadLetter = jest.fn();
    const processor = new InboxProcessor({
      db: pgDatabase(db.pool),
      consumerName: "contention-test",
      handler: handleEventLifecycle,
      deadLetter,
    });
    const record = {
      topic: "event.lifecycle",
      partition: 0,
      offset: "0",
      key: null,
      value: Buffer.from(JSON.stringify(message)),
    };
    const outcomes = await Promise.all(Array.from({ length: 50 }, () => processor.process(record)));
    expect(outcomes.filter((value) => value === "processed")).toHaveLength(1);
    expect(outcomes.filter((value) => value === "duplicate")).toHaveLength(49);
    expect(deadLetter).not.toHaveBeenCalled();
  });
});
