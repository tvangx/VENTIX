import { createLogger } from "@ticketing/common";
import { Pool } from "pg";
import { envSchema } from "../config/env.schema";
import { MetricsService } from "../metrics/metrics";
import { SeatPricingPrefetch } from "./seat-pricing-prefetch";
import { SeatPricingWorker } from "./seat-pricing-worker.service";

jest.mock("pg", () => ({ Pool: jest.fn() }));

describe("seat pricing worker recovery", () => {
  const env = envSchema.parse({
    DATABASE_URL: "postgresql://booking_user:test@localhost/booking_db",
    ADMISSION_TOKEN_SECRET: "synthetic-admission-key-for-booking-tests",
    QUEUE_WORKER_ENABLED: "false",
    INTERNAL_API_KEY: "synthetic-key",
    AUTH_ISSUER: "test",
    AUTH_AUDIENCE: "test",
    AUTH_JWKS_URI: "http://localhost/jwks",
  });
  const logger = createLogger("test", { level: "silent" });
  const first = { event_id: "11111111-1111-4111-8111-111111111111", seat_map_version: 1 };
  const second = { event_id: "22222222-2222-4222-8222-222222222222", seat_map_version: 2 };
  let pool: { query: jest.Mock; on: jest.Mock; end: jest.Mock };
  beforeEach(() => {
    pool = { query: jest.fn(), on: jest.fn(), end: jest.fn() };
    (Pool as unknown as jest.Mock).mockImplementation(() => pool);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("scans pending snapshots after restart and continues past a failing event", async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 2, rows: [first, second] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const run = jest
      .spyOn(SeatPricingPrefetch.prototype, "run")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(true);
    const metrics = new MetricsService();
    const worker = new SeatPricingWorker(env, logger, metrics);
    await worker.sweep();
    expect(run.mock.calls).toEqual([
      [first.event_id, 1],
      [second.event_id, 2],
    ]);
    expect(pool.query.mock.calls[1][1]).toEqual([second.event_id]);
    expect(await metrics.registry.metrics()).toContain(
      'seat_pricing_jobs_total{outcome="failure"} 1',
    );
    await worker.beforeApplicationShutdown();
    await worker.onApplicationShutdown();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("retries pending work on the next tick and cancels scheduling at shutdown", async () => {
    jest.useFakeTimers();
    pool.query.mockResolvedValue({ rowCount: 0, rows: [] });
    const worker = new SeatPricingWorker(env, logger, new MetricsService());
    const sweep = jest
      .spyOn(worker, "sweep")
      .mockRejectedValueOnce(new Error("DB offline"))
      .mockResolvedValue();
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(1000);
    expect(sweep).toHaveBeenCalledTimes(2);
    await worker.beforeApplicationShutdown();
    await jest.advanceTimersByTimeAsync(2000);
    expect(sweep).toHaveBeenCalledTimes(2);
    await worker.onApplicationShutdown();
  });
});
