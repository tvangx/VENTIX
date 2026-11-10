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
    EVENT_INTERNAL_URL: z
      .string()
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
        } catch {
          return false;
        }
      }, "EVENT_INTERNAL_URL must use HTTP(S) without credentials")
      .default("http://localhost:3002"),
    INTERNAL_API_KEY: z.string().min(1),
    ORDER_PAYMENT_WINDOW_SECONDS: z.coerce.number().int().positive().max(86400).default(900),
    ORDER_EXPIRY_GRACE_SECONDS: z.coerce.number().int().nonnegative().max(3600).default(30),
    MERCH_INTERNAL_URL: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
      }, "MERCH_INTERNAL_URL must use HTTP(S) without credentials")
      .default("http://localhost:3007"),
    MERCH_QUOTE_TIMEOUT_MS: z.coerce.number().int().positive().max(10000).default(800),
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
      .default("true")
      .transform((value) => value === "true"),
    ADMISSION_TOKEN_SECRET: z.string().min(32).optional(),
    ADMISSION_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(600).default(600),
    ADMISSION_MAX_ACTIVE: z.coerce.number().int().positive().max(10000).default(1000),
    QUEUE_TTL_SECONDS: z.coerce.number().int().min(600).max(604800).default(86400),
    QUEUE_MAX_STREAMS: z.coerce.number().int().positive().max(10000).default(1000),
    QUEUE_WORKER_ENABLED: z
      .enum(["true", "false"])
      .default("true")
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
  .superRefine((env, ctx) => {
    refineAuthEnv(env, ctx);
    if (env.ADMISSION_REQUIRED && !env.ADMISSION_TOKEN_SECRET)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ADMISSION_TOKEN_SECRET"],
        message:
          "ADMISSION_TOKEN_SECRET is required when admission is enabled (at least 32 characters)",
      });
  });

export type Env = z.infer<typeof envSchema>;

export const seatPricingSeedSchema = z.object({
  SEED_EVENT_ID: z.string().uuid(),
  SEED_SEAT_MAP_VERSION: z.coerce.number().int().positive(),
  SEED_SEATS_FILE: z.string().min(1),
});
