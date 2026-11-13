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
import { TicketRepository } from "./modules/tickets/ticket.repository";
import { TicketSecrets } from "./modules/tickets/ticket-secrets";
import { TicketHandler } from "./messaging/ticket.handler";
import { TicketWorker } from "./messaging/ticket-worker";
import { NftWorker } from "./modules/nft/nft-worker";
import { NftHandler } from "./modules/nft/nft.handler";
import { NftRepository } from "./modules/nft/nft.repository";

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
      controllers: [HealthController, MetricsController, WhoamiController],
      providers: [
        { provide: ENV, useValue: env },
        { provide: LOGGER, useValue: logger },
        MetricsService,
        TicketRepository,
        {
          provide: TicketSecrets,
          inject: [ENV],
          useFactory: (config: Env) =>
            new TicketSecrets(
              config.TICKET_ENCRYPTION_KEYS ?? {},
              config.TICKET_ACTIVE_KEY_ID ?? "",
            ),
        },
        TicketHandler,
        TicketWorker,
        NftHandler,
        NftRepository,
        NftWorker,
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
