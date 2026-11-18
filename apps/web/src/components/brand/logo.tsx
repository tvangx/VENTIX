import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/** Chữ "ventix." của V-105; dấu chấm xanh lá. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-extrabold tracking-[-0.05em]", className)}>
      ventix<span className="text-primary">.</span>
    </span>
  );
}

export function LogoLink({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      aria-label="VENTIX, về trang chủ"
      className={cn(
        "rounded-md text-[28px] leading-none no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 md:text-[34px]",
        className,
      )}
    >
      <Wordmark />
    </Link>
  );
}
