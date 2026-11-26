import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

// Ô nhập dùng trong wizard: cùng kiểu với `Input` (V-105: gạch chân đậm, lỗi gạch chân nét đứt),
// nhãn nối với ô và lỗi nối bằng aria-describedby.

const control =
  "w-full min-w-0 rounded-[12px] border-0 border-b-4 border-input bg-field px-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-link focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-dashed disabled:opacity-60";

interface Shared {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
}

function Wrap({
  id,
  label,
  error,
  hint,
  className,
  children,
}: Shared & { id: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="m-0 text-sm font-bold text-destructive">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className="m-0 text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: string) {
  return (
    [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") ||
    undefined
  );
}

export function TextField({
  label,
  error,
  hint,
  className,
  ...props
}: Shared & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">) {
  const id = useId();
  return (
    <Wrap id={id} label={label} error={error} hint={hint} className={className}>
      <input
        id={id}
        className={cn(control, "h-12")}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        {...props}
      />
    </Wrap>
  );
}

export function SelectField({
  label,
  error,
  hint,
  className,
  children,
  ...props
}: Shared & Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className">) {
  const id = useId();
  return (
    <Wrap id={id} label={label} error={error} hint={hint} className={className}>
      <select
        id={id}
        className={cn(control, "h-12 cursor-pointer")}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        {...props}
      >
        {children}
      </select>
    </Wrap>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  className,
  ...props
}: Shared & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">) {
  const id = useId();
  return (
    <Wrap id={id} label={label} error={error} hint={hint} className={className}>
      <textarea
        id={id}
        className={cn(control, "min-h-32 py-3 leading-relaxed")}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        {...props}
      />
    </Wrap>
  );
}

export function CheckField({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-6 shrink-0 cursor-pointer accent-[#11804a]"
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer font-semibold">
          {label}
        </label>
        {hint ? (
          <span id={`${id}-hint`} className="text-sm text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Thông báo lỗi chung của một bước (lỗi API). */
export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="m-0 bg-accent px-4 py-3 font-bold text-accent-foreground">
      {message}
    </p>
  );
}

/** Tiêu đề bước. */
export function StepHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="m-0 text-3xl font-extrabold tracking-[-0.04em] md:text-4xl">{title}</h2>
      {children ? <p className="m-0 max-w-[60ch] text-base leading-relaxed">{children}</p> : null}
    </div>
  );
}
