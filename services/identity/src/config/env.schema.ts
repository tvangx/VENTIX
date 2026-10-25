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
    /** Đặt biến này mới bật OpenTelemetry. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    ...authEnvShape,
  })
  .superRefine((env, ctx) => {
    refineAuthEnv(env, ctx);
    if (env.NODE_ENV === "production" && !env.JWT_PRIVATE_KEY_PEM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_PRIVATE_KEY_PEM"],
        message: "Production requires a persistent RSA private key",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
