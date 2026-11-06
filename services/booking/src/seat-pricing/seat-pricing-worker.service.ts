import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { Logger } from "@ticketing/common";
import { Pool } from "pg";
import { ENV, LOGGER } from "../app.tokens";
import { Env } from "../config/env.schema";
import { MetricsService } from "../metrics/metrics";
import { EventSeatClassesClient } from "./event-seat-classes.client";
import { SeatPricingPrefetch } from "./seat-pricing-prefetch";

@Injectable()
export class SeatPricingWorker
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly pool: Pool;
  private readonly job: SeatPricingPrefetch;
  private timer?: NodeJS.Timeout;
  private active: Promise<void> = Promise.resolve();
  private stopping = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly metrics: MetricsService,
  ) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 2000,
      query_timeout: 10000,
    });
    this.pool.on("error", () => undefined);
    this.job = new SeatPricingPrefetch(
      this.pool,
      new EventSeatClassesClient(env.EVENT_INTERNAL_URL, env.INTERNAL_API_KEY),
    );
  }

  onApplicationBootstrap(): void {
    if (this.env.EVENT_CONSUMER_ENABLED) this.tick();
  }

  private tick(): void {
    this.active = this.sweep()
      .catch(() => {
        this.logger.warn(
          { request_id: "seat-pricing", trace_id: "seat-pricing" },
          "booking: pricing scan failed; will retry",
        );
      })
      .finally(() => {
        if (!this.stopping) this.timer = setTimeout(() => this.tick(), 1000);
      });
  }

  async sweep(): Promise<void> {
    // Snapshot chưa ready là hàng đợi bền vững; cursor tránh event lỗi chặn event phía sau.
    let cursor = "00000000-0000-0000-0000-000000000000";
    while (!this.stopping) {
      const rows = await this.pool.query<{ event_id: string; seat_map_version: number }>(
        `SELECT event_id,seat_map_version FROM event_snapshots
         WHERE NOT pricing_ready AND status='APPROVED' AND event_id > $1::uuid ORDER BY event_id LIMIT 100`,
        [cursor],
      );
      if (!rows.rowCount) return;
      for (const row of rows.rows) {
        if (this.stopping) return;
        cursor = row.event_id;
        const context = { ...row, request_id: row.event_id, trace_id: row.event_id };
        try {
          if (await this.job.run(row.event_id, row.seat_map_version)) {
            this.metrics.seatPricingJobs.inc({ outcome: "success" });
            this.logger.info(context, "booking: seat pricing ready");
          }
        } catch {
          this.metrics.seatPricingJobs.inc({ outcome: "failure" });
          this.logger.warn(context, "booking: seat pricing incomplete; will retry");
        }
      }
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.timer);
    await this.active;
  }
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
