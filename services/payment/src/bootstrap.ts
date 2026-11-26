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
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

export async function createApp(env: Env, logger: Logger): Promise<INestApplication> {
  // logger: false → mọi log đi qua pino (JSON), không lẫn log mặc định của Nest.
  const app = await NestFactory.create(AppModule.register(env, logger), { logger: false });

  // Global Express middleware bao phủ cả URL không khớp /v1 (404).
  const httpMetrics = new MetricsMiddleware(app.get(MetricsService));
  app.use(httpMetrics.use.bind(httpMetrics));
  app.use(helmet());
  app.setGlobalPrefix("v1", { exclude: ["health/live", "health/ready", "metrics"] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ProblemJsonFilter(logger));
  app.enableShutdownHooks(); // SIGTERM: ngừng nhận request → đóng Prisma qua onModuleDestroy

  SwaggerModule.setup("docs", app, buildOpenApi(app));
  return app;
}
