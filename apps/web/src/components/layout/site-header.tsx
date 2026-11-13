import { useQueryClient } from "@tanstack/react-query";
import { Menu, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { LogoLink } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/auth/auth-api";
import { loginPathFor } from "@/lib/auth/redirect";
import { useAuthStore } from "@/lib/http/auth-store";
import { cn } from "@/lib/utils";
import { MAIN_NAV } from "./nav";

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "rounded-md underline-offset-8 outline-none hover:text-stage-emphasis focus-visible:ring-[3px] focus-visible:ring-stage-emphasis/70",
    isActive && "text-stage-emphasis underline decoration-2",
  );
}

function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    try {
      await logout(queryClient);
    } finally {
      navigate("/", { replace: true });
    }
  };
}

export function SiteHeader() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();
  const onLogout = useLogout();
  // Menu mobile gắn với trang lúc mở: đổi trang thì tự đóng, không cần effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const menuOpen = openOn === location.pathname;
  const setMenuOpen = (open: boolean) => setOpenOn(open ? location.pathname : null);
  const menuId = useId();
  const loginTo = loginPathFor(`${location.pathname}${location.search}`);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenOn(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const authed = status === "authenticated";

  return (
    <header className="relative border-b-2 border-stage-rule bg-stage text-stage-foreground dark:border-b">
      <div className="mx-auto flex max-w-[1312px] items-center justify-between gap-4 px-4 py-3.5 md:px-8 md:py-6 xl:px-16">
        <LogoLink />

        <nav
          aria-label="Chính"
          className="hidden items-center gap-8 text-[17px] font-semibold md:flex"
        >
          {MAIN_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          {authed ? (
            <>
              <Button asChild variant="paper" size="sm">
                <Link to="/account">Tài khoản</Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="hover:bg-stage-foreground/15"
                onClick={onLogout}
              >
                Đăng xuất
              </Button>
            </>
          ) : (
            <Button asChild variant="paper" size="sm">
              <Link to={loginTo}>Đăng nhập</Link>
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1.5 md:hidden">
          {authed ? null : (
            <Button asChild variant="paper" size="sm">
              <Link to={loginTo}>Đăng nhập</Link>
            </Button>
          )}
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={menuOpen ? "Đóng menu" : "Mở menu"}
            onClick={() => setMenuOpen(!menuOpen)}
            className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full border-2 border-stage-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-stage-emphasis/70"
          >
            {menuOpen ? (
              <X aria-hidden className="size-5" />
            ) : (
              <Menu aria-hidden className="size-5" />
            )}
          </button>
        </div>
      </div>

      <div
        id={menuId}
        hidden={!menuOpen}
        className="border-t border-stage-foreground/20 px-4 pt-2 pb-5 md:hidden"
      >
        <nav aria-label="Chính (mobile)" className="flex flex-col text-lg font-semibold">
          {MAIN_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={cn(navClass, "py-3")}>
              {item.label}
            </NavLink>
          ))}
          {authed ? (
            <NavLink to="/account" className={cn(navClass, "py-3")}>
              Tài khoản
            </NavLink>
          ) : null}
        </nav>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <ThemeToggle />
          {authed ? (
            <Button
              variant="outline"
              size="sm"
              className="hover:bg-stage-foreground/15"
              onClick={onLogout}
            >
              Đăng xuất
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
