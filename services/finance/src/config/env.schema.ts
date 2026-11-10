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
    VAT_RATE_TICKET: z.coerce.number().min(0).max(1).multipleOf(0.0001).default(0.1),
    VAT_RATE_MERCH: z.coerce.number().min(0).max(1).multipleOf(0.0001).default(0.1),
    PRICES_INCLUDE_VAT: z.enum(["true"]).default("true"),
    FINANCE_WORKERS_ENABLED: z.enum(["true", "false"]).default("false"),
    KAFKA_BROKERS: z.string().min(1).default("localhost:9092"),
    EVENT_SERVICE_URL: z.string().url().default("http://localhost:3002"),
    INTERNAL_API_KEY: z.string().min(16).optional(),
    FINANCE_POLL_MS: z.coerce.number().int().min(100).default(1000),
    /** Đặt biến này mới bật OpenTelemetry. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    ...authEnvShape,
  })
  .superRefine((env, ctx) => {
    refineAuthEnv(env, ctx);
    if (env.FINANCE_WORKERS_ENABLED === "true" && !env.INTERNAL_API_KEY)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["INTERNAL_API_KEY"],
        message: "Required for seat-class prefetch",
      });
  });

export type Env = z.infer<typeof envSchema>;
