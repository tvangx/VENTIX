import { z } from "zod";

// Giới hạn lấy từ CredentialsDto trong OpenAPI identity: email ≤ 254, mật khẩu 12–128 ký tự.
export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

const email = z
  .string()
  .trim()
  .min(1, "Nhập email.")
  .max(EMAIL_MAX, "Email quá dài.")
  .email("Email chưa đúng định dạng.");

// Đăng nhập chỉ kiểm tra có nhập; độ dài là chuyện của lúc tạo mật khẩu.
export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Nhập mật khẩu.").max(PASSWORD_MAX, "Mật khẩu quá dài."),
});

export const registerSchema = z.object({
  email,
  password: z
    .string()
    .min(PASSWORD_MIN, `Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự.`)
    .max(PASSWORD_MAX, `Mật khẩu tối đa ${PASSWORD_MAX} ký tự.`),
});

export type Credentials = z.infer<typeof loginSchema>;
export type FieldErrors = Partial<Record<keyof Credentials, string>>;

/** Lỗi đầu tiên của từng trường, để hiện ngay dưới ô nhập. */
export function fieldErrors(error: z.ZodError<Credentials>): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if ((field === "email" || field === "password") && !result[field]) {
      result[field] = issue.message;
    }
  }
  return result;
}
