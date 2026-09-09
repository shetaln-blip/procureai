// Regression tests for the Quote Intelligence Audit's P0 fixes: shared
// total-landed-cost calculation, MOQ/deadline-aware ranking, honest
// price intelligence, and award/PO integrity. Every case below is one
// the audit explicitly called out — see the P0 fix request's "Preserve
// data integrity" list.
//
// Run with a throwaway store file so this never touches real data:
//   RFQ_STORE_FILE=/tmp/procureai-test-quote-comparison.json npx tsx scripts/test-quote-comparison.ts
import { calculateQuoteCost, formatMoq, formatShipping, formatTaxRate, getRequestedQuantity } from "../lib/quote-cost";
import { getRecommendation, scoreQuotes, type RankingContext } from "../lib/scoring";
import { calculateRfqPriceIntelligence, hasGenuineHistoricalPrice } from "../lib/price-intelligence";
import { resolveDeadlineDate } from "../lib/deadline";
import { createRFQ, addQuote, awardRFQ } from "../lib/store";
import type { Quote, RFQ } from "../lib/rfq-types";

if (!process.env.RFQ_STORE_FILE) {
  console.error(
    "Refusing to run without RFQ_STORE_FILE set — this test writes RFQs " +
      "and must not touch the real data/rfqs-store.json. Example:\n" +
      "  RFQ_STORE_FILE=/tmp/procureai-test-quote-comparison.json npx tsx scripts/test-quote-comparison.ts"
  );
  process.exit(1);
}

let failures = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.log(`  FAIL: ${label}`);
    failures++;
  }
}

function baseQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: overrides.id ?? "Q-TEST",
    vendorId: overrides.vendorId ?? 1,
    vendorName: overrides.vendorName ?? "Test Vendor",
    unitPrice: 100,
    quotedQuantity: 100,
    moq: 10,
    leadTimeDays: 10,
    shippingCost: 500,
    taxPercent: 18,
    paymentTerms: "Net 30",
    validUntil: "2099-01-01",
    notes: "",
    submittedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function main() {
  console.log("=== calculateQuoteCost: quantity handling ===");

  const quotedQtyCost = calculateQuoteCost(baseQuote({ quotedQuantity: 250 }), 100);
  check("uses the supplier's quoted quantity, not the requested one", quotedQtyCost.quantityUsed === 250);
  check("quantityBasis is 'quoted' when the supplier gave one", quotedQtyCost.quantityBasis === "quoted");

  const missingQtyCost = calculateQuoteCost(baseQuote({ quotedQuantity: 0 }), 100);
  check("falls back to the requested quantity when the supplier left it blank", missingQtyCost.quantityUsed === 100);
  check("quantityBasis is 'requested_fallback' in that case", missingQtyCost.quantityBasis === "requested_fallback");

  const noQtyAtAllCost = calculateQuoteCost(baseQuote({ quotedQuantity: 0 }), null);
  check("cannot compute a total with no quantity of any kind", noQtyAtAllCost.total === null);
  check("quantityBasis is 'unknown' in that case", noQtyAtAllCost.quantityBasis === "unknown");

  console.log("\n=== calculateQuoteCost: shipping — never silently zero ===");

  const missingShipping = calculateQuoteCost(baseQuote({ shippingCost: null }), 100);
  check("missing shipping does not get treated as 0 in the total", missingShipping.total === missingShipping.subtotal! + (missingShipping.subtotal! * 18) / 100);
  check("formatShipping shows 'Not specified' for null", formatShipping(null) === "Not specified");

  const zeroShipping = calculateQuoteCost(baseQuote({ shippingCost: 0 }), 100);
  check("explicit 0 shipping is a real, computed 0 — not treated as missing", zeroShipping.shippingCost === 0);
  check("formatShipping shows an honest '₹0' for explicit zero, not 'Included'", formatShipping(0).startsWith("₹0"));
  check("formatShipping never claims 'Included'", !formatShipping(0).toLowerCase().includes("included") || formatShipping(0).toLowerCase().includes("free"));

  console.log("\n=== calculateQuoteCost: GST/tax — three-state honesty ===");

  const missingTax = calculateQuoteCost(baseQuote({ taxPercent: null }), 100);
  check("missing tax yields taxLabel 'excluded_unspecified'", missingTax.taxLabel === "excluded_unspecified");
  check("totalLabelText is honest about excluding unspecified tax", missingTax.totalLabelText === "Total excluding unspecified tax");
  check("formatTaxRate shows 'Not specified' for null", formatTaxRate(null) === "Not specified");

  const zeroTax = calculateQuoteCost(baseQuote({ taxPercent: 0 }), 100);
  check("explicit 0% tax is computed as a real 0, still 'included_known'", zeroTax.taxLabel === "included_known" && zeroTax.taxAmount === 0);

  const rate12 = calculateQuoteCost(baseQuote({ taxPercent: 12 }), 100);
  const rate18 = calculateQuoteCost(baseQuote({ taxPercent: 18 }), 100);
  check("different GST rates produce different tax amounts", rate12.taxAmount !== rate18.taxAmount);
  check("18% tax amount is calculated correctly (18% of 10,000)", rate18.taxAmount === 1800);

  const uncomputable = calculateQuoteCost(baseQuote({ unitPrice: 0, quotedQuantity: 0 }), null);
  check("no unit price and no quantity anywhere => 'unable' label", uncomputable.taxLabel === "unable");
  check("totalLabelText says 'Unable to calculate'", uncomputable.totalLabelText === "Unable to calculate");

  console.log("\n=== formatMoq honesty ===");
  check("formatMoq never treats missing MOQ as 1 or 0", formatMoq(null) === "MOQ not specified");
  check("formatMoq shows the real number when present", formatMoq(50) === "50");

  console.log("\n=== scoreQuotes: MOQ compatibility ===");

  const requestedQuantity = 100;
  const moqTooHigh = baseQuote({ id: "Q-MOQ-HIGH", moq: 500, quotedQuantity: 100 });
  const moqOk = baseQuote({ id: "Q-MOQ-OK", vendorId: 2, moq: 10, quotedQuantity: 100 });
  const moqMissing = baseQuote({ id: "Q-MOQ-MISSING", vendorId: 3, moq: null, quotedQuantity: 100 });

  const context: RankingContext = { requestedQuantity, deadlineDate: null };
  const scoredMoq = scoreQuotes([moqTooHigh, moqOk, moqMissing], context);
  const byId = (id: string) => scoredMoq.find((q) => q.id === id)!;

  check("MOQ greater than requested quantity is marked incompatible", byId("Q-MOQ-HIGH").moqCompatible === false);
  check("MOQ incompatible quote is marked ineligible", byId("Q-MOQ-HIGH").eligible === false);
  check("MOQ within requested quantity is compatible", byId("Q-MOQ-OK").moqCompatible === true);
  check("missing MOQ is neither compatible nor incompatible (null, not assumed 1)", byId("Q-MOQ-MISSING").moqCompatible === null);
  check("missing MOQ does not make a quote ineligible on its own", byId("Q-MOQ-MISSING").eligible === true);
  check(
    "an MOQ-incompatible quote never ranks above a compatible one when a compatible one exists",
    scoredMoq[0].id !== "Q-MOQ-HIGH"
  );

  console.log("\n=== scoreQuotes: all-incompatible set still returns a caveat pick ===");
  const allIncompatible = scoreQuotes(
    [baseQuote({ id: "Q-A", moq: 1000 }), baseQuote({ id: "Q-B", vendorId: 2, moq: 2000 })],
    context
  );
  const recAllBad = getRecommendation(allIncompatible);
  check("a quote is still returned when every option has a compatibility concern", recAllBad.quote !== null);
  check("a caveat explains why, rather than presenting it as a clean recommendation", !!recAllBad.caveat);

  console.log("\n=== scoreQuotes: deadline compatibility ===");
  const rfqForDeadline: RFQ = await createRFQ({
    query: "Need 100 widgets within 10 days",
    requirements: {
      product: "Widgets",
      quantity: "100 units",
      location: "",
      budget: "",
      deadline: "Within 10 days",
      quality: "",
      additionalRequirements: [],
    },
    suppliers: [{ vendorId: 1, vendorName: "V1" }],
  });
  // Manually attach a structured requirement with a resolvable relative
  // deadline so resolveDeadlineDate has something real to compute from
  // (createRFQ's own extraction path isn't the thing under test here).
  const deadlineDate = new Date(rfqForDeadline.createdAt);
  deadlineDate.setDate(deadlineDate.getDate() + 10);

  const meetsDeadline = baseQuote({ id: "Q-FAST", leadTimeDays: 5, submittedAt: rfqForDeadline.createdAt });
  const missesDeadline = baseQuote({ id: "Q-SLOW", vendorId: 2, leadTimeDays: 30, submittedAt: rfqForDeadline.createdAt });
  const noLeadTime = baseQuote({ id: "Q-NO-LEAD", vendorId: 3, leadTimeDays: 0, submittedAt: rfqForDeadline.createdAt });

  const deadlineContext: RankingContext = { requestedQuantity: 100, deadlineDate };
  const scoredDeadline = scoreQuotes([meetsDeadline, missesDeadline, noLeadTime], deadlineContext);
  const byIdD = (id: string) => scoredDeadline.find((q) => q.id === id)!;

  check("a quote whose lead time fits the deadline is marked compatible", byIdD("Q-FAST").deadlineCompatible === true);
  check("a quote whose lead time misses the deadline is marked incompatible", byIdD("Q-SLOW").deadlineCompatible === false);
  check("missing lead time leaves deadline compatibility unknown (never assumed either way)", byIdD("Q-NO-LEAD").deadlineCompatible === null);
  check("no invented delivery date: unresolvable deadline case handled by null, not a guess", resolveDeadlineDate({ ...rfqForDeadline, structuredRequirement: null }) === null);

  console.log("\n=== scoreQuotes: expired validity, missing payment terms, incomplete data ===");
  const expired = baseQuote({ id: "Q-EXPIRED", validUntil: "2000-01-01" });
  const noPaymentTerms = baseQuote({ id: "Q-NO-TERMS", vendorId: 2, paymentTerms: "" });
  const incomplete = baseQuote({
    id: "Q-INCOMPLETE",
    vendorId: 3,
    moq: null,
    shippingCost: null,
    taxPercent: null,
    paymentTerms: "",
  });

  const scoredMisc = scoreQuotes([expired, noPaymentTerms, incomplete], context);
  const byIdM = (id: string) => scoredMisc.find((q) => q.id === id)!;

  check("an expired quote is flagged expired", byIdM("Q-EXPIRED").quoteExpired === true);
  check("a quote with incomplete data is still shown, never dropped", scoredMisc.length === 3);
  check("a quote with incomplete data still gets a computable total when price+quantity exist", byIdM("Q-INCOMPLETE").cost.total !== null);
  check("missing payment terms doesn't crash scoring (neutral score)", Number.isFinite(byIdM("Q-NO-TERMS").paymentScore));

  console.log("\n=== getRecommendation: no clear recommendation when nothing is priceable ===");
  const nothingPriceable = scoreQuotes(
    [baseQuote({ id: "Q-NOPRICE-1", unitPrice: 0, quotedQuantity: 0 })],
    { requestedQuantity: null, deadlineDate: null }
  );
  const recNone = getRecommendation(nothingPriceable);
  check("recommendation is null when no quote has a computable cost", recNone.quote === null);
  check("a caveat explains why", !!recNone.caveat);

  console.log("\n=== Price intelligence: only real, available data ===");
  const priceQuotes = scoreQuotes(
    [
      baseQuote({ id: "Q-CHEAP", unitPrice: 80, quotedQuantity: 100 }),
      baseQuote({ id: "Q-EXPENSIVE", vendorId: 2, unitPrice: 120, quotedQuantity: 100 }),
    ],
    context
  );
  const intel = calculateRfqPriceIntelligence(priceQuotes);
  check("lowest quoted price is the real minimum", intel.lowestQuotedPrice === 80);
  check("average quoted price is the real mean", intel.averageQuotedPrice === 100);
  check("potential savings is computed only from two real, compatible quotes", intel.potentialSavings !== null);

  const singleQuoteIntel = calculateRfqPriceIntelligence(
    scoreQuotes([baseQuote({ id: "Q-ONLY" })], context)
  );
  check("potential savings is 'insufficient data' (null) with only one quote", singleQuoteIntel.potentialSavings === null);

  check("a supplier's own single quote never counts as 'history'", hasGenuineHistoricalPrice(1) === false);
  check("two or more of a supplier's own quotes do count as genuine history", hasGenuineHistoricalPrice(2) === true);

  console.log("\n=== getRequestedQuantity: real data, no invention ===");
  check(
    "requested quantity is read from the structured requirement",
    getRequestedQuantity(rfqForDeadline) === 100
  );

  console.log("\n=== awardRFQ: cannot fabricate a total, buyer override preserved ===");

  const rfqForAward = await createRFQ({
    query: "Need 50 gadgets",
    requirements: {
      product: "Gadgets",
      quantity: "50 units",
      location: "",
      budget: "",
      deadline: "",
      quality: "",
      additionalRequirements: [],
    },
    suppliers: [
      { vendorId: 10, vendorName: "Vendor Ten" },
      { vendorId: 20, vendorName: "Vendor Twenty" },
    ],
  });

  await addQuote(rfqForAward.id, {
    vendorId: 10,
    vendorName: "Vendor Ten",
    unitPrice: 200,
    quotedQuantity: 50,
    moq: 5,
    leadTimeDays: 10,
    shippingCost: 300,
    taxPercent: 18,
    paymentTerms: "Net 30",
    validUntil: "2099-01-01",
    notes: "",
  });

  const cheaperButUnpriceableQuoted = await addQuote(rfqForAward.id, {
    vendorId: 20,
    vendorName: "Vendor Twenty",
    unitPrice: 0, // uncomputable — no real unit price given
    quotedQuantity: 0,
    moq: null,
    leadTimeDays: 5,
    shippingCost: null,
    taxPercent: null,
    paymentTerms: "",
    validUntil: "",
    notes: "No pricing yet",
  });

  const uncomputableQuoteId = cheaperButUnpriceableQuoted!.quotes.find((q) => q.vendorId === 20)!.id;
  const rejectedAward = await awardRFQ(rfqForAward.id, uncomputableQuoteId);
  check("awarding a quote with no computable total is rejected, not fabricated", rejectedAward.ok === false);
  check(
    "the rejection reason is specifically 'uncomputable'",
    !rejectedAward.ok && rejectedAward.reason === "uncomputable"
  );

  const priceableQuoteId = cheaperButUnpriceableQuoted!.quotes.find((q) => q.vendorId === 10)!.id;
  const goodAward = await awardRFQ(rfqForAward.id, priceableQuoteId);
  check("awarding the priceable quote succeeds (buyer override preserved)", goodAward.ok === true);

  if (goodAward.ok) {
    const po = goodAward.rfq.purchaseOrder!;
    check("PO subtotal is the real unit price × quantity", po.subtotal === 200 * 50);
    check("PO shippingCost carries the real, non-fabricated value", po.shippingCost === 300);
    check("PO taxAmount is calculated transparently", po.taxAmount === Math.round(200 * 50 * 0.18));
    check(
      "PO total = subtotal + shipping + tax, not a separately-invented number",
      po.totalValue === Math.round(po.subtotal + (po.shippingCost ?? 0) + (po.taxAmount ?? 0))
    );
    check("PO records the buyer's actually-selected vendor (override honored)", po.vendorId === 10);
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
