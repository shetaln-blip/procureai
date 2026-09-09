"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { RFQ, RFQStatus } from "@/lib/rfq-types";
import type { DataConfidence } from "@/lib/supplier-types";
import {
  getRecommendation,
  scoreQuotes,
  summarizeReasons,
  type Reason,
  type ScoredQuote,
} from "@/lib/scoring";
import {
  formatCurrency,
  formatMoq,
  formatShipping,
  formatTaxRate,
  getRequestedQuantity,
} from "@/lib/quote-cost";
import { resolveDeadlineDate } from "@/lib/deadline";
import {
  calculateRfqPriceIntelligence,
  hasGenuineHistoricalPrice,
  EXTERNAL_BENCHMARK_NOTE,
} from "@/lib/price-intelligence";
import {
  toSupplierFacingRequirement,
  type SupplierFacingRequirement,
} from "@/lib/extraction/supplier-view";

// The RFQ detail response additively includes these three maps
// (app/api/rfqs/[id]/route.ts) alongside every existing RFQ field —
// nothing about the RFQ shape itself, its security fields, or the
// invitation-token flow changed to add them.
type RFQWithIntel = RFQ & {
  supplierConfidence: Record<number, DataConfidence | null>;
  supplierHistoricalPrice: Record<number, number | null>;
  supplierHistoricalQuoteCount: Record<number, number>;
};

const STATUS_LABEL: Record<RFQStatus, string> = {
  draft: "Draft",
  sent: "Awaiting quotes",
  quotes_received: "Quotes received",
  awarded: "Awarded",
};

const pillOutline =
  "rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950";
const pillPrimary =
  "rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50";

function formatPrice(price: SupplierFacingRequirement["price"]): string {
  if (!price || price.amount === null) return "";

  const symbol =
    price.currencySymbol ?? (price.currency ? `${price.currency} ` : "");
  const perUnit = price.basis === "per_unit" ? " per unit" : "";

  if (price.type === "range" && price.amountMax !== null) {
    return `${symbol}${price.amount.toLocaleString(
      "en-IN"
    )}–${symbol}${price.amountMax.toLocaleString("en-IN")}${perUnit}`;
  }

  if (price.type === "maximum") {
    return `Under ${symbol}${price.amount.toLocaleString("en-IN")}${perUnit}`;
  }

  if (price.basis === "total_budget") {
    return `Budget: ${symbol}${price.amount.toLocaleString("en-IN")}`;
  }

  return `${symbol}${price.amount.toLocaleString("en-IN")}${perUnit}`;
}

function joinList(list: string[]): string {
  return list.join(", ");
}

function formatConfidence(confidence: DataConfidence | null): string {
  if (confidence === "high") return "High";
  if (confidence === "medium") return "Medium";
  if (confidence === "low") return "Low";
  return "Not available";
}

function formatCompatibility(
  value: boolean | null,
  compatibleLabel: string,
  incompatibleLabel: string,
  unknownLabel: string
): { text: string; tone: "good" | "bad" | "unknown" } {
  if (value === true) return { text: compatibleLabel, tone: "good" };
  if (value === false) return { text: incompatibleLabel, tone: "bad" };
  return { text: unknownLabel, tone: "unknown" };
}

export default function RFQDetailPage() {
  const params = useParams<{ id: string }>();
  const rfqId = params.id;

  const [rfq, setRfq] = useState<RFQWithIntel | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copiedVendorId, setCopiedVendorId] = useState<number | null>(
    null
  );
  const [awarding, setAwarding] = useState<string | null>(null);
  const [awardError, setAwardError] = useState<string>("");

  useEffect(() => {
    const load = () => {
      fetch(`/api/rfqs/${rfqId}`, { cache: "no-store" })
        .then((res) => {
          if (res.status === 404) {
            setNotFound(true);
            return null;
          }

          return res.json();
        })
        .then((data) => {
          if (data) setRfq(data);
        })
        .catch((error) => console.error(error))
        .finally(() => setLoading(false));
    };

    load();

    // Poll for new quotes — there's no live-update channel wired up yet.
    const interval = setInterval(load, 5000);

    return () => clearInterval(interval);
  }, [rfqId]);

  const copyLink = async (vendorId: number) => {
    // Always mints a fresh secure invitation token (P0 #2) — this is
    // the one code path that issues tokens, whether this is the first
    // link generated for this supplier or a reissue. Any link
    // generated before this existed is upgraded the moment it's
    // (re)copied, since issuing a token immediately disables that
    // supplier's old guessable `?vendor=` link.
    let link = `${window.location.origin}/respond/${rfqId}?vendor=${vendorId}`;

    try {
      const res = await fetch(
        `/api/rfqs/${rfqId}/suppliers/${vendorId}/token`,
        { method: "POST" }
      );

      if (res.ok) {
        const data = await res.json();
        link = `${window.location.origin}/respond/${rfqId}?token=${data.token}`;
      }
    } catch (error) {
      console.error("Failed to issue a secure invitation token:", error);
    }

    try {
      await navigator.clipboard.writeText(link);
      setCopiedVendorId(vendorId);
      setTimeout(() => setCopiedVendorId(null), 2000);
    } catch {
      window.prompt(
        "Copy this link to share with the supplier:",
        link
      );
    }
  };

  const award = async (quoteId: string) => {
    setAwarding(quoteId);
    setAwardError("");

    try {
      const res = await fetch(`/api/rfqs/${rfqId}/award`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to award.");
      }

      setRfq((prev) => (prev ? { ...prev, ...data } : data));
    } catch (error) {
      setAwardError(
        error instanceof Error ? error.message : "Failed to award RFQ."
      );
    } finally {
      setAwarding(null);
    }
  };

  // Everything below is a pure derivation from the RFQ already in state
  // — no extra fetch, and never re-computed with different rules
  // between the comparison view, the recommendation badge, and the PO
  // (they all read from the same `scored`/`priceIntel`).
  const requestedQuantity = rfq ? getRequestedQuantity(rfq) : null;
  const deadlineDate = rfq ? resolveDeadlineDate(rfq) : null;

  const scored: ScoredQuote[] = useMemo(() => {
    if (!rfq) return [];

    return scoreQuotes(rfq.quotes, {
      requestedQuantity,
      deadlineDate,
      supplierConfidence: rfq.supplierConfidence,
    });
  }, [rfq, requestedQuantity, deadlineDate]);

  const recommendation = useMemo(() => getRecommendation(scored), [scored]);
  const priceIntel = useMemo(
    () => calculateRfqPriceIntelligence(scored),
    [scored]
  );

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-400">
        Loading RFQ…
      </main>
    );
  }

  if (notFound || !rfq) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 text-center">
        <h1 className="font-display text-2xl font-semibold">RFQ not found</h1>
        <Link
          href="/rfqs"
          className="border-b border-dashed border-zinc-400 pb-0.5 text-sm font-medium text-zinc-950 hover:border-zinc-950"
        >
          Back to RFQs
        </Link>
      </main>
    );
  }

  const bestQuoteId = recommendation.quote?.id ?? null;
  const specTags = rfq.requirements.quality
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .concat(rfq.requirements.additionalRequirements);
  // The same structured requirement suppliers see on the response page
  // (P0 #1) — rendered here too so the buyer can confirm suppliers are
  // quoting against exactly what was submitted.
  const sr = rfq.structuredRequirement
    ? toSupplierFacingRequirement(rfq.structuredRequirement)
    : null;

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <nav className="bg-zinc-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-5">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-white"
          >
            Procure<span className="text-amber-500">AI</span>
          </Link>

          <Link
            href="/rfqs"
            className="text-sm text-zinc-400 transition hover:text-white"
          >
            ← All RFQs
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-8 py-16">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            {rfq.id}
          </span>

          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {STATUS_LABEL[rfq.status]}
          </span>
        </div>

        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">
          {rfq.requirements.product || rfq.query}
        </h1>

        {/* RFQ SPEC */}
        <div className="mt-8 rounded-md border border-zinc-200 bg-white p-7">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Request for quotation
          </div>

          {sr ? (
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <SpecField label="Product" value={sr.product ?? rfq.requirements.product} />
              <SpecField
                label="Quantity"
                value={sr.quantity !== null ? sr.quantity.toLocaleString("en-IN") : ""}
              />
              <SpecField label="Unit" value={sr.unit ?? ""} />
              <SpecField label="Intended use" value={sr.intendedUse ?? ""} />
              <SpecField label="Delivery location" value={sr.location ?? ""} />
              <SpecField label="Deadline" value={sr.deliveryTimeframe ?? ""} />
              <SpecField label="Budget / price basis" value={formatPrice(sr.price)} />
              <SpecField label="Material" value={sr.material ?? ""} />
              <SpecField label="Construction" value={joinList(sr.construction)} />
              <SpecField label="Quality requirements" value={joinList(sr.qualityRequirements)} />
              <SpecField
                label="Sustainability requirements"
                value={joinList(sr.sustainabilityRequirements)}
              />
              <SpecField label="Certifications" value={joinList(sr.certifications)} />
              <SpecField
                label="Required capabilities"
                value={joinList(sr.requiredCapabilities)}
              />
              <SpecField
                label="Customization"
                value={joinList(sr.customizationRequirements)}
              />
              <SpecField
                label="Packaging requirements"
                value={joinList(sr.packagingRequirements)}
              />
              <SpecField
                label="Shipping requirements"
                value={joinList(sr.shippingRequirements)}
              />
              <SpecField label="Payment terms" value={sr.paymentTerms ?? ""} />
              <SpecField
                label="Additional constraints"
                value={joinList(sr.additionalConstraints)}
              />
            </div>
          ) : (
            <>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <SpecField
                  label="Product"
                  value={rfq.requirements.product}
                />
                <SpecField
                  label="Quantity"
                  value={rfq.requirements.quantity}
                />
                <SpecField
                  label="Delivery location"
                  value={rfq.requirements.location}
                />
                <SpecField
                  label="Required by"
                  value={rfq.requirements.deadline}
                />
              </div>

              {specTags.length > 0 && (
                <div className="mt-5 border-t border-zinc-100 pt-5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Specifications
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {specTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="mt-5 border-t border-zinc-100 pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Suppliers should provide
            </p>

            <ul className="mt-2 grid gap-1 text-sm text-zinc-600 sm:grid-cols-2">
              <li>• Unit price</li>
              <li>• Minimum order quantity</li>
              <li>• Lead time</li>
              <li>• Payment terms</li>
              <li>• Shipping cost</li>
              <li>• Taxes (GST)</li>
              <li>• Quote validity</li>
            </ul>
          </div>
        </div>

        {/* INVITED SUPPLIERS */}
        <div className="mt-10">
          <h2 className="font-display text-xl font-semibold">
            Invited suppliers ({rfq.suppliers.length})
          </h2>

          <p className="mt-1 text-sm text-zinc-500">
            There&apos;s no email integration yet — copy each
            supplier&apos;s link and send it however you&apos;d
            normally reach them.
          </p>

          <div className="mt-5 grid gap-3">
            {rfq.suppliers.map((supplier) => (
              <div
                key={supplier.vendorId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-5 py-4"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      supplier.status === "quoted"
                        ? "bg-emerald-500"
                        : "bg-amber-500"
                    }`}
                  />

                  <div>
                    <p className="font-medium">
                      {supplier.vendorName}
                    </p>

                    <p className="text-xs text-zinc-400">
                      {supplier.status === "quoted"
                        ? "Quote received"
                        : "Awaiting response"}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => copyLink(supplier.vendorId)}
                  className={pillOutline}
                >
                  {copiedVendorId === supplier.vendorId
                    ? "Link copied ✓"
                    : "Copy response link"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* PRICE INTELLIGENCE */}
        {scored.length > 0 && (
          <div className="mt-10 rounded-md border border-zinc-200 bg-white p-7">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Price intelligence — this RFQ
            </div>

            <p className="mt-2 text-xs text-zinc-400">
              Derived only from the {scored.length} quote
              {scored.length === 1 ? "" : "s"} received on this RFQ.
              Supplier-specific history comes from ProcureAI&apos;s own
              records below, per supplier. {EXTERNAL_BENCHMARK_NOTE}
            </p>

            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              <QuoteDetail
                label="Lowest quoted unit price"
                value={
                  priceIntel.lowestQuotedPrice !== null
                    ? `₹${priceIntel.lowestQuotedPrice.toLocaleString("en-IN")}`
                    : "Insufficient data"
                }
                sub={priceIntel.lowestQuotedPriceVendor ?? undefined}
              />
              <QuoteDetail
                label="Average quoted unit price"
                value={
                  priceIntel.averageQuotedPrice !== null
                    ? `₹${priceIntel.averageQuotedPrice.toLocaleString("en-IN")}`
                    : "Insufficient data"
                }
              />
              <QuoteDetail
                label="Potential savings"
                value={
                  priceIntel.potentialSavings
                    ? `₹${priceIntel.potentialSavings.amount.toLocaleString("en-IN")}`
                    : "Insufficient data"
                }
                sub={
                  priceIntel.potentialSavings
                    ? `vs. ${priceIntel.potentialSavings.vsVendorName}'s total (both compatible quotes)`
                    : "Needs 2+ compatible, priceable quotes"
                }
              />
            </div>
          </div>
        )}

        {/* RECOMMENDATION */}
        {scored.length > 0 && (
          <div
            className={`mt-10 rounded-md border p-6 ${
              recommendation.quote
                ? recommendation.caveat
                  ? "border-amber-400 bg-amber-50"
                  : "border-emerald-500 bg-emerald-50"
                : "border-zinc-300 bg-zinc-100"
            }`}
          >
            {recommendation.quote ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  {recommendation.caveat ? "Closest option" : "Recommended"}
                </p>
                <p className="mt-1 font-medium">
                  {recommendation.quote.vendorName} —{" "}
                  {summarizeReasons(recommendation.quote.reasons)}
                </p>
                {recommendation.caveat && (
                  <p className="mt-1 text-sm text-zinc-600">
                    {recommendation.caveat}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  No clear recommendation
                </p>
                <p className="mt-1 text-sm text-zinc-600">
                  {recommendation.caveat}
                </p>
              </>
            )}
            <p className="mt-2 text-xs text-zinc-400">
              You can still award any quote below — this is a starting
              point, not a decision.
            </p>
          </div>
        )}

        {/* QUOTES */}
        <div className="mt-10">
          <h2 className="font-display text-xl font-semibold">
            Quotes ({scored.length}/{rfq.suppliers.length})
          </h2>

          {requestedQuantity !== null && (
            <p className="mt-1 text-sm text-zinc-500">
              Buyer requested quantity:{" "}
              <span className="font-medium text-zinc-800">
                {requestedQuantity.toLocaleString("en-IN")}
              </span>
            </p>
          )}

          {scored.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">
              No quotes yet. Once a supplier submits one, ProcureAI
              will rank it here automatically.
            </p>
          ) : (
            <div className="mt-5 grid gap-4">
              {scored.map((quote) => {
                const isBest =
                  quote.id === bestQuoteId &&
                  rfq.status !== "awarded";
                const isAwarded =
                  rfq.purchaseOrder?.quoteId === quote.id;

                const moqCompat = formatCompatibility(
                  quote.moqCompatible,
                  "Compatible with requested quantity",
                  "MOQ not compatible",
                  "MOQ not specified"
                );
                const deadlineCompat = formatCompatibility(
                  quote.deadlineCompatible,
                  "Meets deadline",
                  "Deadline may not be met",
                  deadlineDate === null
                    ? "No deadline specified"
                    : "Cannot determine — lead time not specified"
                );

                const historicalCount =
                  rfq.supplierHistoricalQuoteCount[quote.vendorId] ?? 0;
                const historicalPrice =
                  rfq.supplierHistoricalPrice[quote.vendorId] ?? null;
                const showHistorical =
                  hasGenuineHistoricalPrice(historicalCount) &&
                  historicalPrice !== null;

                return (
                  <div
                    key={quote.id}
                    className={`rounded-md border bg-white p-6 ${
                      isBest || isAwarded
                        ? "border-zinc-950"
                        : "border-zinc-200"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="font-display text-lg font-semibold">
                            {quote.vendorName}
                          </h3>

                          {isAwarded && (
                            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Awarded
                            </span>
                          )}

                          {isBest && !isAwarded && (
                            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              {recommendation.caveat
                                ? "Closest option"
                                : "Recommended"}
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {quote.reasons.length > 0 ? (
                            quote.reasons.map((reason: Reason, idx) => (
                              <span
                                key={`${reason.label}-${idx}`}
                                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                                  reason.type === "positive"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-amber-50 text-amber-700"
                                }`}
                              >
                                {reason.label}
                              </span>
                            ))
                          ) : (
                            <span className="rounded-md bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-500">
                              Balanced across price, delivery and payment terms
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-display text-2xl font-bold text-zinc-950">
                          {quote.totalScore}/100
                        </div>

                        <p className="text-[11px] uppercase tracking-wider text-zinc-400">
                          quote score
                        </p>
                      </div>
                    </div>

                    {/* Total landed cost callout */}
                    <div className="mt-5 rounded-md border border-zinc-100 bg-zinc-50 p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                          Total landed cost
                        </p>
                        <p className="text-xs font-medium text-zinc-500">
                          {quote.cost.totalLabelText}
                        </p>
                      </div>
                      <p className="mt-1 font-display text-2xl font-bold text-zinc-950">
                        {formatCurrency(quote.cost.total)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {quote.cost.quantityBasis === "quoted"
                          ? `Based on the supplier's quoted quantity (${quote.cost.quantityUsed.toLocaleString("en-IN")})`
                          : quote.cost.quantityBasis === "requested_fallback"
                            ? `Supplier didn't quote a quantity — using the buyer's requested quantity (${quote.cost.quantityUsed.toLocaleString("en-IN")})`
                            : "Cannot calculate — no quantity available"}
                      </p>
                    </div>

                    <div className="mt-5 grid gap-4 border-t border-zinc-100 pt-5 sm:grid-cols-4">
                      <QuoteDetail
                        label="Unit price"
                        value={`₹${quote.unitPrice.toLocaleString("en-IN")}`}
                        sub={`${quote.priceScore}/100`}
                      />
                      <QuoteDetail
                        label="Quoted quantity"
                        value={
                          quote.quotedQuantity
                            ? quote.quotedQuantity.toLocaleString("en-IN")
                            : "Not specified"
                        }
                      />
                      <QuoteDetail
                        label="Lead time"
                        value={
                          quote.leadTimeDays > 0
                            ? `${quote.leadTimeDays} days`
                            : "Not specified"
                        }
                        sub={`${quote.leadTimeScore}/100`}
                      />
                      <QuoteDetail
                        label="Payment terms"
                        value={quote.paymentTerms || "Not specified"}
                        sub={`${quote.paymentScore}/100`}
                      />
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-4">
                      <QuoteDetail label="MOQ" value={formatMoq(quote.moq)} />
                      <QuoteDetail
                        label="Shipping"
                        value={formatShipping(quote.shippingCost)}
                      />
                      <QuoteDetail
                        label="GST / Tax"
                        value={formatTaxRate(quote.taxPercent)}
                      />
                      <QuoteDetail
                        label="Valid until"
                        value={
                          quote.validUntil
                            ? `${quote.validUntil}${quote.quoteExpired ? " (expired)" : ""}`
                            : "Not specified"
                        }
                      />
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                      <CompatibilityDetail
                        label="Requested quantity"
                        compat={moqCompat}
                      />
                      <CompatibilityDetail
                        label="Required deadline"
                        compat={deadlineCompat}
                      />
                      <QuoteDetail
                        label="Supplier confidence"
                        value={formatConfidence(quote.supplierConfidence)}
                      />
                    </div>

                    {showHistorical && (
                      <p className="mt-4 text-xs text-zinc-400">
                        ProcureAI-derived: this supplier&apos;s average
                        quoted unit price across {historicalCount} quotes
                        on ProcureAI is ₹
                        {(historicalPrice as number).toLocaleString("en-IN")}.
                      </p>
                    )}

                    {quote.notes && (
                      <p className="mt-4 rounded-md border border-zinc-100 bg-zinc-50 p-3 text-sm italic text-zinc-600">
                        “{quote.notes}”
                      </p>
                    )}

                    {rfq.status !== "awarded" && (
                      <div className="mt-5 flex justify-end border-t border-zinc-100 pt-5">
                        <button
                          onClick={() => award(quote.id)}
                          disabled={awarding === quote.id}
                          className={pillPrimary}
                        >
                          {awarding === quote.id
                            ? "Awarding…"
                            : "Award & generate PO"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {awardError && (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {awardError}
            </p>
          )}
        </div>

        {/* PURCHASE ORDER */}
        {rfq.purchaseOrder && (
          <div className="mt-10 rounded-md border border-emerald-500 bg-white p-7">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Purchase order
            </div>

            <h2 className="mt-2 font-display text-2xl font-semibold">
              {rfq.purchaseOrder.poNumber}
            </h2>

            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              <QuoteDetail
                label="Supplier"
                value={rfq.purchaseOrder.vendorName}
              />
              <QuoteDetail
                label="Product"
                value={rfq.requirements.product || rfq.query}
              />
              <QuoteDetail
                label="Quantity"
                value={rfq.purchaseOrder.quantity.toLocaleString(
                  "en-IN"
                )}
              />
              <QuoteDetail
                label="Unit price"
                value={`₹${rfq.purchaseOrder.unitPrice.toLocaleString("en-IN")}`}
              />
              <QuoteDetail
                label="Subtotal"
                value={`₹${rfq.purchaseOrder.subtotal.toLocaleString("en-IN")}`}
              />
              <QuoteDetail
                label="Shipping"
                value={formatShipping(rfq.purchaseOrder.shippingCost)}
              />
              <QuoteDetail
                label="GST / Tax"
                value={
                  rfq.purchaseOrder.taxPercent !== null &&
                  rfq.purchaseOrder.taxAmount !== null
                    ? `${formatTaxRate(rfq.purchaseOrder.taxPercent)} (₹${rfq.purchaseOrder.taxAmount.toLocaleString("en-IN")})`
                    : "Not specified"
                }
              />
              <QuoteDetail
                label="Total value"
                value={`₹${rfq.purchaseOrder.totalValue.toLocaleString("en-IN")}`}
                sub={
                  rfq.purchaseOrder.taxPercent === null
                    ? "Excludes unspecified tax"
                    : "Includes known tax"
                }
              />
              <QuoteDetail
                label="Payment terms"
                value={rfq.purchaseOrder.paymentTerms}
              />
              <QuoteDetail
                label="Delivery by"
                value={rfq.purchaseOrder.deliveryBy}
              />
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function SpecField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </p>

      <p className="mt-1 font-medium">{value || "Not specified"}</p>
    </div>
  );
}

function QuoteDetail({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </p>

      <p className="mt-1 text-sm font-medium text-zinc-800">
        {value}
      </p>

      {sub && <p className="text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

function CompatibilityDetail({
  label,
  compat,
}: {
  label: string;
  compat: { text: string; tone: "good" | "bad" | "unknown" };
}) {
  const toneClass =
    compat.tone === "good"
      ? "text-emerald-700"
      : compat.tone === "bad"
        ? "text-red-700"
        : "text-zinc-500";

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </p>

      <p className={`mt-1 text-sm font-medium ${toneClass}`}>
        {compat.text}
      </p>
    </div>
  );
}
