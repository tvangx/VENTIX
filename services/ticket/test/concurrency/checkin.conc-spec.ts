import { randomUUID } from "node:crypto";
import { fixture } from "../support/ticket";
import { scanFixture } from "../support/checkin";

describe("S-402 online check-in concurrency", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture();
  });
  afterAll(async () => {
    await context?.close();
  });

  it("accepts exactly one of 50 different-key scans and records 49 duplicates", async () => {
    const setup = await scanFixture(context);
    const input = await setup.input();
    const results = await Promise.all(Array.from({ length: 50 }, () => setup.scan(input)));
    expect(results.map((result) => result.status)).toEqual(Array(50).fill(200));
    expect(results.filter((result) => result.body.result === "ACCEPTED")).toHaveLength(1);
    expect(results.filter((result) => result.body.result === "DUPLICATE")).toHaveLength(49);
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM checkin_logs WHERE ticket_id=$1 AND result='ACCEPTED'",
          [input.qr.ticket_id],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await context.repo.pool.query("SELECT id FROM checkin_logs WHERE ticket_id=$1", [
          input.qr.ticket_id,
        ])
      ).rowCount,
    ).toBe(50);
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM outbox_events WHERE event_type='TicketCheckedIn' AND message_key=$1",
          [input.qr.ticket_id],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("replays 50 same-key scans with one log and one Outbox event", async () => {
    const setup = await scanFixture(context);
    const input = await setup.input();
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 50 }, () => setup.scan(input, key)));
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.body.result).toBe("ACCEPTED");
      expect(result.body).toEqual(results[0].body);
    }
    expect(
      (
        await context.repo.pool.query("SELECT id FROM checkin_logs WHERE ticket_id=$1", [
          input.qr.ticket_id,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (await context.repo.pool.query("SELECT id FROM ticket_requests WHERE request_key=$1", [key]))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM outbox_events WHERE event_type='TicketCheckedIn' AND message_key=$1",
          [input.qr.ticket_id],
        )
      ).rowCount,
    ).toBe(1);
  });
});
