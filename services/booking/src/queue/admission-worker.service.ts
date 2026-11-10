import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Logger, ProblemException } from "@ticketing/common";
import { ENV, LOGGER } from "../app.tokens";
import { Env } from "../config/env.schema";
import { MetricsService } from "../metrics/metrics";
import { EventSnapshotRepository } from "../seat-hold/event-snapshot.repository";
import { QueueService } from "./queue.service";

@Injectable()
export class AdmissionWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private job?: Promise<void>;
  private stopping = false;
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly snapshots: EventSnapshotRepository,
    private readonly queue: QueueService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.ADMISSION_REQUIRED || !this.env.QUEUE_WORKER_ENABLED) return;
    this.timer = setInterval(() => {
      if (!this.job && !this.stopping)
        this.job = this.sweep()
          .catch(() => {
            this.logger.warn(
              { request_id: "admission-worker", trace_id: "admission-worker" },
              "Admission scan failed; retrying next tick",
            );
          })
          .finally(() => {
            this.job = undefined;
          });
    }, 1000);
  }

  async sweep(): Promise<void> {
    let cursor = "00000000-0000-0000-0000-000000000000";
    while (!this.stopping) {
      const ids = await this.snapshots.eventIdsAfter(cursor);
      if (!ids.length) return;
      for (const event of ids) {
        if (this.stopping) return;
        cursor = event;
        try {
          const phase = await this.queue.phase(event);
          if (!phase.queue_enabled) continue;
          const [count] = await this.queue.operation(event, "", "admit", phase);
          this.metrics.queueAdmitted.inc(count);
        } catch (error) {
          if (error instanceof ProblemException && error.getStatus() === 404) continue;
          this.logger.warn(
            { event_id: event, request_id: "admission-worker", trace_id: "admission-worker" },
            "Admission tick failed; retrying next tick",
          );
        }
      }
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    await this.job;
  }
}
