import { authEnvShape, refineAuthEnv } from "@ticketing/auth-guard";
import { z } from "zod";
import { DEFAULT_PORT } from "../service.constants";

const secretKey = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/)
  .refine((value) => Buffer.from(value, "base64").toString("base64") === value);
const keyRing = z.string().transform((value, context): Record<string, string> => {
  try {
    return z.record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), secretKey).parse(JSON.parse(value));
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected JSON with base64 256-bit keys",
    });
    return z.NEVER;
  }
});

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    LOG_FILE_PATH: z.string().min(1).optional(),
    LOG_FILE_MAX_BYTES: z.coerce.number().int().min(1024).default(10_485_760),
    LOG_FILE_MAX_FILES: z.coerce.number().int().min(1).max(10).default(3),
    DATABASE_URL: z.string().url(),
    KYC_ENABLED: z.enum(["true", "false"]).default("false"),
    IDENTITY_OUTBOX_ENABLED: z.enum(["true", "false"]).default("false"),
    KAFKA_BROKERS: z
      .string()
      .regex(/^[^,\s]+(\s*,\s*[^,\s]+)*$/)
      .default("localhost:9092"),
    KYC_REDIS_URL: z
      .string()
      .url()
      .refine((value) => ["redis:", "rediss:"].includes(new URL(value).protocol))
      .optional(),
    KYC_ENCRYPTION_KEYS: keyRing.optional(),
    KYC_ACTIVE_KEY_ID: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    KYC_HMAC_PEPPER: secretKey.optional(),
    KYC_OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(600).default(300),
    KYC_OTP_COOLDOWN_SECONDS: z.coerce.number().int().min(30).max(600).default(60),
    KYC_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    KYC_SMTP_HOST: z.string().min(1).optional(),
    KYC_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    KYC_SMTP_SECURE: z.enum(["true", "false"]).default("false"),
    KYC_SMTP_REQUIRE_TLS: z.enum(["true", "false"]).default("false"),
    KYC_SMTP_USER: z.string().min(1).optional(),
    KYC_SMTP_PASSWORD: z.string().min(1).optional(),
    KYC_SMTP_FROM: z.string().email().optional(),
    KYC_TEST_MAILPIT_IMAGE: z.string().min(1).default("axllent/mailpit:v1.33.0"),
    INTERNAL_API_KEY: z.string().min(16).optional(),
    JWT_PRIVATE_KEY_PEM: z.string().min(1).optional(),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(2592000).default(604800),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    ADMIN_EMAIL: z.string().trim().toLowerCase().email().optional(),
    ADMIN_PASSWORD: z.string().min(12).max(128).optional(),
    MINIO_ENDPOINT: z.string().url().default("http://localhost:9000"),
    MINIO_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .default("organizer-docs"),
    MINIO_ACCESS_KEY: z.string().min(1).optional(),
    MINIO_SECRET_KEY: z.string().min(1).optional(),
    GOOGLE_REDIRECT_URI: z.string().url().default("http://localhost:3001/v1/auth/google/callback"),
    /** Đặt biến này mới bật OpenTelemetry. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    ...authEnvShape,
  })
  .superRefine((env, ctx) => {
    refineAuthEnv(env, ctx);
    if (env.KYC_ENABLED === "true") {
      if (
        !env.KYC_REDIS_URL ||
        !env.KYC_HMAC_PEPPER ||
        !env.KYC_ACTIVE_KEY_ID ||
        !env.KYC_ENCRYPTION_KEYS ||
        !Object.hasOwn(env.KYC_ENCRYPTION_KEYS, env.KYC_ACTIVE_KEY_ID)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["KYC_ACTIVE_KEY_ID"],
          message: "KYC requires Redis, key ring, active key and HMAC pepper",
        });
      if (!env.KYC_SMTP_HOST || !env.KYC_SMTP_FROM)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["KYC_SMTP_HOST"],
          message: "KYC requires SMTP host and sender",
        });
      if (
        env.NODE_ENV === "production" &&
        env.KYC_SMTP_SECURE !== "true" &&
        env.KYC_SMTP_REQUIRE_TLS !== "true"
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["KYC_SMTP_REQUIRE_TLS"],
          message: "Production OTP delivery requires TLS",
        });
    }
    if (Boolean(env.KYC_SMTP_USER) !== Boolean(env.KYC_SMTP_PASSWORD))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["KYC_SMTP_USER"],
        message: "Configure both SMTP user and password",
      });
    if (Boolean(env.MINIO_ACCESS_KEY) !== Boolean(env.MINIO_SECRET_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MINIO_ACCESS_KEY"],
        message: "Configure both MinIO access key and secret key",
      });
    }
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_CLIENT_ID"],
        message: "Configure both Google client ID and secret",
      });
    }
    if (
      env.NODE_ENV === "production" &&
      env.GOOGLE_CLIENT_ID &&
      !env.GOOGLE_REDIRECT_URI.startsWith("https://")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_REDIRECT_URI"],
        message: "Production Google callback requires HTTPS",
      });
    }
    if (env.NODE_ENV === "production" && !env.JWT_PRIVATE_KEY_PEM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_PRIVATE_KEY_PEM"],
        message: "Production requires a persistent RSA private key",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
