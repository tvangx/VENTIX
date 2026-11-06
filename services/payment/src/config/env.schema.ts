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
    KAFKA_BROKERS: z
      .string()
      .default("localhost:9092")
      .transform((v) => v.split(",")),
    PAYMENT_WORKERS_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    VNPAY_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    VNPAY_TMN_CODE: z.string().default(""),
    VNPAY_HASH_SECRET: z.string().default(""),
    VNPAY_RETURN_URL: z.union([z.literal(""), z.string().url().max(255)]).default(""),
    VNPAY_IPN_URL: z.union([z.literal(""), z.string().url().max(255)]).default(""),
    MOCK_DELAY_MS: z.coerce.number().int().min(0).max(3600000).default(1000),
    MOCK_MAX_DELAY_MS: z.coerce.number().int().min(0).max(3600000).default(3000),
    MOCK_SUCCESS_RATE: z.coerce.number().min(0).max(1).default(0.95),
    MOCK_OUTCOME: z.enum(["RANDOM", "SUCCESS", "FAILURE"]).default("RANDOM"),
    MOCK_DUPLICATE_IPN: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    ...authEnvShape,
  })
  .superRefine((env, ctx) => {
    refineAuthEnv(env, ctx);
    if (env.MOCK_MAX_DELAY_MS < env.MOCK_DELAY_MS)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MOCK_MAX_DELAY_MS"],
        message: "must be >= MOCK_DELAY_MS",
      });
    if (env.VNPAY_ENABLED) {
      for (const key of [
        "VNPAY_TMN_CODE",
        "VNPAY_HASH_SECRET",
        "VNPAY_RETURN_URL",
        "VNPAY_IPN_URL",
      ] as const) {
        if (!env[key])
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: "required when VNPAY_ENABLED",
          });
      }
      if (!/^[A-Za-z0-9]{8}$/.test(env.VNPAY_TMN_CODE))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["VNPAY_TMN_CODE"],
          message: "must be 8 alphanumeric characters",
        });
    }
  });

export type Env = z.infer<typeof envSchema>;
