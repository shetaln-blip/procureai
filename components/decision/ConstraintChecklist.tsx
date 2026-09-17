import type { ConstraintResult } from "@/lib/decision-trace";
import { Badge, type BadgeTone } from "@/components/ui";

// Displays the deterministic constraint results computed by
// lib/decision-trace.ts (itself a thin, honest read of the FieldMatch
// values lib/matching.ts already computed for this supplier/requirement
// pair). This component does no evaluation of its own — status/label/
// explanation all arrive pre-computed, so there is exactly one place
// (lib/matching.ts) that decides whether a constraint is actually met.

const STATUS_TONE: Record<ConstraintResult["status"], BadgeTone> = {
  met: "success",
  failed: "danger",
  unknown: "warning",
  not_applicable: "neutral",
};

const STATUS_SYMBOL: Record<ConstraintResult["status"], string> = {
  met: "✓",
  failed: "✕",
  unknown: "?",
  not_applicable: "—",
};

const STATUS_LABEL: Record<ConstraintResult["status"], string> = {
  met: "Met",
  failed: "Failed",
  unknown: "Unverified",
  not_applicable: "Not applicable",
};

export function ConstraintChecklist({
  constraints,
}: {
  constraints: ConstraintResult[];
}) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {constraints.map((constraint) => (
        <li key={constraint.key} className="flex items-start gap-4 px-4 py-3">
          <span
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-ledger-mono text-xs font-bold ${
              constraint.status === "met"
                ? "bg-success-soft text-success"
                : constraint.status === "failed"
                  ? "bg-danger-soft text-danger"
                  : constraint.status === "unknown"
                    ? "bg-warning-soft text-warning"
                    : "bg-white/5 text-text-tertiary"
            }`}
          >
            {STATUS_SYMBOL[constraint.status]}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-text-primary">
                {constraint.label}
              </p>
              <Badge tone={STATUS_TONE[constraint.status]}>
                {STATUS_LABEL[constraint.status]}
              </Badge>
            </div>

            <p className="mt-1 text-xs leading-5 text-text-secondary">
              {constraint.explanation}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
