import { authEnvShape, refineAuthEnv } from "@ticketing/auth-guard";
import { z } from "zod";
import { DEFAULT_PORT } from "../service.constants";

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    KAFKA_BROKERS: z
      .string()
      .default("localhost:9092")
      .transform((value) => value.split(",").map((broker) => broker.trim()))
      .refine(
        (brokers) => brokers.length > 0 && brokers.every((broker) => /^[^\s:,]+:\d+$/.test(broker)),
        "KAFKA_BROKERS must contain host:port entries",
      ),
    EVENT_CONSUMER_GROUP_ID: z.string().min(1).default("booking-event-lifecycle"),
    EVENT_CONSUMER_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    REHYDRATE_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    REDIS_URL: z
      .string()
      .url()
      .refine(
        (value) => ["redis:", "rediss:"].includes(new URL(value).protocol),
        "REDIS_URL must use redis or rediss",
      )
      .default("redis://localhost:6379"),
    HOLD_TTL_SECONDS: z.coerce.number().int().positive().max(86400).default(600),
    HOLD_MAX_SEATS: z.coerce.number().int().positive().max(1000).default(6),
    ADMISSION_REQUIRED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    HOLDLOG_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            ["postgres:", "postgresql:"].includes(url.protocol) &&
            decodeURIComponent(url.username) === "booking_user" &&
            url.pathname === "/booking_db"
          );
        } catch {
          return false;
        }
      }, "DATABASE_URL must use booking_user and booking_db"),
    /** Đặt biến này mới bật OpenTelemetry. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    ...authEnvShape,
  })
  .superRefine((env, ctx) => refineAuthEnv(env, ctx));

export type Env = z.infer<typeof envSchema>;
