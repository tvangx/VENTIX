import { INestApplication, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { Logger, ProblemJsonFilter } from "@ticketing/common";
import helmet from "helmet";
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
