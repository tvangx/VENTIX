import { authEnvShape, refineAuthEnv } from "@ticketing/auth-guard";
import { z } from "zod";
import { DEFAULT_PORT } from "../service.constants";

const encryptionKeys = z.string().transform((value, context): Record<string, string> => {
  try {
    return z
      .record(
        z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        z
          .string()
          .regex(/^[A-Za-z0-9+/]{43}=$/)
          .refine(
            (key) =>
              Buffer.from(key, "base64").length === 32 &&
              Buffer.from(key, "base64").toString("base64") === key,
          ),
      )
      .parse(JSON.parse(value));
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected a JSON key ring of canonical base64 32-byte keys",
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
    DATABASE_URL: z.string().url(),
    TICKET_WORKERS_ENABLED: z.enum(["true", "false"]).default("false"),
    INTERNAL_API_KEY: z.string().min(16).optional(),
    TICKET_PACKAGE_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
    TICKET_PACKAGE_MAX_TICKETS: z.coerce.number().int().min(1).max(100000).default(10000),
    NFT_WORKER_ENABLED: z.enum(["true", "false"]).default("false"),
    NFT_PROVIDER: z.literal("MOCK").default("MOCK"),
    NFT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    NFT_POLL_MS: z.coerce.number().int().min(10).max(60000).default(1000),
    NFT_TIMEOUT_MS: z.coerce.number().int().min(10).max(60000).default(10000),
    NFT_LEASE_MS: z.coerce.number().int().min(100).max(300000).default(30000),
    NFT_RETRY_BASE_MS: z.coerce.number().int().min(10).max(60000).default(1000),
    NFT_RETRY_MAX_MS: z.coerce.number().int().min(10).max(3600000).default(60000),
    KAFKA_BROKERS: z
      .string()
      .regex(/^[^,\s]+(?::\d+)?(\s*,\s*[^,\s]+(?::\d+)?)*$/)
      .default("localhost:9092"),
    TICKET_ENCRYPTION_KEYS: encryptionKeys.optional(),
    TICKET_ACTIVE_KEY_ID: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    /** Đặt biến này mới bật OpenTelemetry. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    ...authEnvShape,
  })
  .superRefine((env, ctx) => {
    refineAuthEnv(env, ctx);
    if (env.NFT_LEASE_MS <= env.NFT_TIMEOUT_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NFT_LEASE_MS"],
        message: "Lease must exceed provider timeout",
      });
    }
    if (env.NFT_RETRY_MAX_MS < env.NFT_RETRY_BASE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NFT_RETRY_MAX_MS"],
        message: "Retry maximum must be at least its base",
      });
    }
    if (
      env.TICKET_WORKERS_ENABLED === "true" ||
      env.TICKET_ENCRYPTION_KEYS ||
      env.TICKET_ACTIVE_KEY_ID
    ) {
      if (
        !env.TICKET_ACTIVE_KEY_ID ||
        !env.TICKET_ENCRYPTION_KEYS ||
        !Object.hasOwn(env.TICKET_ENCRYPTION_KEYS, env.TICKET_ACTIVE_KEY_ID)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TICKET_ACTIVE_KEY_ID"],
          message: "An active key present in TICKET_ENCRYPTION_KEYS is required",
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;
