import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pgDatabase } from "@ticketing/outbox-inbox";
import { handleEventLifecycle } from "../../src/messaging/event-lifecycle.handler";
import {
  SeatClassesClient,
  SeatClassesPage,
} from "../../src/seat-pricing/event-seat-classes.client";
import { SeatPricingPrefetch } from "../../src/seat-pricing/seat-pricing-prefetch";
import { seedSeatPricing } from "../../src/tools/pricing-seed";
import { BookingDb, startBookingDb } from "../support/booking-db";
import { lifecycleData, lifecycleMessage } from "../support/lifecycle";

describe("seat pricing prefetch (PostgreSQL)", () => {
  let db: BookingDb;
  beforeAll(async () => {
    db = await startBookingDb();
  });
  afterAll(async () => {
    await db?.close();
  });
  const apply = (data: ReturnType<typeof lifecycleData>) =>
    pgDatabase(db.pool).transaction((exec) => handleEventLifecycle(exec, lifecycleMessage(data)));
  const state = async (event: string) =>
    (
      await db.pool.query(
        `SELECT pricing_ready,seat_map_version,(SELECT count(*)::int FROM seat_pricing WHERE event_id=$1) AS seats
     FROM event_snapshots WHERE event_id=$1`,
        [event],
      )
    ).rows[0];

  it("loads 10,000 seats across 10 pages; failure/restart is complete, atomic and idempotent", async () => {
    const data = lifecycleData();
    await apply(data);
    const seats = Array.from({ length: 10000 }, () => ({
      seat_id: randomUUID(),
      ticket_class_id: data.ticket_classes[0].id,
    }));
    let fail = true;
    let calls = 0;
    const client: SeatClassesClient = {
      page: async (event, version, cursor) => {
        calls++;
        expect(await state(event)).toEqual({ pricing_ready: false, seat_map_version: 1, seats: 0 });
        const offset = Number(cursor ?? 0);
        if (fail && offset === 5000) throw new Error("Interrupted on page 6");
        return {
          event_id: event,
          seat_map_version: version,
          seats: seats.slice(offset, offset + 1000),
          next_cursor: offset < 9000 ? String(offset + 1000) : null,
        };
      },
    };
    const job = new SeatPricingPrefetch(db.pool, client);
    await expect(job.run(data.event_id, 1)).rejects.toThrow("Interrupted");
    expect(await state(data.event_id)).toEqual({
      pricing_ready: false,
      seat_map_version: 1,
      seats: 0,
    });
    fail = false;
    expect(await job.run(data.event_id, 1)).toBe(true);
    expect(calls).toBe(16);
    expect(await state(data.event_id)).toEqual({
      pricing_ready: true,
      seat_map_version: 1,
      seats: 10000,
    });
    expect(await job.run(data.event_id, 1)).toBe(false);
    expect(calls).toBe(16);
    expect(
      (
        await db.pool.query(
          "SELECT count(DISTINCT seat_id)::int AS n FROM seat_pricing WHERE event_id=$1",
          [data.event_id],
        )
      ).rows[0].n,
    ).toBe(10000);
  });

  it("rolls back all batches and readiness on SQL failure", async () => {
    const data = lifecycleData();
    await apply(data);
    const seats: SeatClassesPage["seats"] = Array.from({ length: 1001 }, () => ({
      seat_id: randomUUID(),
      ticket_class_id: data.ticket_classes[0].id,
    }));
    // Client doubles can bypass HTTP validation; invalid UUID fails in the second SQL batch.
    seats[1000].seat_id = "invalid";
    const job = new SeatPricingPrefetch(db.pool, {
      page: async () => ({
        event_id: data.event_id,
        seat_map_version: 1,
        seats,
        next_cursor: null,
      }),
    });
    await expect(job.run(data.event_id, 1)).rejects.toThrow();
    expect(await state(data.event_id)).toEqual({
      pricing_ready: false,
      seat_map_version: 1,
      seats: 0,
    });
  });

  it("upserts an already loaded seat into the next map version", async () => {
    const data = lifecycleData();
    await apply(data);
    const seat = { seat_id: randomUUID(), ticket_class_id: data.ticket_classes[0].id };
    const client: SeatClassesClient = {
      page: async (event, version) => ({
        event_id: event,
        seat_map_version: version,
        seats: [seat],
        next_cursor: null,
      }),
    };
    const job = new SeatPricingPrefetch(db.pool, client);
    await job.run(data.event_id, 1);
    const ticketClass = { ...data.ticket_classes[0], id: randomUUID() };
    await apply({ ...data, event_version: 3, seat_map_version: 2, ticket_classes: [ticketClass] });
    expect((await state(data.event_id)).pricing_ready).toBe(false);
    seat.ticket_class_id = ticketClass.id;
    await job.run(data.event_id, 2);
    expect(
      (
        await db.pool.query(
          "SELECT seat_map_version,ticket_class_id FROM seat_pricing WHERE event_id=$1",
          [data.event_id],
        )
      ).rows,
    ).toEqual([{ seat_map_version: 2, ticket_class_id: ticketClass.id }]);
    expect(await job.run(data.event_id, 1)).toBe(false);
    expect(await state(data.event_id)).toEqual({
      pricing_ready: true,
      seat_map_version: 2,
      seats: 1,
    });
  });

  it("50 concurrent jobs publish one complete version", async () => {
    const data = lifecycleData();
    await apply(data);
    const seat = { seat_id: randomUUID(), ticket_class_id: data.ticket_classes[0].id };
    const job = new SeatPricingPrefetch(db.pool, {
      page: async () => ({
        event_id: data.event_id,
        seat_map_version: 1,
        seats: [seat],
        next_cursor: null,
      }),
    });
    const results = await Promise.all(Array.from({ length: 50 }, () => job.run(data.event_id, 1)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await state(data.event_id)).toEqual({
      pricing_ready: true,
      seat_map_version: 1,
      seats: 1,
    });
  });

  it("a delayed old job and a regressive lifecycle cannot overwrite the new map", async () => {
    const data = lifecycleData();
    await apply(data);
    let release!: (page: SeatClassesPage) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const delayed = new Promise<SeatClassesPage>((resolve) => {
      release = resolve;
    });
    const old = new SeatPricingPrefetch(db.pool, {
      page: async () => {
        started();
        return delayed;
      },
    }).run(data.event_id, 1);
    await ready;
    await apply({ ...data, event_version: 3, seat_map_version: 2 });
    const seat = { seat_id: randomUUID(), ticket_class_id: data.ticket_classes[0].id };
    await new SeatPricingPrefetch(db.pool, {
      page: async () => ({
        event_id: data.event_id,
        seat_map_version: 2,
        seats: [seat],
        next_cursor: null,
      }),
    }).run(data.event_id, 2);
    release({
      event_id: data.event_id,
      seat_map_version: 1,
      seats: [{ ...seat, ticket_class_id: randomUUID() }],
      next_cursor: null,
    });
    expect(await old).toBe(false);
    await apply({ ...data, event_version: 4, seat_map_version: 1 });
    expect(await state(data.event_id)).toEqual({
      pricing_ready: true,
      seat_map_version: 2,
      seats: 1,
    });
    expect(
      (
        await db.pool.query("SELECT ticket_class_id FROM seat_pricing WHERE event_id=$1", [
          data.event_id,
        ])
      ).rows[0].ticket_class_id,
    ).toBe(seat.ticket_class_id);
  });

  it("rejects cursor loops, duplicate seats, unknown classes and mismatched page identity", async () => {
    for (const kind of ["loop", "duplicate", "class", "event", "version"]) {
      const data = lifecycleData();
      await apply(data);
      const seat = {
        seat_id: randomUUID(),
        ticket_class_id: kind === "class" ? randomUUID() : data.ticket_classes[0].id,
      };
      const job = new SeatPricingPrefetch(db.pool, {
        page: async () => ({
          event_id: kind === "event" ? randomUUID() : data.event_id,
          seat_map_version: kind === "version" ? 2 : 1,
          seats: kind === "duplicate" ? [seat, seat] : [seat],
          next_cursor: kind === "loop" ? "same" : null,
        }),
      });
      await expect(job.run(data.event_id, 1)).rejects.toThrow();
      expect((await state(data.event_id)).pricing_ready).toBe(false);
    }
  });

  it("does not publish after cancellation; GA version zero needs no seat API", async () => {
    const data = lifecycleData();
    await apply(data);
    const client = {
      page: jest.fn(async () => {
        await db.pool.query("UPDATE event_snapshots SET status='CANCELLED' WHERE event_id=$1", [
          data.event_id,
        ]);
        return { event_id: data.event_id, seat_map_version: 1, seats: [], next_cursor: null };
      }),
    };
    expect(await new SeatPricingPrefetch(db.pool, client).run(data.event_id, 1)).toBe(false);
    const ga = { ...lifecycleData(), seat_map_version: 0 };
    await apply(ga);
    client.page.mockClear();
    expect(await new SeatPricingPrefetch(db.pool, client).run(ga.event_id, 0)).toBe(true);
    expect(client.page).not.toHaveBeenCalled();
  });

  it("dev seed uses the same atomic pipeline and refuses production", async () => {
    const data = lifecycleData();
    await apply(data);
    const dir = await mkdtemp(join(tmpdir(), "t203b-seed-"));
    const file = join(dir, "seats.json");
    const config = {
      NODE_ENV: "test",
      DATABASE_URL: db.pool.options.connectionString!,
      INTERNAL_API_KEY: "synthetic-key",
      AUTH_ISSUER: "test",
      AUTH_AUDIENCE: "test",
      AUTH_JWKS_URI: "http://localhost/jwks",
      AUTH_PUBLIC_KEY_PEM: undefined,
      SEED_EVENT_ID: data.event_id,
      SEED_SEAT_MAP_VERSION: "1",
      SEED_SEATS_FILE: file,
    };
    const previous = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
    try {
      for (const [key, value] of Object.entries(config)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await writeFile(
        file,
        JSON.stringify([{ seat_id: randomUUID(), ticket_class_id: data.ticket_classes[0].id }]),
      );
      await seedSeatPricing();
      expect(await state(data.event_id)).toEqual({
        pricing_ready: true,
        seat_map_version: 1,
        seats: 1,
      });
      await seedSeatPricing();
      expect((await state(data.event_id)).seats).toBe(1);
      process.env.NODE_ENV = "production";
      await expect(seedSeatPricing()).rejects.toThrow("disabled in production");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(dir, { recursive: true });
    }
  });
});
