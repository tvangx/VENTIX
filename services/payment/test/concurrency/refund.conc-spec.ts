import { randomUUID } from "node:crypto";
import { fork, ChildProcess } from "node:child_process";
import { join } from "node:path";
import { once } from "node:events";
import { fixture, Fixture } from "../support/payment";
import { refundInbox, seedRefundBatch } from "../support/refunds";
import { RefundRepository } from "../../src/modules/refunds/refund.repository";
import { RefundWorker } from "../../src/modules/refunds/refund-worker";
import { PaymentService } from "../../src/modules/payments/payment.service";
import { MetricsService } from "../../src/metrics/metrics";
import { createLogger } from "@ticketing/common";

describe("T-401 concurrent refunds and crash recovery", () => {
  let f: Fixture;
  let child: ChildProcess | undefined;
  beforeAll(async () => {
    f = await fixture({ REFUND_RATE_PER_SEC: 1000000 });
  });
  afterAll(async () => {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    await f?.close();
  });
  const repo = () => f.app.get(RefundRepository);
  const second = () =>
    new RefundWorker(
      new RefundRepository(f.repo, f.env),
      f.app.get(PaymentService),
      f.app.get(MetricsService),
      f.env,
      createLogger("second-refund", { level: "silent" }),
    );
  it("50 concurrent deliveries and claims enforce one refund per payment and a shared concurrency cap", async () => {
    const s = await seedRefundBatch(f, 50);
    await Promise.all(
      Array.from({ length: 50 }, () =>
        refundInbox(f).process(
          f.record({ ...s.message, message_id: randomUUID() }, "event.lifecycle"),
        ),
      ),
    );
    const claims = (await Promise.all(Array.from({ length: 50 }, () => repo().claim()))).filter(
      (c) => c !== undefined,
    );
    expect(claims).toHaveLength(5);
    expect(new Set(claims.map((c) => c.id)).size).toBe(5);
    await Promise.all(claims.map((row) => f.app.get(RefundWorker).process(row)));
    const workers = [f.app.get(RefundWorker), second()];
    for (let i = 0; i < 20; i++) await Promise.all(workers.map((w) => w.tick()));
    const counts = await f.repo.pool.query(
      "SELECT count(*)::int total,count(*) FILTER(WHERE status='SUCCEEDED')::int succeeded FROM refunds WHERE batch_id=$1",
      [s.batchId],
    );
    expect(counts.rows[0]).toEqual({ total: 50, succeeded: 50 });
    expect(
      (
        await f.repo.pool.query(
          "SELECT count(*)::int n FROM mock_refund_receipts WHERE payment_id=ANY($1::uuid[])",
          [s.inputs.map((i) => i.id)],
        )
      ).rows[0].n,
    ).toBe(50);
  });
  it("shared rate limit does not grant a second slot before next_at", async () => {
    const s = await seedRefundBatch(f, 2);
    const limited = new RefundRepository(f.repo, { ...f.env, REFUND_RATE_PER_SEC: 1 });
    const first = await limited.claim();
    expect(first).toBeDefined();
    expect(await limited.claim()).toBeUndefined();
    const [{ wait_ms: wait }] = (
      await f.repo.pool.query<{ wait_ms: string }>(
        "SELECT extract(epoch FROM(next_at-clock_timestamp()))*1000 AS wait_ms FROM refund_dispatch",
      )
    ).rows;
    expect(Number(wait)).toBeGreaterThan(500);
    await f.app.get(RefundWorker).process(first!);
    await f.repo.pool.query(
      "UPDATE refund_dispatch SET next_at=clock_timestamp()-interval '1 second'",
    );
    await f.app.get(RefundWorker).tick();
    expect(
      (
        await f.repo.pool.query(
          "SELECT count(*)::int n FROM refunds WHERE batch_id=$1 AND status='SUCCEEDED'",
          [s.batchId],
        )
      ).rows[0].n,
    ).toBe(2);
  });
  it("500 payments survive a killed worker after provider accepted and before DB completion", async () => {
    const s = await seedRefundBatch(f, 500);
    child = fork(join(__dirname, "../support/refund-crash-worker.mjs"), [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const ready = new Promise<{ claimed: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Crash worker timeout: ${stderr}`)), 60000);
      child!.once("message", (message: unknown) => {
        clearTimeout(timeout);
        const value = message as { claimed?: string; error?: string };
        if (value.claimed) resolve({ claimed: value.claimed });
        else reject(new Error(value.error ?? stderr));
      });
      child!.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child!.once("exit", (code) => {
        clearTimeout(timeout);
        if (code) reject(new Error(`Crash worker exited ${code}: ${stderr}`));
      });
    });
    child.send({ ...f.rawEnv, REFUND_RATE_PER_SEC: 1000000 });
    const { claimed } = await ready;
    const exit = once(child, "exit");
    child.kill("SIGKILL");
    await exit;
    child = undefined;
    expect(
      (
        await f.repo.pool.query(
          "SELECT count(*)::int n FROM refunds WHERE batch_id=$1 AND status='SUCCEEDED'",
          [s.batchId],
        )
      ).rows[0].n,
    ).toBe(20);
    expect(
      (await f.repo.pool.query("SELECT status,sent_at FROM refunds WHERE id=$1", [claimed]))
        .rows[0],
    ).toMatchObject({ status: "PROCESSING", sent_at: expect.any(Date) });
    await f.repo.pool.query(
      "UPDATE refunds SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [claimed],
    );
    const workers = [f.app.get(RefundWorker), second()];
    // Lặp bằng công việc thực, không sleep cố định; giới hạn 500 vòng.
    for (let i = 0; i < 500; i++) {
      await Promise.all(workers.map((w) => w.tick()));
      const [{ n }] = (
        await f.repo.pool.query<{ n: number }>(
          "SELECT count(*)::int n FROM refunds WHERE batch_id=$1 AND status<>'SUCCEEDED'",
          [s.batchId],
        )
      ).rows;
      if (n === 0) break;
    }
    const refunds = await f.repo.pool.query(
      "SELECT count(*)::int total,count(*) FILTER(WHERE status='SUCCEEDED')::int succeeded FROM refunds WHERE batch_id=$1",
      [s.batchId],
    );
    expect(refunds.rows[0]).toEqual({ total: 500, succeeded: 500 });
    expect(
      (
        await f.repo.pool.query(
          "SELECT count(*)::int n FROM mock_refund_receipts WHERE payment_id=ANY($1::uuid[])",
          [s.inputs.map((i) => i.id)],
        )
      ).rows[0].n,
    ).toBe(500);
    expect(
      (
        await f.repo.pool.query(
          "SELECT count(*)::int n,count(DISTINCT payload->'data'->>'refund_id')::int distinct_n FROM outbox_events WHERE event_type='RefundCompleted' AND payload->'data'->>'batch_id'=$1",
          [s.batchId],
        )
      ).rows[0],
    ).toEqual({ n: 500, distinct_n: 500 });
  }, 120000);
});
