import type { Quote, RFQ } from "./rfq-types";

// Single source of truth for "what does this quote actually cost" —
// used by quote comparison, AI ranking, the recommendation badge,
// award confirmation, and PO generation (see lib/scoring.ts and
// lib/store.ts's awardRFQ). Before this existed, total cost was only
// ever computed once — inside awardRFQ, AFTER the buyer had already
// picked a quote from a comparison that showed unit price alone. See
// the Quote Intelligence Audit, findings 03/04/05.
//
// Money-not-invented rule: `Quote.shippingCost` and `Quote.taxPercent`
// are `number | null`. `null` means the supplier's browser genuinely
// never sent a value — it must never be silently treated as 0. Only an
// explicit 0 means "free shipping" / "0% tax," and only because the
// supplier typed exactly that. Nothing in this module ever converts a
// missing value into a positive claim (e.g. "shipping included").

export type TaxLabel = "included_known" | "excluded_unspecified" | "unable";

export type QuoteCost = {
  // Which quantity the cost is actually computed against, and why.
  quantityUsed: number;
  quantityBasis: "quoted" | "requested_fallback" | "unknown";
  requestedQuantity: number | null;
  // Raw pass-through so callers never have to re-derive "was this
  // specified" themselves.
  shippingCost: number | null;
  taxPercent: number | null;
  // Computed figures. `null` only when there isn't enough information
  // to compute them at all (see `taxLabel: "unable"`).
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  // Whether `total` includes a real, known tax figure, or excludes an
  // unspecified one — drives the exact wording the audit asked for:
  // "Total including known tax" / "Total excluding unspecified tax" /
  // "Unable to calculate". Shipping has the same not-silently-zero
  // treatment (see `shippingCost === null` above) but only two display
  // states are ever shown for it ("₹0" or "Not specified" — never a
  // fabricated "included"), so it doesn't need a third label here.
  taxLabel: TaxLabel;
  totalLabelText: string;
};

function isPositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function calculateQuoteCost(
  quote: Pick<Quote, "unitPrice" | "quotedQuantity" | "shippingCost" | "taxPercent">,
  requestedQuantity: number | null
): QuoteCost {
  const hasQuotedQuantity = isPositiveNumber(quote.quotedQuantity);
  const fallbackQuantity =
    requestedQuantity !== null && isPositiveNumber(requestedQuantity)
      ? requestedQuantity
      : null;

  const quantityUsed = hasQuotedQuantity
    ? quote.quotedQuantity
    : (fallbackQuantity ?? 0);
  const quantityBasis: QuoteCost["quantityBasis"] = hasQuotedQuantity
    ? "quoted"
    : fallbackQuantity !== null
      ? "requested_fallback"
      : "unknown";

  const canComputeSubtotal =
    isPositiveNumber(quote.unitPrice) && quantityUsed > 0;
  const subtotal = canComputeSubtotal
    ? quote.unitPrice * quantityUsed
    : null;

  const shippingKnown = quote.shippingCost !== null;
  const taxKnown = quote.taxPercent !== null;

  const taxAmount =
    subtotal !== null && taxKnown
      ? (subtotal * (quote.taxPercent as number)) / 100
      : null;

  let total: number | null = null;
  let taxLabel: TaxLabel = "unable";

  if (subtotal !== null) {
    total =
      subtotal +
      (shippingKnown ? (quote.shippingCost as number) : 0) +
      (taxKnown ? (taxAmount as number) : 0);
    taxLabel = taxKnown ? "included_known" : "excluded_unspecified";
  }

  const totalLabelText =
    taxLabel === "included_known"
      ? "Total including known tax"
      : taxLabel === "excluded_unspecified"
        ? "Total excluding unspecified tax"
        : "Unable to calculate";

  return {
    quantityUsed,
    quantityBasis,
    requestedQuantity,
    shippingCost: quote.shippingCost,
    taxPercent: quote.taxPercent,
    subtotal,
    taxAmount,
    total,
    taxLabel,
    totalLabelText,
  };
}

// Prefers the clean numeric quantity captured by the extraction
// pipeline (P0 #1's structuredRequirement) over regex-parsing the
// legacy flat requirements string — same fallback order used
// elsewhere for backward compatibility with pre-P0 #1 RFQs.
export function getRequestedQuantity(rfq: RFQ): number | null {
  const structuredQty = rfq.structuredRequirement?.quantity.value;
  if (typeof structuredQty === "number" && isPositiveNumber(structuredQty)) {
    return structuredQty;
  }

  const match = rfq.requirements.quantity.match(/[\d,]+/);
  if (!match) return null;

  const parsed = Number(match[0].replace(/,/g, ""));
  return isPositiveNumber(parsed) ? parsed : null;
}

export function formatShipping(shippingCost: number | null): string {
  if (shippingCost === null) return "Not specified";
  if (shippingCost === 0) return "₹0 (free shipping)";
  return `₹${shippingCost.toLocaleString("en-IN")}`;
}

export function formatTaxRate(taxPercent: number | null): string {
  return taxPercent === null ? "Not specified" : `${taxPercent}%`;
}

export function formatMoq(moq: number | null): string {
  return moq === null ? "MOQ not specified" : moq.toLocaleString("en-IN");
}

export function formatCurrency(amount: number | null): string {
  return amount === null
    ? "Cannot calculate"
    : `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

// Parses a form field that should be `null` when left blank rather than
// silently coerced to 0 — shared by both quote-submission API routes so
// "the supplier didn't answer this" and "the supplier answered 0" stay
// distinguishable all the way from the form to storage.
export function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
