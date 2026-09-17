import { NextResponse } from "next/server";
import { getSupplierRepository } from "@/lib/supplier-store";
import { listRFQs } from "@/lib/store";
import { calculateSupplierPerformance } from "@/lib/supplier-performance";
import type { SupplierPerformance } from "@/lib/supplier-types";

export type VendorLeaderboardEntry = {
  vendorId: number;
  companyName: string;
  location: string;
  categories: string[];
  performance: SupplierPerformance;
};

// Ranks suppliers by REAL activity in ProcureAI's own RFQ/quote/award
// history (lib/supplier-performance.ts) — never by public review data.
// The supplier catalog has an `intelligence.publicRating` field, but it
// is null for every supplier in the current data set (nothing has ever
// populated it), so a ranking built on it would be empty or, worse,
// tempt inventing numbers. This endpoint only ever surfaces a number it
// can trace back to an actual RFQ, quote, or award record.
//
// Only suppliers who have been invited to at least one RFQ are
// considered "ranked" — the rest of the ~4,000-supplier catalog has no
// track record yet. They're reported as a count (totalSuppliersInCatalog
// minus totalWithHistory), never padded into the list with a guessed
// score.
function compareEntries(
  a: VendorLeaderboardEntry,
  b: VendorLeaderboardEntry
): number {
  // Most concrete signal first: suppliers who have actually won business.
  if (a.performance.ordersAwarded !== b.performance.ordersAwarded) {
    return b.performance.ordersAwarded - a.performance.ordersAwarded;
  }

  // Win rate is only meaningful once a supplier has quoted at all —
  // treat "never quoted" as lowest rather than letting a null coerce to
  // a misleading 0.
  const aWin = a.performance.winRate ?? -1;
  const bWin = b.performance.winRate ?? -1;
  if (aWin !== bWin) return bWin - aWin;

  // More submitted quotes means more evidence behind the win rate above
  // — a 1-for-1 record shouldn't outrank a 4-for-5 one.
  if (a.performance.quotesSubmitted !== b.performance.quotesSubmitted) {
    return b.performance.quotesSubmitted - a.performance.quotesSubmitted;
  }

  // Final tie-break: responsiveness. Unknown sorts last, not first.
  const aResp = a.performance.averageResponseHours ?? Number.POSITIVE_INFINITY;
  const bResp = b.performance.averageResponseHours ?? Number.POSITIVE_INFINITY;
  return aResp - bResp;
}

export async function GET() {
  try {
    const [suppliers, rfqs] = await Promise.all([
      getSupplierRepository().listSuppliers(),
      listRFQs(),
    ]);

    // Collect only vendorIds that actually appear in RFQ history —
    // running calculateSupplierPerformance() against every one of the
    // ~4,000 catalog suppliers would be wasted work for the ones that
    // can never have a track record.
    const vendorIdsWithHistory = new Set<number>();
    for (const rfq of rfqs) {
      for (const invited of rfq.suppliers) {
        vendorIdsWithHistory.add(invited.vendorId);
      }
      for (const quote of rfq.quotes) {
        vendorIdsWithHistory.add(quote.vendorId);
      }
    }

    const supplierById = new Map(suppliers.map((s) => [s.id, s]));

    const ranked: VendorLeaderboardEntry[] = [];
    for (const vendorId of vendorIdsWithHistory) {
      const supplier = supplierById.get(vendorId);
      if (!supplier) continue; // referenced by an RFQ but no longer in the catalog

      ranked.push({
        vendorId,
        companyName: supplier.identity.companyName,
        location: supplier.identity.location,
        categories: supplier.capabilities.categories,
        performance: calculateSupplierPerformance(vendorId, rfqs),
      });
    }

    ranked.sort(compareEntries);

    return NextResponse.json({
      ranked,
      totalSuppliersInCatalog: suppliers.length,
      totalWithHistory: ranked.length,
      message:
        ranked.length === 0
          ? "No supplier has RFQ history in ProcureAI yet. Rankings will appear here once RFQs are sent and quoted."
          : null,
    });
  } catch (error) {
    console.error("Failed to build vendor leaderboard:", error);

    return NextResponse.json(
      { error: "Failed to load vendor performance data." },
      { status: 500 }
    );
  }
}
