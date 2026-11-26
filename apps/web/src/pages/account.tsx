import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/auth/auth-api";
import { authErrorMessage } from "@/lib/auth/errors";

const ROLE_LABELS: Record<string, string> = {
  USER: "Khách hàng",
  ORGANIZER: "Ban tổ chức",
  STAFF: "Nhân viên soát vé",
  ADMIN: "Quản trị",
};

/** Trang cần đăng nhập: thông tin tài khoản từ /v1/auth/me. */
export function AccountPage() {
  const me = useMe();
  return (
    <section className="mx-auto flex max-w-[1312px] flex-col gap-6 px-4 py-12 md:px-8 md:py-20 xl:px-16">
      <h1 className="m-0 text-5xl leading-[0.9] font-extrabold tracking-[-0.04em] md:text-7xl">
        Tài khoản <span className="font-serif font-medium text-emphasis italic">của bạn</span>
      </h1>
      {me.isPending ? <p role="status">Đang tải…</p> : null}
      {me.isError ? (
        <p role="alert" className="font-bold text-destructive">
          {authErrorMessage(me.error)}
        </p>
      ) : null}
      {me.data ? (
        <dl className="m-0 grid max-w-xl grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-3 text-lg">
          <dt className="font-semibold">Email</dt>
          <dd className="m-0 break-words">{me.data.email}</dd>
          <dt className="font-semibold">Vai trò</dt>
          <dd className="m-0">
            {me.data.roles.map((role) => ROLE_LABELS[role] ?? role).join(", ")}
          </dd>
          <dt className="font-semibold">Ban tổ chức</dt>
          <dd className="m-0">
            {me.data.memberships.length === 0
              ? "Chưa tham gia"
              : `${me.data.memberships.length} ban tổ chức`}
          </dd>
        </dl>
      ) : null}
      {me.data?.memberships.some((m) => m.role === "ORGANIZER") ? (
        <div>
          <Button asChild size="lg">
            <Link to="/organizer/events">Vào hậu trường ban tổ chức</Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}
