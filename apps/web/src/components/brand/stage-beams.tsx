import { cn } from "@/lib/utils";

/**
 * Chùm đèn sân khấu: đa giác màu phẳng, không gradient (V-105).
 * Độ trong lấy từ token theo theme: trên nền sáng chùm xanh nhạt đậm hơn để còn nhìn thấy.
 */
export function StageBeams({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1440 960"
      preserveAspectRatio="none"
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
    >
      <polygon
        points="980,0 1020,0 1300,960 700,960"
        fill="#a7e8c5"
        style={{ opacity: "var(--beam-pale)" }}
      />
      <polygon
        points="240,0 266,0 520,960 20,960"
        fill="#11804a"
        style={{ opacity: "var(--beam-deep)" }}
      />
    </svg>
  );
}
