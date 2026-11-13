import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { login, register } from "@/lib/auth/auth-api";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  registerSchema,
  type Credentials,
} from "@/lib/auth/validation";
import { FormAlert } from "./form-alert";
import { useAuthForm } from "./use-auth-form";

/**
 * Idempotency-Key gắn với nội dung form: bấm gửi lại (mạng chập chờn) cùng email/mật khẩu thì
 * dùng lại key cũ để identity không tạo trùng; đổi nội dung thì tạo key mới, tránh
 * IDEMPOTENCY_KEY_REUSED.
 */
function useIdempotencyKey() {
  const ref = useRef<{ payload: string; key: string } | null>(null);
  return (credentials: Credentials): string => {
    const payload = JSON.stringify([credentials.email, credentials.password]);
    if (ref.current?.payload !== payload) {
      ref.current = { payload, key: crypto.randomUUID() };
    }
    return ref.current.key;
  };
}

export function RegisterForm({ next }: { next: string }) {
  const navigate = useNavigate();
  const keyFor = useIdempotencyKey();
  const { errors, formError, pending, onSubmit } = useAuthForm({
    schema: registerSchema,
    submit: async (credentials) => {
      await register(credentials, keyFor(credentials));
      // Tạo tài khoản xong thì đăng nhập luôn bằng thông tin vừa nhập.
      await login(credentials);
      navigate(next, { replace: true });
    },
  });

  return (
    <form noValidate onSubmit={onSubmit} aria-busy={pending} className="flex flex-col gap-[18px]">
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="ban@vidu.vn"
        error={errors.email}
      />
      <Field
        label="Mật khẩu"
        name="password"
        type="password"
        autoComplete="new-password"
        hint={`Từ ${PASSWORD_MIN} đến ${PASSWORD_MAX} ký tự.`}
        error={errors.password}
      />
      <FormAlert message={formError} />
      <Button type="submit" size="lg" className="h-[62px] text-lg" disabled={pending}>
        {pending ? "Đang tạo tài khoản…" : "Tạo tài khoản →"}
      </Button>
    </form>
  );
}
