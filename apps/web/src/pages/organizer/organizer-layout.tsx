import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/auth/auth-api";
import { exchangeTenantToken, useTenantStore } from "@/lib/organizer/tenant";
import { organizerErrorMessage } from "@/lib/organizer/errors";
import { cn } from "@/lib/utils";
import type { OrganizerContext } from "./organizer-context";

// Khu "hậu trường" của ban tổ chức (wireframe V-105 `Wizard-D`/`Wizard-M`): thanh bên tối, nội dung
// nền sáng. Trang con nhận organizerId qua Outlet context sau khi đã có token tenant.

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "block rounded-full px-4 py-3 font-semibold no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-[#2dc275]",
    isActive ? "bg-[#a7e8c5] text-[#1c1c20]" : "text-[#f4f4f5] hover:bg-[#27272a]",
  );

function Sidebar() {
  return (
    // Nền tối phủ hết chiều cao trang; phần menu bên trong dính ở đầu khi cuộn.
    <div className="bg-[#1c1c20] md:w-[260px] md:shrink-0">
      <nav
        aria-label="Ban tổ chức"
        className="flex flex-col gap-6 px-4 py-5 text-[#f4f4f5] md:sticky md:top-0 md:gap-8 md:px-5 md:py-7"
      >
        <Link
          to="/"
          className="w-fit rounded-md text-[28px] leading-none font-extrabold tracking-[-0.05em] text-[#f4f4f5] no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-[#2dc275] md:text-[32px]"
        >
          ventix<span className="text-[#2dc275]">.</span>
          <span className="ml-2 font-serif text-base font-medium tracking-normal text-[#2dc275] italic md:mt-1 md:ml-0 md:block md:text-[17px]">
            hậu trường
          </span>
        </Link>
        <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 text-base md:flex-col">
          <li className="shrink-0">
            <NavLink to="/organizer/events" className={navClass}>
              Sự kiện
            </NavLink>
          </li>
          <li className="shrink-0">
            <NavLink to="/" end className={navClass}>
              Về trang khán giả
            </NavLink>
          </li>
        </ul>
      </nav>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <Sidebar />
      <main id="main" className="min-w-0 flex-1 px-4 pt-6 pb-16 md:px-12 md:pt-9 md:pb-20">
        {children}
      </main>
    </div>
  );
}

/** Đã đăng nhập (RequireAuth bọc ngoài). Kiểm tra quyền ban tổ chức rồi đổi token tenant. */
export function OrganizerLayout() {
  const me = useMe();
  const organizerId =
    me.data?.memberships.find((m) => m.role === "ORGANIZER")?.organizer_id ?? null;
  const tenant = useTenantStore((s) => (s.organizerId === organizerId ? s.token : null));
  // Đổi token tenant một lần; token hết hạn sau đó do interceptor của organizerHttp đổi lại.
  const epoch = useTenantStore((s) => s.epoch);
  const exchange = useQuery({
    queryKey: ["organizer", "tenant-token", organizerId, epoch],
    queryFn: () => exchangeTenantToken(organizerId ?? ""),
    enabled: organizerId !== null && tenant === null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const error = exchange.error;

  if (me.isPending) {
    return (
      <Shell>
        <p role="status">Đang tải tài khoản…</p>
      </Shell>
    );
  }
  if (me.isError || error) {
    return (
      <Shell>
        <div role="alert" className="flex flex-col items-start gap-4">
          <p className="m-0 text-lg font-bold">{organizerErrorMessage(me.error ?? error)}</p>
          <Button
            variant="outline"
            onClick={() => {
              if (me.isError) void me.refetch();
              else void exchange.refetch();
            }}
          >
            Thử lại
          </Button>
        </div>
      </Shell>
    );
  }
  if (!organizerId) {
    return (
      <Shell>
        <section className="flex max-w-2xl flex-col items-start gap-4">
          <h1 className="m-0 text-4xl font-extrabold tracking-[-0.04em] md:text-6xl">
            Chưa là ban tổ chức
          </h1>
          <p className="m-0 text-lg leading-relaxed">
            Tài khoản này chưa thuộc ban tổ chức nào nên chưa tạo được sự kiện. Đăng ký ban tổ chức
            và chờ Admin duyệt hồ sơ trước.
          </p>
          <Button asChild variant="outline">
            <Link to="/">Về trang chủ</Link>
          </Button>
        </section>
      </Shell>
    );
  }
  if (!tenant) {
    return (
      <Shell>
        <p role="status">Đang mở hậu trường…</p>
      </Shell>
    );
  }
  return (
    <Shell>
      <Outlet context={{ organizerId } satisfies OrganizerContext} />
    </Shell>
  );
}
