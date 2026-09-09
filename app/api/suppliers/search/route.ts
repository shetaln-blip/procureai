import { NextResponse } from "next/server";
import { matchSuppliers, type SearchCriteria } from "@/lib/matching";
import { getSupplierRepository } from "@/lib/supplier-store";

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

    const suppliers = await getSupplierRepository().searchSuppliers();
    const { suppliers: matched, meta } = matchSuppliers(suppliers, criteria);

    return NextResponse.json({ suppliers: matched, meta });
  } catch (error) {
    console.error("Supplier search failed:", error);

    return NextResponse.json(
      { error: "Failed to search suppliers." },
      { status: 500 }
    );
  }
}
