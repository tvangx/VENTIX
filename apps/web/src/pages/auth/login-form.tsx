import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { login } from "@/lib/auth/auth-api";
import { loginSchema } from "@/lib/auth/validation";
import { FormAlert } from "./form-alert";
import { useAuthForm } from "./use-auth-form";

export function LoginForm({ next }: { next: string }) {
  const navigate = useNavigate();
  const { errors, formError, pending, onSubmit } = useAuthForm({
    schema: loginSchema,
    submit: async (credentials) => {
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
        autoComplete="current-password"
        error={errors.password}
      />
      <FormAlert message={formError} />
      <Button type="submit" size="lg" className="h-[62px] text-lg" disabled={pending}>
        {pending ? "Đang vào…" : "Vào cửa →"}
      </Button>
    </form>
  );
}
