import { isAxiosError } from "axios";
import { z } from "zod";

// RFC 7807 theo CONVENTIONS mục 4; service có thể thêm trường riêng (ví dụ seat_id) nên dùng passthrough.
export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    code: z.string(),
    request_id: z.string().nullable().optional(),
  })
  .passthrough();

export type Problem = z.infer<typeof ProblemSchema>;

/** Lấy problem+json từ lỗi axios; trả null khi lỗi mạng hoặc body không đúng dạng. */
export function toProblem(error: unknown): Problem | null {
  if (!isAxiosError(error) || !error.response) {
    return null;
  }
  const parsed = ProblemSchema.safeParse(error.response.data);
  return parsed.success ? parsed.data : null;
}
