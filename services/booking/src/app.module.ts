import { DynamicModule, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthModule } from "@ticketing/auth-guard";
import { Logger, RequestIdMiddleware } from "@ticketing/common";
import { ENV, LOGGER } from "./app.tokens";
import { HttpLoggingMiddleware } from "./common/http-logging.middleware";
import type { Env } from "./config/env.schema";
import { DbModule } from "./db/db-health.service";
import { HealthController } from "./health/health.controller";
import { MetricsController, MetricsMiddleware, MetricsService } from "./metrics/metrics";
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
      ],
      providers: [
        { provide: ENV, useValue: env },
        { provide: LOGGER, useValue: logger },
        MetricsService,
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
    consumer.apply(RequestIdMiddleware, HttpLoggingMiddleware, MetricsMiddleware).forRoutes("*");
  }
}
