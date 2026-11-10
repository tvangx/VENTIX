import { createServer, Server } from "node:http";
import { newMessage } from "@ticketing/event-contracts";
import { SeatPrefetch } from "../../src/messaging/seat-prefetch";
import { fixture } from "../support/finance";

describe("Finance prefetch seat-classes API hiện có", () => {
  let f: Awaited<ReturnType<typeof fixture>>, server: Server;
  beforeAll(async () => {
    f = await fixture();
  });
  afterAll(async () => {
    await f?.close();
  });
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });
  it("prefetch phân trang rồi confirm SEATED; refund dùng snapshot cũ kể cả map đã cập nhật", async () => {
    const s = await f.seed(true);
    const seen: string[] = [];
    server = createServer((req, res) => {
      seen.push(req.url ?? "");
      expect(req.headers["x-internal-key"]).toBe("synthetic-internal-key");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          event_id: s.event,
          seat_map_version: 1,
          seats: seen.length === 1 ? [{ seat_id: s.seat, ticket_class_id: s.ticketClass }] : [],
          next_cursor: seen.length === 1 ? "page2" : null,
        }),
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No server address");
    const prefetch = new SeatPrefetch(
      {
        ...f.env,
        EVENT_SERVICE_URL: `http://127.0.0.1:${address.port}`,
        INTERNAL_API_KEY: "synthetic-internal-key",
      },
      f.repo,
    );
    const before = await f.inbox.process(f.record(s.order));
    expect(before).toBe("dead-lettered");
    expect(
      (
        await f.repo.pool.query("SELECT * FROM processed_events WHERE message_id=$1", [
          s.order.message_id,
        ])
      ).rowCount,
    ).toBe(0);
    await prefetch.tick();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("cursor=page2");
    expect(await f.deliver(s.order)).toBe("processed");
    await f.repo.pool.query(
      "UPDATE events_ref SET seat_map_version=2,pricing_ready=false WHERE event_id=$1",
      [s.event],
    );
    expect(await f.deliver(s.refund())).toBe("processed");
    expect(
      (await f.repo.pool.query("SELECT sold FROM event_sales_stats WHERE event_id=$1", [s.event]))
        .rows[0].sold,
    ).toBe(0);
  });
  it("sai identity/cursor loop không công bố readiness hoặc ghi map từng phần", async () => {
    const s = await f.seed(true);
    server = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          event_id: s.event,
          seat_map_version: 1,
          seats: [],
          next_cursor: "loop",
        }),
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    if (!a || typeof a === "string") throw new Error("No address");
    const prefetch = new SeatPrefetch(
      { ...f.env, EVENT_SERVICE_URL: `http://127.0.0.1:${a.port}` },
      f.repo,
    );
    await expect(prefetch.load(s.event, 1, [{ id: s.ticketClass }])).rejects.toThrow("cursor loop");
    expect(
      (await f.repo.pool.query("SELECT pricing_ready FROM events_ref WHERE event_id=$1", [s.event]))
        .rows[0].pricing_ready,
    ).toBe(false);
    expect(
      (await f.repo.pool.query("SELECT * FROM seat_classes WHERE event_id=$1", [s.event])).rowCount,
    ).toBe(0);
  });
  it("lifecycle cũ không ghi đè tenant/title mới", async () => {
    const s = await f.seed();
    await f.deliver(
      newMessage("EventUpdated", {
        event_id: s.event,
        organizer_id: s.organizer,
        event_version: 0,
      }),
    );
    const { rows } = await f.repo.pool.query(
      "SELECT title,event_version FROM events_ref WHERE event_id=$1",
      [s.event],
    );
    expect(rows[0]).toEqual({ title: "Synthetic", event_version: 1 });
  });
});
