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
    INTERNAL_API_KEY: z.string().min(1).optional(),
    REDIS_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith("redis://") || value.startsWith("rediss://"))
      .default("redis://localhost:6379"),
    KAFKA_BROKERS: z
      .string()
      .default("localhost:9092")
      .transform((value) => value.split(",").map((broker) => broker.trim()))
      .pipe(
        z
          .array(
            z
              .string()
              .regex(/^(?:[^:\s]+|\[[\da-fA-F:.]+\]):\d+$/)
              .refine((broker) => {
                const port = Number(broker.slice(broker.lastIndexOf(":") + 1));
                return port > 0 && port <= 65535;
              }),
          )
          .min(1),
      ),
    EVENT_OUTBOX_ENABLED: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    /** Đặt biến này mới bật OpenTelemetry. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    ...authEnvShape,
  })
  .superRefine((env, ctx) => refineAuthEnv(env, ctx))
  .transform((env) => ({
    ...env,
    EVENT_OUTBOX_ENABLED: env.EVENT_OUTBOX_ENABLED ?? env.NODE_ENV !== "test",
  }));

export type Env = z.infer<typeof envSchema>;
