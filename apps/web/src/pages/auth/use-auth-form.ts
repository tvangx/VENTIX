import { useState, type FormEvent } from "react";
import type { z } from "zod";
import { authErrorMessage } from "@/lib/auth/errors";
import { fieldErrors, type Credentials, type FieldErrors } from "@/lib/auth/validation";

interface AuthFormOptions {
  schema: z.ZodType<Credentials>;
  submit: (credentials: Credentials) => Promise<void>;
}

/**
 * Trạng thái chung của form đăng nhập/đăng ký: validate bằng zod trước khi gọi API,
 * chặn gửi trùng khi đang chờ, đổi lỗi API thành câu tiếng Việt.
 */
export function useAuthForm({ schema, submit }: AuthFormOptions) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = schema.safeParse({
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
    });
    setFormError(null);
    if (!parsed.success) {
      const next = fieldErrors(parsed.error);
      setErrors(next);
      const first = next.email ? "email" : "password";
      const input = form.elements.namedItem(first);
      if (input instanceof HTMLInputElement) input.focus();
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await submit(parsed.data);
    } catch (error) {
      setFormError(authErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return { errors, formError, pending, onSubmit };
}
