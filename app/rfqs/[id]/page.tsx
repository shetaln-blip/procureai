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
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Table,
  Th,
  Td,
} from "@/components/ui";

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

const STATUS_TONE: Record<RFQStatus, BadgeTone> = {
  draft: "neutral",
  sent: "warning",
  quotes_received: "accent",
  awarded: "success",
};

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
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading RFQ…
      </main>
    );
  }

  if (notFound || !rfq) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg text-center text-text-secondary">
        <h1 className="font-ledger-serif text-2xl font-medium text-text-primary">
          RFQ not found
        </h1>
        <Link
          href="/rfqs"
          className="border-b border-dashed border-border-strong pb-0.5 text-sm font-medium text-text-primary transition hover:border-accent hover:text-accent"
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
    <main className="min-h-screen bg-bg text-text-primary">
      <nav className="border-b border-border bg-bg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 sm:px-8">
          <Link
            href="/"
            className="font-ledger-serif text-xl font-medium tracking-tight text-text-primary"
          >
            Procure<span className="text-accent">AI</span>
          </Link>

          <Link
            href="/rfqs"
            className="font-ledger-mono text-[11px] uppercase tracking-[0.06em] text-text-secondary transition hover:text-text-primary"
          >
            ← All RFQs
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-16 sm:px-8">
        <PageHeader
          eyebrow={rfq.id}
          eyebrowTone={STATUS_TONE[rfq.status]}
          title={rfq.requirements.product || rfq.query}
          meta={
            <div className="mt-4">
              <Badge tone={STATUS_TONE[rfq.status]} dot>
                {STATUS_LABEL[rfq.status]}
              </Badge>
            </div>
          }
        />

        <div className="mt-8 grid gap-2 sm:grid-cols-3">
          {[
            { step: "1", label: "Select suppliers", active: true },
            { step: "2", label: "Send RFQ", active: true },
            {
              step: "3",
              label: "Receive and compare quotes",
              active: rfq.quotes.length > 0,
            },
          ].map(({ step, label, active }) => (
            <div
              key={step}
              className={`flex items-center gap-3 rounded-md border px-4 py-3 ${
                active
                  ? "border-border-strong bg-surface text-text-primary"
                  : "border-border bg-surface-sunken text-text-tertiary"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  active
                    ? "bg-accent text-accent-contrast"
                    : "border border-border-strong text-text-tertiary"
                }`}
              >
                {step}
              </span>
              <span className="text-sm font-medium">{label}</span>
            </div>
          ))}
        </div>

        {/* RFQ SPEC */}
        <Card padding="lg" className="mt-8">
          <div className="eyebrow text-accent">
            <span className="eyebrow-dot bg-accent" />
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
              <SpecField label="Pricing preference" value={joinList(sr.pricingPreferences)} />
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
                <div className="mt-5 border-t border-border pt-5">
                  <p className="font-ledger-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
                    Specifications
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {specTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="mt-5 border-t border-border pt-5">
            <p className="font-ledger-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
              Suppliers should provide
            </p>

            <ul className="mt-2 grid gap-1 text-sm text-text-secondary sm:grid-cols-2">
              <li>• Unit price</li>
              <li>• Minimum order quantity</li>
              <li>• Lead time</li>
              <li>• Payment terms</li>
              <li>• Shipping cost</li>
              <li>• Taxes (GST)</li>
              <li>• Quote validity</li>
            </ul>
          </div>
        </Card>

        {/* INVITED SUPPLIERS */}
        <div className="mt-10">
          <h2 className="font-ledger-serif text-xl font-medium text-text-primary">
            Invited suppliers ({rfq.suppliers.length})
          </h2>

          <p className="mt-1 text-sm text-text-secondary">
            There&apos;s no email integration yet — copy each
            supplier&apos;s link and send it however you&apos;d
            normally reach them.
          </p>

          <div className="mt-5 grid gap-3">
            {rfq.suppliers.map((supplier) => (
              <Card
                key={supplier.vendorId}
                padding="sm"
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <Badge
                    tone={supplier.status === "quoted" ? "success" : "warning"}
                    dot
                  >
                    {supplier.status === "quoted" ? "Quoted" : "Invited"}
                  </Badge>

                  <div>
                    <p className="font-medium text-text-primary">
                      {supplier.vendorName}
                    </p>

                    <p className="text-xs text-text-tertiary">
                      {supplier.status === "quoted"
                        ? "Quote received"
                        : "Awaiting response"}
                    </p>
                  </div>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => copyLink(supplier.vendorId)}
                >
                  {copiedVendorId === supplier.vendorId
                    ? "Link copied ✓"
                    : "Copy response link"}
                </Button>
              </Card>
            ))}
          </div>
        </div>

        {/* PRICE INTELLIGENCE */}
        {scored.length > 0 && (
          <Card padding="lg" className="mt-10">
            <div className="eyebrow text-accent">
              <span className="eyebrow-dot bg-accent" />
              Price intelligence — this RFQ
            </div>

            <p className="mt-2 text-xs text-text-tertiary">
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
          </Card>
        )}

        {/* RECOMMENDATION */}
        {scored.length > 0 && (
          <div className="mt-10">
            <h2 className="font-ledger-serif text-xl font-medium text-text-primary">
              Recommendation
            </h2>

            <Card
              tone={recommendation.quote && !recommendation.caveat ? "accent" : "surface"}
              padding="lg"
              className="mt-4"
            >
              {recommendation.quote ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="font-ledger-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
                        {recommendation.caveat ? "Closest option" : "Recommended quote"}
                      </p>
                      <p className="mt-1 font-ledger-serif text-xl font-medium text-text-primary">
                        {recommendation.quote.vendorName}
                      </p>
                      <p className="mt-1 text-sm text-text-secondary">
                        {summarizeReasons(recommendation.quote.reasons)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-ledger-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
                        Landed cost
                      </p>
                      <p className="tabular font-ledger-mono text-2xl font-semibold text-text-primary">
                        {formatCurrency(recommendation.quote.cost.total)}
                      </p>
                    </div>
                  </div>
                  {recommendation.caveat && (
                    <Notice tone="warning" className="mt-4">
                      {recommendation.caveat}
                    </Notice>
                  )}
                </>
              ) : (
                <>
                  <p className="font-ledger-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
                    No clear recommendation
                  </p>
                  <Notice tone="warning" className="mt-3">
                    {recommendation.caveat}
                  </Notice>
                </>
              )}
              <p className="mt-3 text-xs text-text-tertiary">
                You can still award any quote below — this is a starting
                point, not a decision.
              </p>
            </Card>
          </div>
        )}

        {/* QUOTES */}
        <div className="mt-10">
          <h2 className="font-ledger-serif text-xl font-medium text-text-primary">
            Quotes ({scored.length}/{rfq.suppliers.length})
          </h2>

          {requestedQuantity !== null && (
            <p className="mt-1 text-sm text-text-secondary">
              Buyer requested quantity:{" "}
              <span className="tabular font-medium text-text-primary">
                {requestedQuantity.toLocaleString("en-IN")}
              </span>
            </p>
          )}

          {scored.length === 0 ? (
            <EmptyState
              title="No quotes yet"
              description="Once a supplier submits one, ProcureAI will rank it here automatically."
            />
          ) : (
            <div className="mt-5">
              <Table>
                <thead>
                  <tr>
                    <Th>Supplier</Th>
                    <Th>Price</Th>
                    <Th>MOQ</Th>
                    <Th>Lead time</Th>
                    <Th>Shipping</Th>
                    <Th>Payment terms</Th>
                    <Th>Match score</Th>
                    <Th>Risk</Th>
                    <Th>Recommendation</Th>
                    <Th>Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {scored.map((quote) => {
                    const isBest =
                      quote.id === bestQuoteId &&
                      rfq.status !== "awarded";
                    const isAwarded =
                      rfq.purchaseOrder?.quoteId === quote.id;

                    const moqBadge: { tone: BadgeTone; label: string } =
                      quote.moqCompatible === true
                        ? { tone: "success", label: "Compatible" }
                        : quote.moqCompatible === false
                          ? { tone: "danger", label: "Below MOQ" }
                          : { tone: "neutral", label: "Not specified" };

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

                    // "Quote validity has expired" is already surfaced
                    // via the dedicated Expired badge below — filtered
                    // out here so it isn't shown twice.
                    const riskReasons = quote.reasons.filter(
                      (reason: Reason) =>
                        reason.label !== "Quote validity has expired"
                    );

                    return (
                      <tr
                        key={quote.id}
                        className={isBest ? "bg-accent-soft" : undefined}
                      >
                        <Td>
                          <p className="font-ledger-serif text-base font-medium text-text-primary">
                            {quote.vendorName}
                          </p>
                          <p className="mt-1 text-[11px] text-text-tertiary">
                            Confidence: {formatConfidence(quote.supplierConfidence)}
                          </p>
                          {quote.notes && (
                            <p className="mt-1.5 max-w-[220px] text-xs italic leading-5 text-text-secondary">
                              “{quote.notes}”
                            </p>
                          )}
                        </Td>

                        <Td>
                          <p className="tabular font-ledger-mono text-sm text-text-primary">
                            ₹{quote.unitPrice.toLocaleString("en-IN")}
                            <span className="text-text-tertiary"> / unit</span>
                          </p>
                          <div className="mt-2 border-t border-border pt-2">
                            <p className="tabular font-ledger-mono text-base font-semibold text-text-primary">
                              {formatCurrency(quote.cost.total)}
                            </p>
                            <p className="mt-0.5 text-[11px] text-text-tertiary">
                              {quote.cost.totalLabelText}
                            </p>
                          </div>
                          <p className="mt-2 text-[11px] text-text-tertiary">
                            {quote.cost.quantityBasis === "quoted"
                              ? `Qty ${quote.cost.quantityUsed.toLocaleString("en-IN")} (quoted)`
                              : quote.cost.quantityBasis === "requested_fallback"
                                ? `Qty ${quote.cost.quantityUsed.toLocaleString("en-IN")} (buyer's requested qty)`
                                : "Qty unknown"}
                            {" · GST "}
                            {formatTaxRate(quote.taxPercent)}
                          </p>
                          {showHistorical && (
                            <p className="mt-2 text-[11px] text-text-tertiary">
                              Supplier avg on ProcureAI ({historicalCount} quotes): ₹
                              {(historicalPrice as number).toLocaleString("en-IN")}
                            </p>
                          )}
                          <p className="mt-2 font-ledger-mono text-[10px] uppercase tracking-[0.06em] text-text-tertiary">
                            {quote.priceScore}/100 price score
                          </p>
                        </Td>

                        <Td>
                          <p className="tabular text-sm text-text-primary">
                            {formatMoq(quote.moq)}
                          </p>
                          <Badge tone={moqBadge.tone} className="mt-2">
                            {moqBadge.label}
                          </Badge>
                        </Td>

                        <Td>
                          <p className="tabular text-sm text-text-primary">
                            {quote.leadTimeDays > 0
                              ? `${quote.leadTimeDays} days`
                              : "Not specified"}
                          </p>
                          <p className="mt-1 font-ledger-mono text-[10px] uppercase tracking-[0.06em] text-text-tertiary">
                            {quote.leadTimeScore}/100 lead-time score
                          </p>
                          {quote.deadlineCompatible === false && (
                            <Badge tone="warning" className="mt-2">
                              {deadlineCompat.text}
                            </Badge>
                          )}
                          <div className="mt-2">
                            <CompatibilityDetail
                              label="Required deadline"
                              compat={deadlineCompat}
                            />
                          </div>
                          <p className="mt-2 text-[11px] text-text-tertiary">
                            {quote.validUntil
                              ? `Valid until ${quote.validUntil}`
                              : "Validity not specified"}
                          </p>
                        </Td>

                        <Td>
                          <p className="tabular text-sm text-text-primary">
                            {formatShipping(quote.shippingCost)}
                          </p>
                        </Td>

                        <Td>
                          <p className="text-sm text-text-primary">
                            {quote.paymentTerms || "Not specified"}
                          </p>
                          <p className="mt-1 font-ledger-mono text-[10px] uppercase tracking-[0.06em] text-text-tertiary">
                            {quote.paymentScore}/100 payment score
                          </p>
                        </Td>

                        <Td>
                          <p className="tabular font-ledger-mono text-lg font-semibold text-text-primary">
                            {quote.totalScore}
                            <span className="text-text-tertiary">/100</span>
                          </p>
                        </Td>

                        <Td>
                          <div className="flex flex-wrap gap-1.5">
                            {quote.quoteExpired && (
                              <Badge tone="danger">Expired</Badge>
                            )}
                            {riskReasons.map((reason: Reason, idx) => (
                              <Badge key={`${reason.label}-${idx}`} tone="warning">
                                {reason.label}
                              </Badge>
                            ))}
                            {!quote.quoteExpired && riskReasons.length === 0 && (
                              <span className="text-xs text-text-tertiary">
                                No flags
                              </span>
                            )}
                          </div>
                        </Td>

                        <Td>
                          {isAwarded ? (
                            <Badge tone="success">Awarded</Badge>
                          ) : isBest ? (
                            <Badge tone="accent">
                              {recommendation.caveat ? "Closest option" : "Recommended"}
                            </Badge>
                          ) : (
                            <span className="text-xs text-text-tertiary">—</span>
                          )}
                        </Td>

                        <Td>
                          {rfq.status !== "awarded" ? (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => award(quote.id)}
                              disabled={awarding === quote.id}
                            >
                              {awarding === quote.id ? "Awarding…" : "Award"}
                            </Button>
                          ) : isAwarded ? (
                            <span className="text-xs text-success">Awarded</span>
                          ) : (
                            <span className="text-xs text-text-tertiary">—</span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}

          {awardError && (
            <Notice tone="danger" className="mt-4">
              {awardError}
            </Notice>
          )}
        </div>

        {/* PURCHASE ORDER */}
        {rfq.purchaseOrder && (
          <Card tone="accent" padding="lg" className="mt-10">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="success" dot>
                Awarded
              </Badge>
              <span className="font-ledger-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
                Purchase order
              </span>
            </div>

            <h2 className="mt-3 font-ledger-serif text-2xl font-medium text-text-primary">
              {rfq.purchaseOrder.poNumber}
            </h2>

            <p className="mt-2 text-sm text-text-secondary">
              Purchase order created successfully. The award is now locked to{" "}
              {rfq.purchaseOrder.vendorName}.
            </p>

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
          </Card>
        )}
      </section>
    </main>
  );
}

function SpecField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-ledger-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
        {label}
      </p>

      <p className="mt-1 font-medium text-text-primary">{value || "Not specified"}</p>
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
      <p className="font-ledger-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
        {label}
      </p>

      <p className="mt-1 text-sm font-medium text-text-primary">
        {value}
      </p>

      {sub && <p className="text-xs text-text-tertiary">{sub}</p>}
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
      ? "text-success"
      : compat.tone === "bad"
        ? "text-danger"
        : "text-text-tertiary";

  return (
    <div>
      <p className="font-ledger-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
        {label}
      </p>

      <p className={`mt-1 text-sm font-medium ${toneClass}`}>
        {compat.text}
      </p>
    </div>
  );
}
