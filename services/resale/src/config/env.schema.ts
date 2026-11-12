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
    INTERNAL_API_KEY: z.string().min(16).optional(),
    RESALE_WORKERS_ENABLED: z.enum(["true", "false"]).default("false"),
    RESALE_RECOVERY_ENABLED: z.enum(["true", "false"]).default("false"),
    RESALE_RECOVERY_POLL_MS: z.coerce.number().int().min(100).max(60000).default(1000),
    KAFKA_BROKERS: z
      .string()
      .regex(/^[^,\s]+(?::\d+)?(\s*,\s*[^,\s]+(?::\d+)?)*$/)
      .default("localhost:9092"),
    TICKET_SERVICE_URL: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash
        );
      })
      .default("http://localhost:3005"),
    /** Đặt biến này mới bật OpenTelemetry. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    ...authEnvShape,
  })
  .superRefine((env, ctx) => {
    refineAuthEnv(env, ctx);
    if (env.RESALE_RECOVERY_ENABLED === "true" && !env.INTERNAL_API_KEY)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["INTERNAL_API_KEY"],
        message: "Recovery requires the internal Ticket API key",
      });
  });

export type Env = z.infer<typeof envSchema>;
