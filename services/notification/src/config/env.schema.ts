import { authEnvShape, refineAuthEnv } from "@ticketing/auth-guard";
import { z } from "zod";
import { DEFAULT_PORT } from "../service.constants";

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DATABASE_URL: z.string().url(),
    /** Đặt biến này mới bật OpenTelemetry. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    ...authEnvShape,
  })
  .superRefine((env, ctx) => refineAuthEnv(env, ctx));

export type Env = z.infer<typeof envSchema>;
