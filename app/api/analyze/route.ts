import { NextResponse } from "next/server";
import { toLegacyRequirements } from "@/lib/extraction/legacy-adapter";
import { extractProcurementRequirement } from "@/lib/extraction/pipeline";

// Thin HTTP wrapper around the extraction pipeline (lib/extraction/*).
// All the actual parsing — normalization, entity extraction, product
// derivation, semantic classification, validation — lives there; this
// route just calls it and shapes the response. The response keeps the
// flat legacy fields (`product`, `quantity`, `location`, `budget`,
// `deadline`, `quality`, `additionalRequirements`) at the top level so
// app/page.tsx and the RFQ flow don't need to change, and additionally
// exposes the full structured result under `structured` (the rich
// ProcurementRequirement) and `warnings` (validation flags) for any
// future consumer that wants them.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const query = body?.query;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "A procurement query is required." },
        { status: 400 }
      );
    }

    const result = extractProcurementRequirement(query);
    const legacy = toLegacyRequirements(result);

    return NextResponse.json({
      ...legacy,
      structured: result.requirement,
      warnings: result.warnings,
    });
  } catch (error) {
    console.error("ProcureAI analysis error:", error);

    return NextResponse.json(
      { error: "Failed to analyze procurement request." },
      { status: 500 }
    );
  }
}
