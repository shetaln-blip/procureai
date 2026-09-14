import type { HTMLAttributes } from "react";

export type CardTone = "surface" | "sunken" | "accent";
export type CardPadding = "sm" | "md" | "lg" | "none";

const tones: Record<CardTone, string> = {
  surface: "border-border bg-surface",
  sunken: "border-border bg-surface-sunken",
  accent: "border-accent/40 bg-accent-soft",
};

const paddings: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  padding?: CardPadding;
  interactive?: boolean;
}

/**
 * The one card shell used everywhere: saved requests, supplier
 * results, RFQ rows, quote cards, spec panels. Replaces the previously
 * scattered `rounded-md border border-zinc-200 bg-white p-6` /
 * `rounded-lg border border-[#38383F] bg-[#131316] p-3` variants.
 */
export function Card({
  tone = "surface",
  padding = "md",
  interactive = false,
  className = "",
  ...props
}: CardProps) {
  return (
    <div
      className={`rounded-md border ${tones[tone]} ${paddings[padding]} ${
        interactive ? "transition hover:border-border-strong" : ""
      } ${className}`.trim()}
      {...props}
    />
  );
}
