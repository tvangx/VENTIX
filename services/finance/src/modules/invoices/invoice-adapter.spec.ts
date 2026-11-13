import { MockAdapter } from "./invoice-adapter";

describe("Mock invoice adapter", () => {
  const input = {
    id: "a09fce4d-8f1a-461d-a95e-ff77b634389f",
    order_id: "a09fce4d-8f1a-461d-a95e-ff77b634389f",
    items: [{ category: "TICKET", amount_vnd: "110", vat_rate: "0.1000" }],
  };
  it("same order remains deterministic across instances and retries", async () => {
    const signal = new AbortController().signal;
    const first = await new MockAdapter().issue(input, signal);
    expect(await new MockAdapter().issue(input, signal)).toEqual(first);
    expect(first.invoice_no).toBe(`MOCK-${input.order_id}`);
  });
  it("respects abort without issuing", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new MockAdapter().issue(input, controller.signal)).rejects.toThrow();
  });
});
