import { randomUUID } from "node:crypto";
import { fixture } from "../support/ticket";
import { gateFixture } from "../support/gates";

describe("S-401 gate concurrency", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture();
  });
  afterAll(async () => {
    await context?.close();
  });

  it("serves 50 identical downloads with one encrypted package, receipt and audit", async () => {
    const setup = await gateFixture(context);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 50 }, () => setup.download(key)));
    expect(results.map((result) => result.status)).toEqual(Array(50).fill(201));
    expect(new Set(results.map((result) => result.body.package_id)).size).toBe(1);
    for (const result of results) expect(result.body).toEqual(results[0].body);
    expect(
      (await context.repo.pool.query("SELECT id FROM ticket_requests WHERE request_key=$1", [key]))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await context.repo.pool.query(
          "SELECT id FROM outbox_events WHERE message_key=$1 AND payload->'data'->>'action'='GATE_PACKAGE_ISSUED'",
          [setup.gate.id],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("assigns a ticket atomically to one gate under 50 competing gate requests", async () => {
    const setup = await gateFixture(context);
    const second = (
      await setup.post("", { event_id: setup.order.data.event_id, name: "South" }).expect(201)
    ).body;
    const ids = [setup.gate.id, second.id];
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        setup.post(`/${ids[index % 2]}/tickets`, { ticket_ids: [setup.ticketIds[2]] }),
      ),
    );
    expect(results.filter((result) => result.status === 201)).toHaveLength(25);
    expect(results.filter((result) => result.status === 409)).toHaveLength(25);
    for (const result of results.filter((result) => result.status === 409))
      expect(result.body.code).toBe("TICKET_GATE_ALREADY_ASSIGNED");
    expect(ids).toContain(
      (
        await context.repo.pool.query("SELECT gate_id FROM tickets WHERE id=$1", [
          setup.ticketIds[2],
        ])
      ).rows[0].gate_id,
    );
  });
});
