import { DynamicModule, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthModule } from "@ticketing/auth-guard";
import { Logger, RequestIdMiddleware } from "@ticketing/common";
import { ENV, LOGGER } from "./app.tokens";
import { HttpLoggingMiddleware } from "./common/http-logging.middleware";
import type { Env } from "./config/env.schema";
import { DbModule } from "./db/db-health.service";
import { HealthController } from "./health/health.controller";
import { MetricsController, MetricsService } from "./metrics/metrics";
import { WhoamiController } from "./modules/whoami/whoami.controller";
import { EventSnapshotRepository } from "./seat-hold/event-snapshot.repository";
import { SeatHoldController } from "./seat-hold/seat-hold.controller";
import { SeatHoldService } from "./seat-hold/seat-hold.service";
import { SeatHoldRedisClient } from "./seat-hold/seat-hold-redis";
import { EventLifecycleService } from "./messaging/event-lifecycle.service";
import { BookingStartupService } from "./rehydrate/booking-startup.service";
import { SeatRehydrateService } from "./rehydrate/seat-rehydrate.service";
import { SeatStatusController } from "./seat-status/seat-status.controller";
import { SeatStatusService } from "./seat-status/seat-status.service";
import { SeatPricingWorker } from "./seat-pricing/seat-pricing-worker.service";
import { CheckoutController } from "./checkout/checkout.controller";
import { CheckoutRepository } from "./checkout/checkout.repository";
import { CheckoutService } from "./checkout/checkout.service";
import { OrderSagaWorker } from "./orders/order-saga-worker.service";
import { MERCH_QUOTE, MerchQuoteClient } from "./clients/merch-quote.client";
import { QueueController } from "./queue/queue.controller";
import { QueueService } from "./queue/queue.service";
import { AdmissionWorker } from "./queue/admission-worker.service";
import { AdmissionGuard } from "./queue/admission.guard";
import { OrderReadController, OrderReadService } from "./orders/order-read";

@Module({})
export class AppModule implements NestModule {
  static register(env: Env, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DbModule,
        AuthModule.register({
          issuer: env.AUTH_ISSUER,
          audience: env.AUTH_AUDIENCE,
          jwksUri: env.AUTH_JWKS_URI,
          publicKeyPem: env.AUTH_PUBLIC_KEY_PEM,
        }),
      ],
      controllers: [
        HealthController,
        MetricsController,
        WhoamiController,
        SeatHoldController,
        SeatStatusController,
        CheckoutController,
        QueueController,
        OrderReadController,
      ],
      providers: [
        { provide: ENV, useValue: env },
        { provide: LOGGER, useValue: logger },
        MetricsService,
        QueueService,
        OrderReadService,
        AdmissionWorker,
        AdmissionGuard,
        CheckoutRepository,
        CheckoutService,
        OrderSagaWorker,
        {
          provide: MERCH_QUOTE,
          useFactory: () =>
            new MerchQuoteClient(
              env.MERCH_INTERNAL_URL,
              env.INTERNAL_API_KEY,
              env.MERCH_QUOTE_TIMEOUT_MS,
            ),
        },
        EventSnapshotRepository,
        SeatHoldRedisClient,
        SeatHoldService,
        SeatStatusService,
        EventLifecycleService,
        SeatPricingWorker,
        SeatRehydrateService,
        BookingStartupService,
      ],
      // global + exports: để các module con (DbModule, …) inject được ENV/LOGGER.
      exports: [ENV, LOGGER],
      global: true,
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, HttpLoggingMiddleware).forRoutes("*");
  }
}
