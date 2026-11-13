import { Navigate, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { loginPathFor, safeNextPath } from "@/lib/auth/redirect";
import { useAuthStore } from "@/lib/http/auth-store";

export function SessionPending() {
  return (
    <div role="status" className="flex min-h-[40vh] items-center justify-center p-6 text-lg">
      Đang kiểm tra phiên đăng nhập…
    </div>
  );
}

/** Trang cần đăng nhập: chưa đăng nhập thì sang /login và quay lại đúng trang này sau đó. */
export function RequireAuth() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();
  if (status === "unknown") return <SessionPending />;
  if (status === "anonymous") {
    return <Navigate to={loginPathFor(`${location.pathname}${location.search}`)} replace />;
  }
  return <Outlet />;
}

/** Trang đăng nhập/đăng ký: đã đăng nhập thì đi thẳng tới trang `next`. */
export function GuestOnly() {
  const status = useAuthStore((state) => state.status);
  const [params] = useSearchParams();
  if (status === "authenticated") {
    return <Navigate to={safeNextPath(params.get("next"))} replace />;
  }
  return <Outlet />;
}
