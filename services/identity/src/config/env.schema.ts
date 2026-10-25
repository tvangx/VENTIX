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
    JWT_PRIVATE_KEY_PEM: z.string().min(1).optional(),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(2592000).default(604800),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    ADMIN_EMAIL: z.string().trim().toLowerCase().email().optional(),
    ADMIN_PASSWORD: z.string().min(12).max(128).optional(),
    GOOGLE_REDIRECT_URI: z.string().url().default("http://localhost:3001/v1/auth/google/callback"),
    /** Đặt biến này mới bật OpenTelemetry. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    ...authEnvShape,
  })
  .superRefine((env, ctx) => {
    refineAuthEnv(env, ctx);
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
