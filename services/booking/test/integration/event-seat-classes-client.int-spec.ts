import { randomUUID } from "node:crypto";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EventSeatClassesClient } from "../../src/seat-pricing/event-seat-classes.client";

// Server giả theo docs/api/internal/seat-classes.yaml, không dùng services/event.
describe("EventSeatClassesClient against HTTP fake", () => {
  let server: Server;
  let url: string;
  let mode: string;
  let calls: number;
  const event = randomUUID();
  const seat = randomUUID();
  const ticketClass = randomUUID();
  beforeAll(async () => {
    const contract = readFileSync(
      join(__dirname, "../../../../docs/api/internal/seat-classes.yaml"),
      "utf8",
    );
    expect(contract).toContain("/v1/internal/events/{eventId}/seat-classes:");
    expect(contract).toContain("required: [event_id, seat_map_version, seats, next_cursor]");
    server = createServer((req, res) => {
      calls++;
      const requestUrl = new URL(req.url!, "http://localhost");
      if (req.headers["x-internal-key"] !== "synthetic-key") {
        res.writeHead(401).end();
        return;
      }
      if (requestUrl.pathname !== `/v1/internal/events/${event}/seat-classes`) {
        res.writeHead(404).end();
        return;
      }
      expect(requestUrl.searchParams.get("limit")).toBe("1000");
      expect(requestUrl.searchParams.get("seat_map_version")).toBe("2");
      if (mode === "401" || mode === "404") {
        res.writeHead(Number(mode)).end();
        return;
      }
      if (mode === "timeout") return;
      if (mode === "body-timeout") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.flushHeaders();
        return;
      }
      if (mode === "retry" && calls < 3) {
        res.writeHead(503).end();
        return;
      }
      res.setHeader("Content-Type", "application/json");
      if (mode === "json") {
        res.end("{");
        return;
      }
      if (mode === "malformed") {
        res.end(JSON.stringify({ seats: [] }));
        return;
      }
      res.end(
        JSON.stringify({
          event_id: mode === "event" ? randomUUID() : event,
          seat_map_version: mode === "version" ? 1 : 2,
          seats: [{ seat_id: seat, ticket_class_id: ticketClass }],
          next_cursor: requestUrl.searchParams.has("cursor") ? null : "opaque/+ cursor",
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(() => {
    calls = 0;
    mode = "ok";
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const client = (key = "synthetic-key") =>
    new EventSeatClassesClient(url, key, { timeoutMs: 200, attempts: 3, backoffMs: 1 });

  it("sends internal key, pins version and encodes opaque cursor", async () => {
    const first = await client().page(event, 2);
    expect(first.next_cursor).toBe("opaque/+ cursor");
    expect(await client().page(event, 2, first.next_cursor!)).toEqual({
      event_id: event,
      seat_map_version: 2,
      seats: [{ seat_id: seat, ticket_class_id: ticketClass }],
      next_cursor: null,
    });
    expect(calls).toBe(2);
  });
  it("retries transient HTTP failures", async () => {
    mode = "retry";
    await expect(client().page(event, 2)).resolves.toHaveProperty("event_id", event);
    expect(calls).toBe(3);
  });
  it.each(["timeout", "body-timeout"])("bounds %s and exhausts retries", async (value) => {
    mode = value;
    await expect(client().page(event, 2)).rejects.toThrow("after retries");
    expect(calls).toBe(3);
  });
  it.each(["401", "404", "malformed", "json", "event", "version"])(
    "rejects %s without retry",
    async (value) => {
      mode = value;
      await expect(client().page(event, 2)).rejects.toThrow();
      expect(calls).toBe(1);
    },
  );
  it("never retries bad credentials", async () => {
    await expect(client("wrong-key").page(event, 2)).rejects.toThrow("401");
    expect(calls).toBe(1);
  });
});
