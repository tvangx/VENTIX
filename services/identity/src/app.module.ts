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
import { PrismaService } from "./db/prisma.service";
import { AuthKeys } from "./modules/auth/auth-keys";
import { AuthController, JwksController } from "./modules/auth/auth.controller";
import { AuthRepository } from "./modules/auth/auth.repository";
import { AuthService } from "./modules/auth/auth.service";
import { IdempotencyService } from "./modules/auth/idempotency.service";
import { GoogleController } from "./modules/auth/google.controller";
import { GoogleProvider } from "./modules/auth/google.provider";
import { GoogleRepository } from "./modules/auth/google.repository";
import { GoogleService } from "./modules/auth/google.service";
import { AccessController, TenantContextController } from "./modules/access/access.controller";
import { AccessRepository } from "./modules/access/access.repository";
import { AccessService } from "./modules/access/access.service";
import { TenantGuard } from "./modules/access/tenant.guard";

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
        AuthController,
        JwksController,
        GoogleController,
        AccessController,
        TenantContextController,
      ],
      providers: [
        { provide: ENV, useValue: env },
        { provide: LOGGER, useValue: logger },
        MetricsService,
        PrismaService,
        AuthKeys,
        AuthRepository,
        AuthService,
        IdempotencyService,
        GoogleProvider,
        GoogleRepository,
        GoogleService,
        AccessRepository,
        AccessService,
        TenantGuard,
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
