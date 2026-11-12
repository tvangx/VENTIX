import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { takeRememberedNext } from "@/lib/auth/redirect";
import { restoreSession } from "@/lib/auth/session";
import { useAuthStore } from "@/lib/http/auth-store";

/**
 * Identity đặt refresh cookie rồi đưa về /auth/callback?provider=google (không có token trên URL).
 * Trang này chỉ cần đổi cookie lấy access token (chung luồng khôi phục phiên, single-flight)
 * rồi quay về trang người dùng đang xem trước khi đi Google.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const status = useAuthStore((state) => state.status);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void restoreSession().then(() => {
      if (!active) return;
      if (useAuthStore.getState().status === "authenticated") {
        navigate(takeRememberedNext(), { replace: true });
      } else {
        setFailed(true);
      }
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-stage p-6 text-center text-stage-foreground">
      {failed || status === "anonymous" ? (
        <>
          <h1 className="m-0 text-3xl font-extrabold tracking-tight">Chưa đăng nhập được</h1>
          <p role="alert" className="m-0 max-w-[40ch] text-lg">
            Phiên đăng nhập Google không hoàn tất hoặc đã hết hạn. Hãy thử lại.
          </p>
          <Button asChild variant="paper">
            <Link to="/login">Về trang đăng nhập</Link>
          </Button>
        </>
      ) : (
        <p role="status" className="m-0 text-lg">
          Đang hoàn tất đăng nhập…
        </p>
      )}
    </main>
  );
}
