import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-white/5 text-text-secondary",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

// Kept as a literal lookup (not a template-built class name) so
// Tailwind's static scanner can see every class it needs to generate.
const dotTones: Record<BadgeTone, string> = {
  neutral: "bg-text-secondary",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
}

/**
 * One filled-pill badge for every status/tier/reason indicator in the
 * app (match tier, RFQ status, verification, compatibility, risk).
 * Previously some of these were plain colored text with a dot and
 * others were filled chips — this is the single shared shape.
 */
export function Badge({
  tone = "neutral",
  dot = false,
  className = "",
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-ledger-mono text-[10px] font-semibold uppercase tracking-[0.06em] ${tones[tone]} ${className}`.trim()}
      {...props}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotTones[tone]}`} />}
      {children}
    </span>
  );
}
