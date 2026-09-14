import type { ReactNode } from "react";
import type { BadgeTone } from "./Badge";

interface PageHeaderProps {
  eyebrow?: string;
  eyebrowTone?: BadgeTone;
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}

const dotTones: Record<BadgeTone, string> = {
  neutral: "bg-text-secondary",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

const textTones: Record<BadgeTone, string> = {
  neutral: "text-text-secondary",
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

/**
 * The eyebrow + title + description + actions header used at the top
 * of every screen (dashboard, supplier results, RFQ list/detail,
 * supplier quote form) — one consistent shape instead of five
 * hand-typed variants.
 */
export function PageHeader({
  eyebrow,
  eyebrowTone = "accent",
  title,
  description,
  actions,
  meta,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <div className={`eyebrow ${textTones[eyebrowTone]}`}>
            <span className={`eyebrow-dot ${dotTones[eyebrowTone]}`} />
            {eyebrow}
          </div>
        )}
        <h1 className="mt-3 font-ledger-serif text-3xl font-medium tracking-tight text-text-primary sm:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
            {description}
          </p>
        )}
        {meta}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
    </div>
  );
}
