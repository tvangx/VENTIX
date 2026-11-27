import "reflect-metadata";
import "dotenv/config"; // chỉ nạp file .env khi dev; trong container không có file này thì bỏ qua
import { createLogger, loadEnv } from "@ticketing/common";
import { envSchema } from "./config/env.schema";
import { SERVICE_NAME } from "./service.constants";
import { startTelemetry } from "./telemetry";

async function main(): Promise<void> {
  const env = loadEnv(envSchema); // fail-fast nếu thiếu/sai biến
  await startTelemetry(env, SERVICE_NAME);

  const logger = createLogger(SERVICE_NAME, {
    level: env.LOG_LEVEL,
    file: env.LOG_FILE_PATH
      ? {
          path: env.LOG_FILE_PATH,
          maxBytes: env.LOG_FILE_MAX_BYTES,
          maxFiles: env.LOG_FILE_MAX_FILES,
        }
      : undefined,
  });
  // Nạp muộn để OpenTelemetry (nếu bật) đã vá http/express trước.
  const { createApp } = await import("./bootstrap");
  const app = await createApp(env, logger);
  await app.listen(env.PORT, "0.0.0.0");
  logger.info({ port: env.PORT }, "service started");
}

main().catch((err: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: "fatal", service: SERVICE_NAME, msg: String(err) })}\n`,
  );
  process.exit(1);
});
