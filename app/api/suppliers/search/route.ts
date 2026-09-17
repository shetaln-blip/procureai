import { NextResponse } from "next/server";
import { performance } from "node:perf_hooks";
import { matchSuppliers, type SearchCriteria } from "@/lib/matching";
import { recallSuppliers } from "@/lib/moss/retrieve";

// A very light shape check on `body.structured` — just enough to avoid
// passing a malformed client payload into the matcher as if it were a
// real ProcurementRequirement. It doesn't validate every field; matching
// already treats every field as optional/nullable, so a partially-shaped
// object degrades gracefully rather than needing to be rejected outright.
function isPlausibleStructuredRequirement(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.product === "object" &&
    typeof candidate.specifications === "object"
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const criteria: SearchCriteria = {
      product: typeof body?.product === "string" ? body.product : "",
      quantity: typeof body?.quantity === "string" ? body.quantity : "",
      location: typeof body?.location === "string" ? body.location : "",
      budget: typeof body?.budget === "string" ? body.budget : "",
      deadline: typeof body?.deadline === "string" ? body.deadline : "",
      quality: typeof body?.quality === "string" ? body.quality : "",
      additionalRequirements: Array.isArray(body?.additionalRequirements)
        ? body.additionalRequirements
        : [],
      // The rich structured requirement from /api/analyze, when the
      // caller has one (the normal case — app/page.tsx posts the full
      // analyze response straight through). This is what makes supplier
      // discovery request-dependent; see lib/matching.ts.
      structured: isPlausibleStructuredRequirement(body?.structured)
        ? body.structured
        : null,
    };

    // Real latency instrumentation (hackathon submission-readiness pass,
    // Phase 3) — performance.now() brackets each real pipeline stage
    // (Moss/catalog retrieval, then deterministic matching) separately.
    // No hardcoded numbers, nothing estimated.
    const retrievalStart = performance.now();
    const { suppliers, retrieval } = await recallSuppliers(criteria);
    const retrievalMs = Math.round(performance.now() - retrievalStart);

    const matchingStart = performance.now();
    const { suppliers: matched, meta } = matchSuppliers(suppliers, criteria);
    const matchingMs = Math.round(performance.now() - matchingStart);

    return NextResponse.json({
      suppliers: matched,
      meta,
      retrieval,
      timing: { retrievalMs, matchingMs, totalMs: retrievalMs + matchingMs },
    });
  } catch (error) {
    console.error("Supplier search failed:", error);

    return NextResponse.json(
      { error: "Failed to search suppliers." },
      { status: 500 }
    );
  }
}
