import type { MatchedSupplier, SearchMeta } from "./matching";
import type { DecisionTraceRequirementInput } from "./decision-trace";

// Scenario-aware failure/near-miss messaging (hackathon submission-
// readiness pass, Phase 5). This is presentation-layer diagnosis only —
// it reads the SAME per-supplier FieldMatch data lib/matching.ts already
// computed (via MatchedSupplier.explanation) and the same SearchMeta
// counts app/page.tsx already receives; it does not re-score or
// re-rank anything. It only distinguishes WHY a search came back weak,
// using facts already present in the response — never a guess.

export type SearchScenario =
  | "no_suppliers_found"
  | "ambiguous_request"
  | "hard_constraint_failure"
  | "missing_evidence"
  | "few_strong_matches";

export type SearchDiagnosis = {
  scenario: SearchScenario;
  title: string;
  message: string;
};

const CONSTRAINT_LABELS: Record<"priceMatch" | "quantityMatch" | "locationMatch" | "deliveryMatch", string> = {
  priceMatch: "price",
  quantityMatch: "MOQ",
  locationMatch: "location",
  deliveryMatch: "delivery",
};

// Only called once we already know there's no dominant "ambiguous
// request" or "no suppliers found" issue — looks at the suppliers that
// ARE at least potentially relevant (tier !== "no_match") and asks: is
// the reason none of them are a strong match a CONFIRMED mismatch on one
// specific constraint (a real "mismatch" FieldMatch), or mostly missing
// evidence (a real "unknown"/"partial" FieldMatch)? Whichever pattern
// actually dominates the real data is what gets reported — never both,
// never neither, never invented.
function diagnoseWeakMatches(
  relevantSuppliers: MatchedSupplier[]
): { kind: "hard_constraint_failure"; field: string; failingCount: number; otherwiseOkCount: number } | { kind: "missing_evidence" } | null {
  const fields: (keyof typeof CONSTRAINT_LABELS)[] = [
    "priceMatch",
    "quantityMatch",
    "locationMatch",
    "deliveryMatch",
  ];

  let bestField: (typeof fields)[number] | null = null;
  let bestMismatchCount = 0;
  let bestOtherwiseOkCount = 0;

  for (const field of fields) {
    const mismatched = relevantSuppliers.filter((s) => s.explanation[field] === "mismatch");
    if (mismatched.length === 0) continue;

    // "Otherwise ok" = suppliers failing THIS constraint but not failing
    // any of the other three confirmed constraints — the concrete "N
    // suppliers meet everything else but not X" case the brief asks for.
    const otherwiseOk = mismatched.filter((s) =>
      fields.every((other) => other === field || s.explanation[other] !== "mismatch")
    ).length;

    if (mismatched.length > bestMismatchCount) {
      bestField = field;
      bestMismatchCount = mismatched.length;
      bestOtherwiseOkCount = otherwiseOk;
    }
  }

  if (bestField && bestMismatchCount > 0) {
    return {
      kind: "hard_constraint_failure",
      field: CONSTRAINT_LABELS[bestField],
      failingCount: bestMismatchCount,
      otherwiseOkCount: bestOtherwiseOkCount,
    };
  }

  const anyUnknown = relevantSuppliers.some((s) =>
    fields.some((f) => s.explanation[f] === "unknown" || s.explanation[f] === "partial")
  );

  if (anyUnknown) return { kind: "missing_evidence" };

  return null;
}

// Returns null when there's nothing special to say — app/page.tsx falls
// back to the existing matchMeta.message (or shows nothing) in that
// case, unchanged from current behavior.
export function diagnoseSearchOutcome(
  suppliers: MatchedSupplier[],
  meta: SearchMeta,
  requirement: DecisionTraceRequirementInput
): SearchDiagnosis | null {
  // Ambiguous request — the extraction pipeline found no identifiable
  // product at all (ExtractedField.value === null / empty string is
  // never a guess, it's the pipeline's own "found nothing" signal).
  const productKnown = Boolean(
    requirement.structured?.product.value || requirement.product
  );

  if (!productKnown) {
    return {
      scenario: "ambiguous_request",
      title: "We couldn't confidently determine your requirement",
      message:
        "ProcureAI couldn't identify a specific product from your request. Try rephrasing with a specific product name — for example \"corrugated shipping boxes\" instead of \"packaging.\"",
    };
  }

  if (meta.strong > 0) return null; // plenty of strong matches — nothing to explain

  const relevant = suppliers.filter((s) => s.tier !== "no_match");

  if (relevant.length === 0) {
    return {
      scenario: "no_suppliers_found",
      title: "No suppliers found",
      message:
        "No suppliers matching the requested product were found in ProcureAI's current catalog.",
    };
  }

  const diagnosis = diagnoseWeakMatches(relevant);

  if (diagnosis?.kind === "hard_constraint_failure") {
    const suffix =
      diagnosis.otherwiseOkCount > 0
        ? ` ${diagnosis.otherwiseOkCount} of them otherwise meet your stated requirements.`
        : "";

    return {
      scenario: "hard_constraint_failure",
      title: "Suppliers were found, but none satisfy every requirement",
      message: `${diagnosis.failingCount} supplier${
        diagnosis.failingCount === 1 ? "" : "s"
      } found so far ${
        diagnosis.failingCount === 1 ? "doesn't" : "don't"
      } meet your ${diagnosis.field} requirement.${suffix}`,
    };
  }

  if (diagnosis?.kind === "missing_evidence") {
    return {
      scenario: "missing_evidence",
      title: "Potential suppliers found, but evidence is incomplete",
      message:
        "Potential suppliers were found, but some of your requirements could not be verified from the public evidence ProcureAI has on file. Review each supplier's evidence before proceeding.",
    };
  }

  return {
    scenario: "few_strong_matches",
    title: "Few strong matches",
    message: meta.message ?? "Only a small number of suppliers strongly match this requirement.",
  };
}
