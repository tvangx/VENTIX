import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useThemeStore, type ThemePreference } from "@/lib/theme/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Sáng", icon: Sun },
  { value: "dark", label: "Tối", icon: Moon },
  { value: "system", label: "Theo hệ thống", icon: Monitor },
];

/** Ba nút bật/tắt (aria-pressed) trong một nhóm; dùng trên nền stage (header, trang đăng nhập). */
export function ThemeToggle({ className }: { className?: string }) {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  return (
    <div
      role="group"
      aria-label="Giao diện"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border-2 border-stage-foreground p-0.5 dark:border-stage-foreground/40",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            title={label}
            onClick={() => setPreference(value)}
            className={cn(
              "inline-flex size-10 cursor-pointer items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-stage-emphasis/70",
              active
                ? "bg-stage-foreground text-stage"
                : "text-stage-foreground hover:bg-stage-foreground/15",
            )}
          >
            <Icon aria-hidden className="size-[18px]" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
