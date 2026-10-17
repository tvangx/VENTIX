import type { ZodTypeAny, z } from "zod";

/**
 * Nạp và validate biến môi trường (fail-fast). Đây là nơi DUY NHẤT được đọc
 * `process.env`. Thông báo lỗi chỉ nêu tên biến, không in giá trị (tránh lộ bí mật).
 */
export function loadEnv<S extends ZodTypeAny>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}
