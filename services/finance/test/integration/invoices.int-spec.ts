import { randomUUID } from "node:crypto";
import { createLogger } from "@ticketing/common";
import { fixture } from "../support/finance";
import { InvoiceRepository } from "../../src/modules/invoices/invoice.repository";
import { InvoiceRunner } from "../../src/modules/invoices/invoice-runner";
import { MockAdapter } from "../../src/modules/invoices/invoice-adapter";

describe("S-505 durable mock invoices (PostgreSQL)", () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  let repo: InvoiceRepository;
  beforeAll(async () => {
    f = await fixture();
    repo = f.app.get(InvoiceRepository);
  });
  afterAll(async () => {
    await f?.close();
  });
  const logger = createLogger("invoice-test", { level: "silent" });
  async function paid() {
    const s = await f.seed();
    await f.deliver(s.order);
    await repo.materialize();
    return s;
  }
  async function due(id: string) {
    await f.repo.pool.query("UPDATE invoices SET updated_at=now()-interval '1 hour' WHERE id=$1", [
      id,
    ]);
  }
  it("only committed paid orders; duplicate deliveries produce one immutable snapshot", async () => {
    const s = await f.seed();
    await repo.materialize();
    expect(
      (
        await f.repo.pool.query("SELECT id FROM invoices WHERE order_id=$1", [
          s.order.data.order_id,
        ])
      ).rowCount,
    ).toBe(0);
    await f.deliver(s.order);
    await f.deliver(s.order);
    await f.deliver({ ...s.order, message_id: randomUUID() });
    await repo.materialize();
    await repo.materialize();
    const before = await f.repo.pool.query(
      "SELECT * FROM ledger_entries WHERE ref_id=$1 ORDER BY id",
      [s.order.data.order_id],
    );
    const runner = new InvoiceRunner(repo, new MockAdapter(), f.env, logger);
    expect(await runner.runOne()).toBe(true);
    expect(
      (
        await f.repo.pool.query(
          "SELECT provider,status,invoice_no,retry_count FROM invoices WHERE order_id=$1",
          [s.order.data.order_id],
        )
      ).rows,
    ).toEqual([
      {
        provider: "MOCK",
        status: "ISSUED",
        invoice_no: `MOCK-${s.order.data.order_id}`,
        retry_count: 1,
      },
    ]);
    expect(
      (
        await f.repo.pool.query(
          "SELECT category,amount_vnd,vat_rate FROM invoice_items WHERE invoice_id=$1 ORDER BY category",
          [s.order.data.order_id],
        )
      ).rows,
    ).toEqual([
      { category: "MERCH", amount_vnd: "110", vat_rate: "0.1000" },
      { category: "TICKET", amount_vnd: "110", vat_rate: "0.1000" },
    ]);
    expect(
      (
        await f.repo.pool.query("SELECT * FROM ledger_entries WHERE ref_id=$1 ORDER BY id", [
          s.order.data.order_id,
        ])
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await f.repo.pool.query(
          "SELECT id FROM outbox_events WHERE payload->'data'->>'action'='MOCK_INVOICE_ISSUED' AND payload->'data'->>'resource_id'=$1",
          [s.order.data.order_id],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("provider error persists retry, survives restart and respects backoff", async () => {
    const s = await paid();
    const broken = { issue: jest.fn().mockRejectedValue(new Error("provider unavailable")) };
    const runner = new InvoiceRunner(repo, broken, f.env, logger);
    await runner.runOne();
    expect(await runner.runOne()).toBe(false);
    expect(broken.issue).toHaveBeenCalledTimes(1);
    await due(s.order.data.order_id);
    await new InvoiceRunner(repo, new MockAdapter(), f.env, logger).runOne();
    expect(
      (
        await f.repo.pool.query("SELECT status,retry_count FROM invoices WHERE id=$1", [
          s.order.data.order_id,
        ])
      ).rows[0],
    ).toEqual({ status: "ISSUED", retry_count: 2 });
  });
  it("timeout is bounded and final attempt fails without touching paid order", async () => {
    const s = await paid();
    const env = { ...f.env, INVOICE_MAX_ATTEMPTS: 1, INVOICE_TIMEOUT_MS: 10 };
    const runner = new InvoiceRunner(
      repo,
      { issue: () => new Promise(() => undefined) },
      env,
      logger,
    );
    await runner.runOne();
    expect(
      (await f.repo.pool.query("SELECT status FROM invoices WHERE id=$1", [s.order.data.order_id]))
        .rows[0].status,
    ).toBe("FAILED");
    expect(
      (
        await f.repo.pool.query("SELECT id FROM finance_orders WHERE id=$1", [
          s.order.data.order_id,
        ])
      ).rowCount,
    ).toBe(1);
    expect(await runner.runOne()).toBe(false);
  });
  it("expired lease is recovered; stale worker cannot complete or fail newer claim", async () => {
    const s = await paid();
    const first = (await repo.claim(f.env))!;
    await due(s.order.data.order_id);
    const second = (await repo.claim(f.env))!;
    expect(second.version).toBeGreaterThan(first.version);
    expect(await repo.complete(first, "MOCK-stale", f.env)).toBe(false);
    expect(await repo.fail(first, f.env)).toBe(false);
    expect(await repo.complete(second, `MOCK-${s.order.data.order_id}`, f.env)).toBe(true);
  });
  it("crash at last attempt is terminal after lease, without infinite retries", async () => {
    const s = await paid();
    const env = { ...f.env, INVOICE_MAX_ATTEMPTS: 1 };
    await repo.claim(env);
    await due(s.order.data.order_id);
    expect(await repo.claim(env)).toBeUndefined();
    expect(
      (await f.repo.pool.query("SELECT status FROM invoices WHERE id=$1", [s.order.data.order_id]))
        .rows[0].status,
    ).toBe("FAILED");
  });
  it("outbox failure rolls back issued state; same provider result can retry", async () => {
    await paid();
    const job = (await repo.claim(f.env))!;
    await f.admin.query("REVOKE INSERT ON outbox_events FROM finance_user");
    try {
      await expect(repo.complete(job, `MOCK-${job.id}`, f.env)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await f.admin.query("GRANT INSERT ON outbox_events TO finance_user");
    }
    expect(
      (await f.repo.pool.query("SELECT status FROM invoices WHERE id=$1", [job.id])).rows[0].status,
    ).toBe("ISSUING");
    expect(await repo.complete(job, `MOCK-${job.id}`, f.env)).toBe(true);
  });
});
