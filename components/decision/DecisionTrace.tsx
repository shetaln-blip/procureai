import type { MatchedSupplier } from "@/lib/matching";
import {
  buildDecisionTrace,
  type DecisionState,
  type DecisionTraceRequirementInput,
} from "@/lib/decision-trace";
import { buildEvidenceItems, formatEvidenceDate } from "@/lib/evidence";
import { Badge, type BadgeTone, Button, Modal, ModalCloseButton } from "@/components/ui";
import { ConstraintChecklist } from "./ConstraintChecklist";

// The Decision Trace panel (hackathon submission-readiness pass, Phase
// 1): for one supplier, shows exactly what the buyer asked for, what
// evidence ProcureAI actually has on file, how that evidence checks out
// against each hard requirement, and the resulting qualification state —
// built entirely from data the existing pipeline already produced
// (lib/matching.ts's MatchedSupplier + lib/evidence.ts's evidence
// items). Nothing here is invented: a missing requirement reads as "Not
// specified," missing evidence reads as "No public evidence available,"
// and an unverified constraint is never shown as met.

const DECISION_TONE: Record<DecisionState, BadgeTone> = {
  qualified: "success",
  partially_verified: "warning",
  does_not_qualify: "danger",
};

export function DecisionTrace({
  vendor,
  requirements,
  onClose,
}: {
  vendor: MatchedSupplier;
  requirements: DecisionTraceRequirementInput;
  onClose: () => void;
}) {
  const trace = buildDecisionTrace(vendor, requirements);
  const evidenceItems = buildEvidenceItems(vendor);

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <div className="flex items-start justify-between border-b border-border p-7">
        <div>
          <div className="eyebrow text-accent">
            <span className="eyebrow-dot bg-accent" />
            Decision trace
          </div>

          <h2 className="mt-1 font-ledger-serif text-2xl font-medium text-text-primary">
            {vendor.identity.companyName}
          </h2>

          <p className="mt-2 text-sm text-text-secondary">
            {vendor.capabilities.categories.join(", ") || "Uncategorized"} ·{" "}
            {vendor.identity.location}
          </p>
        </div>

        <ModalCloseButton onClose={onClose} />
      </div>

      {/* REQUIREMENT */}
      <div className="border-b border-border px-7 py-6">
        <h3 className="font-ledger-serif font-medium text-text-primary">
          Requirement
        </h3>
        <p className="mt-1 text-xs leading-5 text-text-secondary">
          What the buyer actually requested — used as-is, nothing inferred beyond it.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {trace.requirementSummary.map((item) => (
            <div key={item.label} className="rounded-md border border-border bg-surface p-4">
              <p className="font-ledger-mono text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                {item.label}
              </p>
              <p className="mt-1.5 text-sm font-medium text-text-primary">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* EVIDENCE */}
      <div className="border-b border-border px-7 py-6">
        <h3 className="font-ledger-serif font-medium text-text-primary">
          Evidence
        </h3>

        {evidenceItems.length === 0 ? (
          <p className="mt-3 text-sm text-text-secondary">
            No public evidence available.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs leading-5 text-text-secondary">
              Only facts backed by a public source ProcureAI has on file.
            </p>

            <ul className="mt-4 divide-y divide-border rounded-md border border-border">
              {evidenceItems.map((item, index) => (
                <li
                  key={index}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary">
                      {item.fieldLabel}
                    </p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {item.sourceName} · Retrieved {formatEvidenceDate(item.retrievedAt)}
                    </p>
                  </div>

                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs font-semibold text-accent transition hover:text-accent-hover"
                  >
                    Evidence ↗
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* CONSTRAINT EVALUATION */}
      <div className="border-b border-border px-7 py-6">
        <h3 className="font-ledger-serif font-medium text-text-primary">
          Constraint evaluation
        </h3>
        <p className="mt-1 text-xs leading-5 text-text-secondary">
          Deterministic — the same matching logic used to rank this supplier, not a
          separate judgment.
        </p>

        <div className="mt-4">
          <ConstraintChecklist constraints={trace.constraints} />
        </div>
      </div>

      {/* DECISION */}
      <div className="px-7 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-ledger-serif font-medium text-text-primary">
            Decision
          </h3>
          <Badge tone={DECISION_TONE[trace.decision]}>{trace.decisionLabel}</Badge>
        </div>

        <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
          {trace.decisionExplanation}
        </p>
      </div>

      <div className="flex justify-end gap-3 border-t border-border p-7">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
