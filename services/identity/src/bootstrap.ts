import { INestApplication, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { Logger, ProblemJsonFilter } from "@ticketing/common";
import helmet from "helmet";
import { MetricsMiddleware, MetricsService } from "./metrics/metrics";
import { AppModule } from "./app.module";
import type { Env } from "./config/env.schema";
import { SERVICE_NAME } from "./service.constants";

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle(`${SERVICE_NAME} service`)
    .setVersion("1.0")
    .setDescription(
      "Identity tuần 1: email/Google auth, HttpOnly refresh cookie, RBAC/tenant và duyệt Organizer. Refresh cần credentials/include; access token chỉ giữ trong bộ nhớ.",
    )
    .addServer("/", "Direct service")
    .addServer("/api/identity", "Kong gateway")
    .addBearerAuth()
    .addCookieAuth("ventix_refresh")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.Problem = {
    type: "object",
    required: ["type", "title", "status", "detail", "code", "request_id"],
    properties: {
      type: { type: "string" },
      title: { type: "string" },
      status: { type: "integer" },
      detail: { type: "string" },
      code: { type: "string", example: "INVALID_REFRESH_TOKEN" },
      request_id: { type: "string", nullable: true },
    },
  };
  for (const path of Object.values(document.paths)) {
    for (const method of ["get", "post", "patch", "put", "delete"] as const) {
      const operation = path[method];
      if (!operation) continue;
      operation.responses.default = {
        description: "Lỗi RFC 7807. code phân biệt validation, quyền, xung đột và lỗi tạm thời.",
        content: {
          "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } },
        },
      };
    }
  }
  return document;
}

export async function createApp(env: Env, logger: Logger): Promise<INestApplication> {
  // logger: false → mọi log đi qua pino (JSON), không lẫn log mặc định của Nest.
  const app = await NestFactory.create(AppModule.register(env, logger), { logger: false });

  // Global Express middleware bao phủ cả URL không khớp /v1 (404).
  const httpMetrics = new MetricsMiddleware(app.get(MetricsService));
  app.use(httpMetrics.use.bind(httpMetrics));
  app.use(helmet());
  app.setGlobalPrefix("v1", {
    exclude: ["health/live", "health/ready", "metrics", ".well-known/jwks.json"],
  });
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id"],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ProblemJsonFilter(logger));
  app.enableShutdownHooks(); // SIGTERM: ngừng nhận request → đóng Prisma qua onModuleDestroy

  SwaggerModule.setup("docs", app, buildOpenApi(app));
  return app;
}
