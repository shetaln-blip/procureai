import type { Quote } from "./rfq-types";
import type { DataConfidence } from "./supplier-types";
import { calculateQuoteCost, type QuoteCost } from "./quote-cost";

// Quote ranking (Quote Intelligence Audit, P0 fixes). The previous
// version of this file ranked quotes on `unitPrice` alone — shipping
// and tax never entered the score, MOQ and the buyer's deadline were
// never checked, and supplier confidence played no role at all. This
// version ranks on total landed cost and folds in every factor the
// audit called out, while staying deterministic and explainable: every
// number here is a real calculation over data the buyer or supplier
// actually provided, never an invented one.

export type Reason = { type: "positive" | "warning"; label: string };

export type CompatibilityValue = boolean | null; // null = unknown, not "compatible"

export type ScoredQuote = Quote & {
  cost: QuoteCost;
  priceScore: number;
  leadTimeScore: number;
  paymentScore: number;
  confidenceScore: number;
  validityScore: number;
  completenessScore: number;
  totalScore: number;
  moqCompatible: CompatibilityValue;
  deadlineCompatible: CompatibilityValue;
  quoteExpired: boolean;
  supplierConfidence: DataConfidence | null;
  // False only when we KNOW this quote can't be fulfilled as asked
  // (a known MOQ or deadline incompatibility). Unknown information
  // never counts against eligibility — see the audit's "unavailable
  // information must not be treated as confirmed compliance," which
  // cuts both ways: it also must not be treated as confirmed
  // NON-compliance.
  eligible: boolean;
  reasons: Reason[];
};

export type RankingContext = {
  requestedQuantity: number | null;
  // Resolved buyer deadline, or null when the buyer gave none — never
  // invented from a vague or missing timeframe.
  deadlineDate: Date | null;
  // Injectable "now" for deterministic tests; defaults to real time.
  now?: Date;
  // vendorId -> supplier's data confidence, when the caller has it
  // (see app/api/rfqs/[id]/route.ts). Missing entirely, or an entry of
  // null, is treated as "no signal" — neutral, not penalized.
  supplierConfidence?: Record<number, DataConfidence | null>;
};

const PAYMENT_TERM_SCORES: Record<string, number> = {
  "On delivery": 100,
  "Net 30": 90,
  "Net 15": 80,
  "25% advance": 70,
  "50% advance": 60,
  "100% advance": 30,
};

function paymentScoreFor(term: string): number {
  return PAYMENT_TERM_SCORES[term] ?? 50;
}

const CONFIDENCE_SCORES: Record<DataConfidence, number> = {
  high: 100,
  medium: 60,
  low: 20,
};

// Cheapest / fastest gets 100, priciest / slowest gets 0, everything
// else scales linearly in between. A single value (or a tie) scores 100
// — there's nothing to be relatively worse than.
function normalizeInverse(value: number, min: number, max: number): number {
  if (max === min) return 100;
  return Math.round(100 - ((value - min) / (max - min)) * 100);
}

function computeMoqCompatible(
  quote: Quote,
  cost: QuoteCost
): CompatibilityValue {
  if (quote.moq === null) return null;
  const orderQuantity = cost.quantityUsed > 0 ? cost.quantityUsed : null;
  if (orderQuantity === null) return null;
  return quote.moq <= orderQuantity;
}

function computeDeadlineCompatible(
  quote: Quote,
  deadlineDate: Date | null,
  now: Date
): CompatibilityValue {
  if (deadlineDate === null) return null;
  if (!(quote.leadTimeDays > 0)) return null;

  const submitted = new Date(quote.submittedAt);
  const base = Number.isFinite(submitted.getTime()) ? submitted : now;
  const expected = new Date(base);
  expected.setDate(expected.getDate() + quote.leadTimeDays);

  return expected.getTime() <= deadlineDate.getTime();
}

function computeExpired(validUntil: string, now: Date): boolean {
  if (!validUntil) return false;

  const parsed = new Date(validUntil);
  if (!Number.isFinite(parsed.getTime())) return false;

  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return parsed.getTime() < todayMidnight.getTime();
}

export function scoreQuotes(
  quotes: Quote[],
  context: RankingContext
): ScoredQuote[] {
  if (quotes.length === 0) return [];

  const now = context.now ?? new Date();
  const confidenceLookup = context.supplierConfidence ?? {};

  const costs = quotes.map((quote) =>
    calculateQuoteCost(quote, context.requestedQuantity)
  );

  const computableTotals = costs
    .map((cost) => cost.total)
    .filter((total): total is number => total !== null);
  const minTotal = computableTotals.length ? Math.min(...computableTotals) : 0;
  const maxTotal = computableTotals.length ? Math.max(...computableTotals) : 0;

  const validLeadTimes = quotes
    .map((quote) => quote.leadTimeDays)
    .filter((days) => days > 0);
  const minLead = validLeadTimes.length ? Math.min(...validLeadTimes) : 0;
  const maxLead = validLeadTimes.length ? Math.max(...validLeadTimes) : 0;

  const scored = quotes.map((quote, index) => {
    const cost = costs[index];

    const priceScore =
      cost.total !== null
        ? normalizeInverse(cost.total, minTotal, maxTotal)
        : 0;
    const leadTimeScore =
      quote.leadTimeDays > 0
        ? normalizeInverse(quote.leadTimeDays, minLead, maxLead)
        : 0;
    const paymentScore = paymentScoreFor(quote.paymentTerms);

    const supplierConfidence = confidenceLookup[quote.vendorId] ?? null;
    const confidenceScore = supplierConfidence
      ? CONFIDENCE_SCORES[supplierConfidence]
      : 50;

    const quoteExpired = computeExpired(quote.validUntil, now);
    const validityScore = quoteExpired ? 0 : 100;

    const shippingKnown = quote.shippingCost !== null;
    const taxKnown = quote.taxPercent !== null;
    const completenessScore =
      (shippingKnown ? 50 : 0) + (taxKnown ? 50 : 0);

    const moqCompatible = computeMoqCompatible(quote, cost);
    const deadlineCompatible = computeDeadlineCompatible(
      quote,
      context.deadlineDate,
      now
    );
    const eligible = moqCompatible !== false && deadlineCompatible !== false;

    const totalScore = Math.round(
      priceScore * 0.35 +
        leadTimeScore * 0.2 +
        paymentScore * 0.15 +
        confidenceScore * 0.1 +
        validityScore * 0.1 +
        completenessScore * 0.1
    );

    const reasons: Reason[] = [];
    if (moqCompatible === false) {
      reasons.push({ type: "warning", label: "MOQ not compatible" });
    } else if (moqCompatible === null && quote.moq === null) {
      reasons.push({ type: "warning", label: "MOQ not specified" });
    }
    if (deadlineCompatible === false) {
      reasons.push({ type: "warning", label: "Deadline may not be met" });
    }
    if (quoteExpired) {
      reasons.push({ type: "warning", label: "Quote validity has expired" });
    }
    if (!shippingKnown) {
      reasons.push({ type: "warning", label: "Shipping not specified" });
    }
    if (!taxKnown) {
      reasons.push({ type: "warning", label: "Tax not included in total" });
    }
    if (cost.total === null) {
      reasons.push({ type: "warning", label: "Cannot calculate total cost" });
    }

    return {
      ...quote,
      cost,
      priceScore,
      leadTimeScore,
      paymentScore,
      confidenceScore,
      validityScore,
      completenessScore,
      totalScore,
      moqCompatible,
      deadlineCompatible,
      quoteExpired,
      supplierConfidence,
      eligible,
      reasons,
    };
  });

  // Three-tier sort: a quote whose total cost can't be calculated at
  // all is never shown as better than one that can be (we simply don't
  // know its real price); among quotes we can price, a known
  // incompatibility (MOQ/deadline) sinks it below every quote that
  // isn't known-incompatible; within each tier, higher score wins.
  return scored.sort((a, b) => {
    const aCost = a.cost.total !== null ? 1 : 0;
    const bCost = b.cost.total !== null ? 1 : 0;
    if (aCost !== bCost) return bCost - aCost;

    const aElig = a.eligible ? 1 : 0;
    const bElig = b.eligible ? 1 : 0;
    if (aElig !== bElig) return bElig - aElig;

    return b.totalScore - a.totalScore;
  });
}

export type Recommendation = {
  quote: ScoredQuote | null;
  // A caveat to show alongside the pick — e.g. every quote has a
  // compatibility concern, so this is "the best of a bad set," not a
  // clean recommendation. `quote` is still returned in that case (the
  // buyer needs *something* to look at), matching the rule "do not
  // rank an incompatible quote as best unless every alternative is
  // also incompatible" — this is exactly that case.
  caveat: string | null;
};

// "No clear recommendation" only fires when we genuinely can't compare
// — nobody's total cost is calculable. That's the one situation where
// forcing a winner would mean picking essentially at random.
export function getRecommendation(scored: ScoredQuote[]): Recommendation {
  if (scored.length === 0) return { quote: null, caveat: null };

  const top = scored[0];

  if (top.cost.total === null) {
    return {
      quote: null,
      caveat:
        "None of the quotes received have enough information to calculate a total cost.",
    };
  }

  if (!top.eligible) {
    return {
      quote: top,
      caveat:
        "Every quote received has a compatibility concern (MOQ or deadline) — this is the closest option, but confirm with the supplier before awarding.",
    };
  }

  return { quote: top, caveat: null };
}

export function summarizeReasons(reasons: Reason[]): string {
  const positive = reasons.filter((r) => r.type === "positive");
  if (positive.length > 0) {
    return positive.map((r) => r.label).join(", ");
  }

  const warnings = reasons.filter((r) => r.type === "warning");
  if (warnings.length > 0) {
    return `Note: ${warnings.map((r) => r.label).join(", ")}`;
  }

  return "Balanced across price, delivery and payment terms.";
}
