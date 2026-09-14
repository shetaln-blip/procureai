import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-ledger-mono text-[11px] font-semibold uppercase tracking-[0.06em] transition disabled:cursor-not-allowed disabled:opacity-40";

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 rounded-md px-4",
  md: "h-11 rounded-md px-5",
};

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-contrast hover:bg-accent-hover",
  secondary:
    "border border-border-strong text-text-primary hover:border-accent hover:text-accent",
  ghost: "text-text-secondary hover:text-text-primary",
  danger:
    "border border-border-strong text-text-secondary hover:border-danger hover:text-danger",
};

/**
 * Build the Button classNames without rendering a <button> — for the
 * handful of places a Next.js <Link> needs to look exactly like a
 * button (nav CTAs, "Open RFQ" links) instead of using window navigation.
 */
export function buttonClasses(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className = ""
) {
  return `${base} ${sizes[size]} ${variants[variant]} ${className}`.trim();
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonClasses(variant, size, className)}
      {...props}
    />
  );
}
