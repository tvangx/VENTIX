import { fixture } from "../support/finance";
import { InvoiceRepository } from "../../src/modules/invoices/invoice.repository";

it("50 materializers/claimants issue one invoice per paid order", async () => {
  const f = await fixture();
  try {
    const s = await f.seed();
    await f.deliver(s.order);
    const repo = f.app.get(InvoiceRepository);
    await Promise.all(Array.from({ length: 50 }, () => repo.materialize()));
    expect((await f.repo.pool.query("SELECT id FROM invoices")).rowCount).toBe(1);
    expect((await f.repo.pool.query("SELECT id FROM invoice_items")).rowCount).toBe(2);
    const claims = (await Promise.all(Array.from({ length: 50 }, () => repo.claim(f.env)))).filter(
      (v) => v !== undefined,
    );
    expect(claims).toHaveLength(1);
    const completed = await Promise.all(
      Array.from({ length: 50 }, () =>
        repo.complete(claims[0]!, `MOCK-${s.order.data.order_id}`, f.env),
      ),
    );
    expect(completed.filter(Boolean)).toHaveLength(1);
    expect(
      (
        await f.repo.pool.query(
          "SELECT id FROM outbox_events WHERE payload->'data'->>'action'='MOCK_INVOICE_ISSUED'",
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    await f.close();
  }
});
