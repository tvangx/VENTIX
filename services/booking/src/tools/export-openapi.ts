import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, loadEnv } from "@ticketing/common";
import { buildOpenApi, createApp } from "../bootstrap";
import { envSchema } from "../config/env.schema";
import { SERVICE_NAME } from "../service.constants";

/** Sinh openapi.json mà không cần DB/identity chạy (các giá trị dưới đây chỉ là giả để qua validate). */
async function main(): Promise<void> {
  const env = loadEnv(envSchema, {
    NODE_ENV: "test",
    REHYDRATE_ENABLED: "false",
    EVENT_CONSUMER_ENABLED: "false",
    PORT: "1",
    DATABASE_URL: "postgresql://booking_user:openapi@localhost:5432/booking_db",
    AUTH_ISSUER: "openapi-export",
    AUTH_AUDIENCE: "openapi-export",
    AUTH_JWKS_URI: "http://localhost/jwks.json",
  });
  const app = await createApp(env, createLogger(SERVICE_NAME, { level: "silent" }));
  await app.init();
  const doc = buildOpenApi(app);
  writeFileSync(join(__dirname, "..", "..", "openapi.json"), `${JSON.stringify(doc, null, 2)}\n`);
  await app.close();
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
