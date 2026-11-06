import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { MerchQuoteClient } from "../../src/clients/merch-quote.client";

describe("MerchQuoteClient HTTP contract", () => {
  let server: Server;
  let client: MerchQuoteClient;
  let calls: number;
  let mode: "ok" | "invalid" | "timeout" | "combo";
  const sku = randomUUID();
  const input = {
    event_id: randomUUID(),
    ticket_class_ids: [],
    merch_items: [{ sku_id: sku, quantity: 2 }],
  };
  beforeEach(async () => {
    calls = 0;
    mode = "ok";
    server = createServer(async (req, res) => {
      calls++;
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/v1/internal/quotes");
      expect(req.headers["x-internal-key"]).toBe("synthetic-key");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(input);
      if (mode === "timeout") return;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          lines: [
            {
              sku_id: sku,
              quantity: 2,
              unit_price_vnd: 25000,
              ...(mode === "combo" ? { combo_id: randomUUID() } : {}),
            },
          ],
          merch_amount_vnd: mode === "invalid" ? 1 : 50000,
          discount_vnd: 0,
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    client = new MerchQuoteClient(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      "synthetic-key",
      800,
    );
  });
  afterEach(async () => {
    client.onApplicationShutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it("sends internal key and validates server prices", async () => {
    expect((await client.quote(input)).merch_amount_vnd).toBe(50000);
    expect(calls).toBe(1);
  });
  it.each(["invalid", "combo"] as const)("rejects %s quotes after one retry", async (value) => {
    mode = value;
    await expect(client.quote(input)).rejects.toMatchObject({ code: "MERCH_UNAVAILABLE" });
    expect(calls).toBe(2);
  });
  it("times out, retries once, then opens circuit after five failures", async () => {
    client.onApplicationShutdown();
    client = new MerchQuoteClient(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      "synthetic-key",
      50,
    );
    mode = "timeout";
    for (let i = 0; i < 5; i++) await expect(client.quote(input)).rejects.toThrow();
    expect(calls).toBe(10);
    await expect(client.quote(input)).rejects.toThrow();
    expect(calls).toBe(10);
  });
});
