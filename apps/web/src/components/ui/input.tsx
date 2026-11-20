import * as React from "react";
import { cn } from "@/lib/utils";

// Ô nhập V-105: gạch chân đậm; lỗi gạch chân nét đứt (không dùng màu riêng), focus gạch chân xanh lá.
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-14 w-full min-w-0 rounded-[14px] border-0 border-b-4 border-input bg-field px-[18px] text-[17px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-link focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-dashed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
