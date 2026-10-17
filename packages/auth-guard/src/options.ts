import { z } from "zod";

/** Cấu hình runtime của auth-guard (do service truyền vào từ `loadEnv`). */
export interface AuthGuardOptions {
  issuer: string;
  audience: string;
  /** Khuyến nghị cho mọi môi trường thật: JWKS của identity-service. */
  jwksUri?: string;
  /** Chỉ dùng dev/test. */
  publicKeyPem?: string;
  /** Thời gian tối thiểu giữa 2 lần tải lại JWKS khi gặp `kid` lạ. Mặc định 30s. */
  jwksCooldownMs?: number;
  /** Thời gian cache JWKS. Mặc định 10 phút. */
  jwksCacheMs?: number;
  clockToleranceSec?: number;
}

export const AUTH_OPTIONS = Symbol("AUTH_OPTIONS");

/**
 * Mảnh schema zod để service gộp vào `env.schema.ts`.
 * `AUTH_PUBLIC_KEY_PEM` bị cấm khi NODE_ENV=production.
 */
export const authEnvShape = {
  AUTH_ISSUER: z.string().min(1),
  AUTH_AUDIENCE: z.string().min(1),
  AUTH_JWKS_URI: z.string().url().optional(),
  AUTH_PUBLIC_KEY_PEM: z.string().min(1).optional(),
};

export function refineAuthEnv<
  T extends { NODE_ENV: string; AUTH_JWKS_URI?: string; AUTH_PUBLIC_KEY_PEM?: string },
>(env: T, ctx: z.RefinementCtx): void {
  if (!env.AUTH_JWKS_URI && !env.AUTH_PUBLIC_KEY_PEM) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH_JWKS_URI"],
      message: "AUTH_JWKS_URI or AUTH_PUBLIC_KEY_PEM is required",
    });
  }
  if (env.NODE_ENV === "production" && env.AUTH_PUBLIC_KEY_PEM) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH_PUBLIC_KEY_PEM"],
      message: "AUTH_PUBLIC_KEY_PEM is dev/test only; use AUTH_JWKS_URI in production",
    });
  }
}
