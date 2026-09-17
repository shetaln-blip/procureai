import { NextResponse } from "next/server";
import { getSupplierRepository } from "@/lib/supplier-store";
import { listRFQs } from "@/lib/store";
import { calculateSupplierPerformance } from "@/lib/supplier-performance";
import type { DataConfidence, Supplier, SupplierPerformance } from "@/lib/supplier-types";

const TOP_N = 15;

export type TopSupplierEntry = {
  vendorId: number;
  companyName: string;
  location: string;
  categories: string[];
  dataConfidence: DataConfidence;
  sourceCount: number;
  lastUpdated: string;
  moq: string | null;
  priceRange: string | null;
  leadTime: string | null;
  certifications: string[];
  performance: SupplierPerformance;
};

const CONFIDENCE_RANK: Record<DataConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

// Ranks suppliers within one category by how well-EVIDENCED their record
// is — source count and data confidence (computed in
// lib/ingestion/normalize.ts from real source coverage), then recency of
// that evidence. This is deliberately NOT a "best supplier" ranking: no
// quality/rating signal exists catalog-wide today (see
// /api/suppliers/leaderboard's comment — intelligence.publicRating is
// null for every supplier in the current catalog). "Most thoroughly
// documented" is what this endpoint can honestly claim, and the UI
// labels it that way rather than as "best."
function compareByEvidence(a: Supplier, b: Supplier): number {
  const confidenceDiff =
    CONFIDENCE_RANK[b.intelligence.dataConfidence] -
    CONFIDENCE_RANK[a.intelligence.dataConfidence];
  if (confidenceDiff !== 0) return confidenceDiff;

  const sourceDiff = b.intelligence.sources.length - a.intelligence.sources.length;
  if (sourceDiff !== 0) return sourceDiff;

  const aTime = new Date(a.intelligence.lastUpdated).getTime();
  const bTime = new Date(b.intelligence.lastUpdated).getTime();
  const aValid = Number.isFinite(aTime) ? aTime : 0;
  const bValid = Number.isFinite(bTime) ? bTime : 0;
  return bValid - aValid;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const category = url.searchParams.get("category")?.trim();

    if (!category) {
      return NextResponse.json(
        { error: "A category query parameter is required." },
        { status: 400 }
      );
    }

    const [suppliers, rfqs] = await Promise.all([
      getSupplierRepository().listSuppliers(),
      listRFQs(),
    ]);

    const lowerCategory = category.toLowerCase();
    const inCategory = suppliers.filter((supplier) =>
      supplier.capabilities.categories.some(
        (c) => c.trim().toLowerCase() === lowerCategory
      )
    );

    const ranked = [...inCategory].sort(compareByEvidence).slice(0, TOP_N);

    const results: TopSupplierEntry[] = ranked.map((supplier) => ({
      vendorId: supplier.id,
      companyName: supplier.identity.companyName,
      location: supplier.identity.location,
      categories: supplier.capabilities.categories,
      dataConfidence: supplier.intelligence.dataConfidence,
      sourceCount: supplier.intelligence.sources.length,
      lastUpdated: supplier.intelligence.lastUpdated,
      moq: supplier.commercial.moq,
      priceRange: supplier.commercial.priceRange,
      leadTime: supplier.commercial.leadTime,
      certifications: supplier.compliance.certifications,
      performance: calculateSupplierPerformance(supplier.id, rfqs),
    }));

    return NextResponse.json({
      category,
      totalInCategory: inCategory.length,
      results,
    });
  } catch (error) {
    console.error("Failed to build category supplier list:", error);

    return NextResponse.json(
      { error: "Failed to load suppliers for this category." },
      { status: 500 }
    );
  }
}
