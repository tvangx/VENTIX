import { fixture } from "../support/ticket";
import { offlineFixture } from "../support/offline";

describe("S-403 offline sync concurrency", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture();
  });
  afterAll(async () => {
    await context?.close();
  });

  it("replays 50 identical batches with one source scan, receipt and event", async () => {
    const setup = await offlineFixture(context);
    const batch = await setup.makeBatch();
    const results = await Promise.all(Array.from({ length: 50 }, () => setup.sync(batch)));
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.body.batch).toEqual(results[0].body.batch);
      expect(result.body.batch.items[0].result).toBe("ACCEPTED");
    }
    expect(
      (
        await context.repo.pool.query("SELECT id FROM offline_sync_batches WHERE id=$1", [
          batch.batch_id,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await context.repo.pool.query("SELECT id FROM checkin_logs WHERE device_id=$1", [
          setup.device.device_id,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM outbox_events WHERE event_type='TicketCheckedIn' AND message_key=$1",
          [batch.scans[0].ticket_id],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("resolves 50 distinct batches across two devices to one acceptance and 49 duplicates", async () => {
    const first = await offlineFixture(context);
    const second = await offlineFixture(context, first);
    const requests = await Promise.all(
      Array.from({ length: 50 }, async (_, index) => {
        const device = index % 2 === 0 ? first : second;
        return { device, batch: await device.makeBatch() };
      }),
    );
    const results = await Promise.all(requests.map(({ device, batch }) => device.sync(batch)));
    expect(results.map((result) => result.status)).toEqual(Array(50).fill(200));
    expect(
      results.filter((result) => result.body.batch.items[0].result === "ACCEPTED"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.body.batch.items[0].result === "DUPLICATE"),
    ).toHaveLength(49);
    const ids = [first.device.device_id, second.device.device_id];
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM offline_sync_batches WHERE device_id=ANY($1::uuid[])",
          [ids],
        )
      ).rowCount,
    ).toBe(50);
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM checkin_logs WHERE device_id=ANY($1::uuid[])",
          [ids],
        )
      ).rowCount,
    ).toBe(50);
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM checkin_logs WHERE ticket_id=$1 AND result='ACCEPTED'",
          [first.ticketIds[0]],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("accepts once across 25 online scans and 25 offline batches racing for the same ticket", async () => {
    const setup = await offlineFixture(context);
    const qr = await setup.input();
    const batches = await Promise.all(Array.from({ length: 25 }, () => setup.makeBatch()));
    const results = await Promise.all([
      ...Array.from({ length: 25 }, () => setup.scan(qr)),
      ...batches.map((batch) => setup.sync(batch)),
    ]);
    expect(results.map((result) => result.status)).toEqual(Array(50).fill(200));
    const outcomes = results.map((result) =>
      result.body.batch ? result.body.batch.items[0].result : result.body.result,
    );
    expect(outcomes.filter((result) => result === "ACCEPTED")).toHaveLength(1);
    expect(outcomes.filter((result) => result === "DUPLICATE")).toHaveLength(49);
    expect(
      (
        await context.repo.pool.query("SELECT id FROM checkin_logs WHERE ticket_id=$1", [
          qr.qr.ticket_id,
        ])
      ).rowCount,
    ).toBe(50);
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM outbox_events WHERE event_type='TicketCheckedIn' AND message_key=$1",
          [qr.qr.ticket_id],
        )
      ).rowCount,
    ).toBe(1);
  });
});
