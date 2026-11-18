import { useState } from "react";
import { Button } from "@/components/ui/button";
import { startGoogleLogin } from "@/lib/auth/auth-api";
import { authErrorMessage } from "@/lib/auth/errors";
import { rememberNext } from "@/lib/auth/redirect";
import { FormAlert } from "./form-alert";

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[22px]!">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8h-4v3.1A12 12 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8Z"
      />
    </svg>
  );
}

export function GoogleButton({ label, next }: { label: string; next: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    // Google đưa người dùng về /auth/callback; nhớ trang cần quay lại trong sessionStorage.
    rememberNext(next);
    try {
      await startGoogleLogin();
    } catch (cause) {
      setError(authErrorMessage(cause));
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        size="lg"
        onClick={onClick}
        disabled={pending}
        className="border-2 border-[#1c1c20] bg-white text-[#1c1c20] hover:bg-white/85 dark:border-[#f4f4f5]/40"
      >
        <GoogleMark />
        {pending ? "Đang chuyển tới Google…" : label}
      </Button>
      <FormAlert message={error} />
    </div>
  );
}
