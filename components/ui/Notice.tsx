import type { ReactNode } from "react";

export type NoticeTone = "success" | "warning" | "danger" | "info";

const tones: Record<NoticeTone, string> = {
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  danger: "border-danger/30 bg-danger-soft text-danger",
  info: "border-accent/30 bg-accent-soft text-accent",
};

interface NoticeProps {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
}

/**
 * One inline notice/banner shape for every success/error/warning/info
 * message in the app (save confirmations, search failures, selection
 * errors, award errors, invalid-link states) — replaces four
 * independently-styled ad hoc boxes (and a couple of bare
 * `window.alert()` calls) that used to do this job.
 */
export function Notice({ tone = "info", children, className = "" }: NoticeProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`rounded-md border px-4 py-3 text-sm leading-6 ${tones[tone]} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
