import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Logger } from "@ticketing/common";
import { ENV, LOGGER } from "../app.tokens";
import { Env } from "../config/env.schema";
import { CheckoutRepository } from "../checkout/checkout.repository";
import { SeatHoldRedisClient } from "../seat-hold/seat-hold-redis";
import { MetricsService } from "../metrics/metrics";
import { drainSagaWork, sweepExpiredOrders } from "./order-saga";
import { BookingStartupService } from "../rehydrate/booking-startup.service";

@Injectable()
export class OrderSagaWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private active: Promise<void> = Promise.resolve();
  private stopping = false;
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly repository: CheckoutRepository,
    private readonly cache: SeatHoldRedisClient,
    private readonly metrics: MetricsService,
    private readonly startup: BookingStartupService,
  ) {}
  onApplicationBootstrap(): void {
    if (this.env.EVENT_CONSUMER_ENABLED) this.tick();
  }
  private tick(): void {
    this.active = (this.startup.ready ? this.sweep() : Promise.resolve())
      .catch(() => {
        this.metrics.orderSagaWork.inc({ outcome: "failure" });
        this.logger.warn(
          { request_id: "order-saga", trace_id: "order-saga" },
          "booking: saga work failed; durable work will retry",
        );
      })
      .finally(() => {
        if (!this.stopping) this.timer = setTimeout(() => this.tick(), 1000);
      });
  }
  async sweep(): Promise<void> {
    const expired = await this.repository.db.transaction((exec) =>
      sweepExpiredOrders(exec, this.env.ORDER_EXPIRY_GRACE_SECONDS),
    );
    this.metrics.orderExpired.inc(expired);
    const applied = await drainSagaWork(this.repository.db, this.cache, (orderId) => {
      this.metrics.orderSagaWork.inc({ outcome: "failure" });
      this.logger.warn(
        { request_id: orderId, trace_id: orderId, order_id: orderId },
        "booking: order saga projection failed; will retry",
      );
    });
    this.metrics.orderSagaWork.inc({ outcome: "success" }, applied);
    if (expired || applied)
      this.logger.info(
        { request_id: "order-saga", trace_id: "order-saga", expired, applied },
        "booking: order saga sweep completed",
      );
  }
  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.timer);
    await this.active;
  }
}
