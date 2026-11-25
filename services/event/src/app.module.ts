import { DynamicModule, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthModule } from "@ticketing/auth-guard";
import { Logger, RequestIdMiddleware } from "@ticketing/common";
import { ENV, LOGGER } from "./app.tokens";
import { HttpLoggingMiddleware } from "./common/http-logging.middleware";
import type { Env } from "./config/env.schema";
import { DbModule } from "./db/db-health.service";
import { HealthController } from "./health/health.controller";
import { MetricsController, MetricsMiddleware, MetricsService } from "./metrics/metrics";
import { EventOutboxWorker } from "./messaging/event-outbox.worker";
import { OrganizerModule } from "./modules/organizer/organizer.module";
import { PublicCatalogModule } from "./modules/public-catalog/public-catalog.module";
import { InternalKeyGuard } from "./modules/seat-classes/internal-key.guard";
import { SeatClassesController } from "./modules/seat-classes/seat-classes.controller";
import { WhoamiController } from "./modules/whoami/whoami.controller";
import {
  PublicSeatsController,
  PublicSeatsRepository,
} from "./modules/public-catalog/public-seats";

@Module({})
export class AppModule implements NestModule {
  static register(env: Env, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DbModule,
        OrganizerModule,
        PublicCatalogModule,
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
        SeatClassesController,
        PublicSeatsController,
      ],
      providers: [
        { provide: ENV, useValue: env },
        { provide: LOGGER, useValue: logger },
        MetricsService,
        PublicSeatsRepository,
        EventOutboxWorker,
        InternalKeyGuard,
      ],
      // global + exports: để các module con (DbModule, …) inject được ENV/LOGGER.
      exports: [ENV, LOGGER, MetricsService],
      global: true,
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, HttpLoggingMiddleware, MetricsMiddleware).forRoutes("*");
  }
}
