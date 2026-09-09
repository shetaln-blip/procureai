import type { ScoredQuote } from "./scoring";

// Price intelligence built ONLY from data that genuinely exists inside
// this RFQ (or, for the historical figure, this supplier's own past
// quotes elsewhere in ProcureAI) — Quote Intelligence Audit, "add price
// intelligence using only available data." Nothing here reaches for an
// external market price or an invented benchmark; see
// `EXTERNAL_BENCHMARK_NOTE` for the honest placeholder that replaces one.

export const EXTERNAL_BENCHMARK_NOTE =
  "External market benchmark — not available yet.";

export type RfqPriceIntelligence = {
  // Lowest/average of the QUOTED UNIT PRICE across every quote received
  // on this RFQ (not total landed cost — this is "what suppliers are
  // charging per unit," a distinct figure from the total-cost ranking).
  lowestQuotedPrice: number | null;
  lowestQuotedPriceVendor: string | null;
  averageQuotedPrice: number | null;
  quotesConsidered: number;
  // Only ever set when there are at least two quotes that are BOTH
  // eligible (no known MOQ/deadline incompatibility) and priceable —
  // comparing against an incompatible or uncomputable quote would be a
  // fabricated comparison, so this stays null (not zero) otherwise.
  potentialSavings: {
    amount: number;
    vsVendorName: string;
    vsTotal: number;
  } | null;
};

export function calculateRfqPriceIntelligence(
  scored: ScoredQuote[]
): RfqPriceIntelligence {
  const pricedUnitQuotes = scored.filter(
    (q) => Number.isFinite(q.unitPrice) && q.unitPrice > 0
  );

  let lowestQuotedPrice: number | null = null;
  let lowestQuotedPriceVendor: string | null = null;
  let averageQuotedPrice: number | null = null;

  if (pricedUnitQuotes.length > 0) {
    const lowest = pricedUnitQuotes.reduce((min, q) =>
      q.unitPrice < min.unitPrice ? q : min
    );
    lowestQuotedPrice = lowest.unitPrice;
    lowestQuotedPriceVendor = lowest.vendorName;
    averageQuotedPrice = Math.round(
      pricedUnitQuotes.reduce((sum, q) => sum + q.unitPrice, 0) /
        pricedUnitQuotes.length
    );
  }

  const compatiblePriced = scored.filter(
    (q) => q.eligible && q.cost.total !== null
  );

  let potentialSavings: RfqPriceIntelligence["potentialSavings"] = null;

  if (compatiblePriced.length >= 2) {
    const lowestCost = compatiblePriced.reduce((min, q) =>
      (q.cost.total as number) < (min.cost.total as number) ? q : min
    );
    const highestCost = compatiblePriced.reduce((max, q) =>
      (q.cost.total as number) > (max.cost.total as number) ? q : max
    );

    if (highestCost.id !== lowestCost.id) {
      potentialSavings = {
        amount: (highestCost.cost.total as number) - (lowestCost.cost.total as number),
        vsVendorName: highestCost.vendorName,
        vsTotal: highestCost.cost.total as number,
      };
    }
  }

  return {
    lowestQuotedPrice,
    lowestQuotedPriceVendor,
    averageQuotedPrice,
    quotesConsidered: pricedUnitQuotes.length,
    potentialSavings,
  };
}

// A supplier's own historical average price is only meaningful once it
// reflects quotes BEYOND the one just submitted on this RFQ — otherwise
// "history" is really just "this one quote," which isn't history at
// all. `quoteCount` is this supplier's total quotes submitted across
// every RFQ (lib/supplier-performance.ts), so requiring more than 1
// means at least one other, genuinely prior quote exists.
export function hasGenuineHistoricalPrice(quoteCount: number): boolean {
  return quoteCount > 1;
}
