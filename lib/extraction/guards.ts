import type { ProcurementRequirement } from "./schema";

// A deliberately light shape check on an untrusted client payload —
// enough to avoid trusting an arbitrary object as a real
// ProcurementRequirement without requiring every one of its many
// optional/nullable fields to be present. Mirrors the same tradeoff
// app/api/suppliers/search/route.ts already makes for lib/matching.ts's
// SearchCriteria.structured; this is the same check factored out so
// app/api/rfqs/route.ts can use it too (P0 #1).
export function isProcurementRequirement(
  value: unknown
): value is ProcurementRequirement {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.product === "object" &&
    candidate.product !== null &&
    typeof candidate.quantity === "object" &&
    candidate.quantity !== null &&
    typeof candidate.specifications === "object" &&
    candidate.specifications !== null
  );
}
