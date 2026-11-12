import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Nút dạng viên thuốc theo quy chuẩn V-105; chiều cao mặc định ≥ 44px cho vùng chạm.
const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full font-bold transition-colors disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/85",
        outline: "border-2 border-current bg-transparent hover:bg-accent",
        paper: "bg-stage-foreground text-stage hover:bg-stage-foreground/85",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        default: "h-12 px-6 text-base",
        sm: "h-11 px-[18px] text-[15px]",
        lg: "h-14 px-7 text-[17px]",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
