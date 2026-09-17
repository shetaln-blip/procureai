import type { FieldMatch, MatchedSupplier } from "./matching";
import type { ProcurementRequirement } from "./extraction/schema";

// Decision Trace derivation (hackathon submission-readiness pass).
//
// This is deliberately NOT a second matching engine. Every constraint
// status below is a direct, honest read of the FieldMatch values
// lib/matching.ts already computed while scoring this supplier against
// this requirement (see MatchedSupplier.explanation) — this module only
// decides how to LABEL those already-computed facts for display:
//   - "not_applicable" when the buyer never stated that requirement
//   - "met" / "failed" when matching.ts found a confirmed match/mismatch
//   - "unknown" for everything else (partial evidence, or no evidence) —
//     an unknown constraint is never presented as met.
//
// The minimal shape a caller needs to supply for the requirement side —
// structurally compatible with (but not importing) app/page.tsx's
// `Requirements` type, to avoid a circular import between that page and
// this lib module.
export type DecisionTraceRequirementInput = {
  product: string;
  quantity: string;
  location: string;
  budget: string;
  deadline: string;
  structured?: ProcurementRequirement | null;
};

export type ConstraintKey =
  | "budget"
  | "moq"
  | "location"
  | "delivery"
  | "certification";

export type ConstraintStatus = "met" | "failed" | "unknown" | "not_applicable";

export type ConstraintResult = {
  key: ConstraintKey;
  label: string;
  status: ConstraintStatus;
  explanation: string;
};

export type DecisionState = "qualified" | "partially_verified" | "does_not_qualify";

export type DecisionTraceData = {
  requirementSummary: { label: string; value: string }[];
  constraints: ConstraintResult[];
  decision: DecisionState;
  decisionLabel: string;
  decisionExplanation: string;
};

function statusFromFieldMatch(
  fieldMatch: FieldMatch | null,
  wasStated: boolean
): ConstraintStatus {
  if (!wasStated) return "not_applicable";
  if (fieldMatch === "match") return "met";
  if (fieldMatch === "mismatch") return "failed";
  // "partial" and "unknown" (and null, which shouldn't occur once
  // wasStated is true) all collapse to "unknown" — a partially-confirmed
  // or unconfirmed constraint is never presented as satisfied.
  return "unknown";
}

export function buildDecisionTrace(
  vendor: MatchedSupplier,
  req: DecisionTraceRequirementInput
): DecisionTraceData {
  const structured = req.structured ?? null;
  const requestedCerts = structured?.specifications.certifications ?? [];

  const constraints: ConstraintResult[] = [];

  // Budget / price
  const budgetStated = Boolean(req.budget);
  constraints.push({
    key: "budget",
    label: "Budget",
    status: statusFromFieldMatch(vendor.explanation.priceMatch, budgetStated),
    explanation: budgetStated
      ? `Supplier pricing: ${
          vendor.commercial.priceRange ?? "not publicly listed"
        } — target: ${req.budget}`
      : "No budget was stated in this request.",
  });

  // MOQ / quantity
  const moqStated = Boolean(req.quantity);
  constraints.push({
    key: "moq",
    label: "MOQ",
    status: statusFromFieldMatch(vendor.explanation.quantityMatch, moqStated),
    explanation: moqStated
      ? `Requested quantity: ${req.quantity} — supplier MOQ: ${
          vendor.commercial.moq ?? "not publicly listed"
        }`
      : "No quantity was stated in this request.",
  });

  // Location
  const locationStated = Boolean(req.location);
  constraints.push({
    key: "location",
    label: "Location",
    status: statusFromFieldMatch(vendor.explanation.locationMatch, locationStated),
    explanation: locationStated
      ? `Requested delivery to: ${req.location} — supplier located in: ${vendor.identity.location}`
      : "No delivery location was stated in this request.",
  });

  // Delivery / deadline
  const deliveryStated = Boolean(req.deadline);
  constraints.push({
    key: "delivery",
    label: "Delivery",
    status: statusFromFieldMatch(vendor.explanation.deliveryMatch, deliveryStated),
    explanation: deliveryStated
      ? `Supplier lead time: ${
          vendor.commercial.leadTime ?? "not publicly listed"
        } — deadline: ${req.deadline}`
      : "No delivery deadline was stated in this request.",
  });

  // Certification
  const certStated = requestedCerts.length > 0;
  const certStatus = statusFromFieldMatch(vendor.explanation.certificationMatch, certStated);
  constraints.push({
    key: "certification",
    label: "Certification",
    status: certStatus,
    explanation: certStated
      ? `Requested: ${requestedCerts.join(", ")} — ${
          certStatus === "met"
            ? "confirmed on file for this supplier"
            : certStatus === "failed"
              ? "not listed for this supplier"
              : "not independently verified"
        }`
      : "No certification requirement was stated in this request.",
  });

  const applicable = constraints.filter((c) => c.status !== "not_applicable");
  const anyFailed = applicable.some((c) => c.status === "failed");
  const anyUnknown = applicable.some((c) => c.status === "unknown");

  let decision: DecisionState;
  let decisionLabel: string;
  let decisionExplanation: string;

  if (anyFailed) {
    decision = "does_not_qualify";
    decisionLabel = "Does not qualify";
    decisionExplanation =
      "One or more stated requirements are not met, based on the evidence ProcureAI has for this supplier.";
  } else if (anyUnknown) {
    decision = "partially_verified";
    decisionLabel = "Partially verified";
    decisionExplanation =
      "Some stated requirements cannot be confirmed from the evidence ProcureAI has for this supplier.";
  } else {
    decision = "qualified";
    decisionLabel = "Qualified";
    decisionExplanation =
      applicable.length > 0
        ? "All stated hard requirements are satisfied, based on the evidence ProcureAI has for this supplier."
        : "No hard requirements were stated in this request to check against.";
  }

  const requirementSummary = [
    {
      label: "Product",
      value: structured?.product.value || req.product || "Not specified",
    },
    { label: "Quantity", value: req.quantity || "Not specified" },
    { label: "Budget", value: req.budget || "Not specified" },
    { label: "Location", value: req.location || "Not specified" },
    { label: "Delivery", value: req.deadline || "Not specified" },
  ];

  return { requirementSummary, constraints, decision, decisionLabel, decisionExplanation };
}
