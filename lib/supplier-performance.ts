import type { RFQ } from "./rfq-types";
import type { SupplierPerformance } from "./supplier-types";

// Derives real, evidence-backed performance metrics for one supplier
// from actual RFQ/quote/award history (data/rfqs-store.json) — never
// fabricated, and never persisted back onto the supplier's own record
// (see lib/supplier-types.ts's SupplierIntelligence.performance for
// where this plugs in, and app/api/suppliers/[id]/performance/route.ts
// for where it's computed on demand). Architecture:
//   Supplier -> Procurement Events (RFQ[]) -> this calculator -> Supplier Intelligence
//
// A metric is left `null` — not zero, not guessed — whenever the
// underlying data doesn't genuinely support it. In particular,
// `completedOrders` and `onTimeDeliveryRate` stay null under the
// CURRENT schema: `PurchaseOrder.deliveryBy` is a promised/estimated
// delivery date computed at award time (createdAt + quoted lead time),
// not a confirmed actual delivery event, so there is no real evidence
// to compute "on time" against, or to count an order as "completed."
// If a future schema adds a genuine delivery-confirmation event, this
// is where it should be wired in — not approximated from the promise.
export function calculateSupplierPerformance(
  vendorId: number,
  rfqs: RFQ[]
): SupplierPerformance {
  const invitedRfqs = rfqs.filter((rfq) =>
    rfq.suppliers.some((supplier) => supplier.vendorId === vendorId)
  );

  const quoteEvents = rfqs.flatMap((rfq) =>
    rfq.quotes
      .filter((quote) => quote.vendorId === vendorId)
      .map((quote) => ({ rfq, quote }))
  );

  const awardedOrders = rfqs.filter(
    (rfq) => rfq.purchaseOrder?.vendorId === vendorId
  );

  const rfqsReceived = invitedRfqs.length;
  const quotesSubmitted = quoteEvents.length;
  const ordersAwarded = awardedOrders.length;

  const quoteResponseRate =
    rfqsReceived > 0 ? roundFraction(quotesSubmitted / rfqsReceived) : null;

  const winRate =
    quotesSubmitted > 0 ? roundFraction(ordersAwarded / quotesSubmitted) : null;

  const averageQuotedPrice =
    quotesSubmitted > 0
      ? Math.round(
          quoteEvents.reduce((sum, { quote }) => sum + quote.unitPrice, 0) /
            quotesSubmitted
        )
      : null;

  const responseHours = quoteEvents
    .map(({ rfq, quote }) => {
      const sentAt = new Date(rfq.createdAt).getTime();
      const submittedAt = new Date(quote.submittedAt).getTime();

      if (!Number.isFinite(sentAt) || !Number.isFinite(submittedAt)) {
        return null;
      }

      const hours = (submittedAt - sentAt) / (1000 * 60 * 60);

      return hours >= 0 ? hours : null;
    })
    .filter((hours): hours is number => hours !== null);

  const averageResponseHours =
    responseHours.length > 0
      ? Math.round(
          (responseHours.reduce((sum, hours) => sum + hours, 0) /
            responseHours.length) *
            10
        ) / 10
      : null;

  return {
    rfqsReceived,
    quotesSubmitted,
    ordersAwarded,
    quoteResponseRate,
    winRate,
    averageQuotedPrice,
    // No confirmed delivery-completion event exists anywhere in the
    // current schema — see the module comment above. Left null rather
    // than approximated from the promised `deliveryBy` date.
    completedOrders: null,
    onTimeDeliveryRate: null,
    averageResponseHours,
  };
}

function roundFraction(fraction: number): number {
  return Math.round(fraction * 1000) / 1000;
}
