import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Logger } from "@ticketing/common";
import { ENV, LOGGER } from "../app.tokens";
import { Env } from "../config/env.schema";
import { EventLifecycleService } from "../messaging/event-lifecycle.service";
import { SeatRehydrateService } from "./seat-rehydrate.service";

@Injectable()
export class BookingStartupService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  ready = false;
  private stopping = false;
  completion: Promise<void> = Promise.resolve();
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(SeatRehydrateService) private readonly rehydrate: Pick<SeatRehydrateService, "run">,
    @Inject(EventLifecycleService)
    private readonly lifecycle: Pick<EventLifecycleService, "start" | "stop">,
  ) {}
  onApplicationBootstrap(): void {
    this.completion = this.initialize().catch(() => {
      this.logger.error(
        { trace_id: "startup", request_id: "startup" },
        "booking: initialization failed; readiness remains unavailable, restart after recovery",
      );
    });
  }
  private async initialize(): Promise<void> {
    if (this.env.REHYDRATE_ENABLED) await this.rehydrate.run();
    if (this.env.EVENT_CONSUMER_ENABLED) await this.lifecycle.start();
    this.ready = !this.stopping;
  }
  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.ready = false;
    await this.completion;
    await this.lifecycle.stop();
  }
}
