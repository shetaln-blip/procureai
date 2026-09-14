"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { Quote } from "@/lib/rfq-types";
import type { SupplierFacingRequirement } from "@/lib/extraction/supplier-view";
import { Badge, Button, Card, Notice, PageHeader } from "@/components/ui";
import { Field, Select, TextInput } from "@/components/ui/Input";

const PAYMENT_TERMS_OPTIONS = [
  "On delivery",
  "Net 30",
  "Net 15",
  "25% advance",
  "50% advance",
  "100% advance",
];

type RespondData = {
  rfqId: string;
  status: string;
  supplierName: string;
  requirements: {
    product: string;
    quantity: string;
    location: string;
    budget: string;
    deadline: string;
    quality: string;
    additionalRequirements: string[];
  };
  structuredRequirement: SupplierFacingRequirement | null;
  existingQuote: Quote | null;
};

export default function RespondPageWrapper() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <RespondPage />
    </Suspense>
  );
}

/** Full-screen loading state — shared by the Suspense fallback above and
 *  the in-flight fetch below, which were previously two verbatim copies
 *  of the same markup. */
function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg font-ledger-mono text-sm text-text-secondary">
      Loading…
    </main>
  );
}

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

function RespondPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const vendorParam = searchParams.get("vendor");
  const queryString = token
    ? `token=${encodeURIComponent(token)}`
    : vendorParam
      ? `vendor=${encodeURIComponent(vendorParam)}`
      : "";

  const [data, setData] = useState<RespondData | null>(null);
  // Seeded from whether we have anything to fetch at mount time, rather
  // than always starting true and flipping it inside the effect — an
  // effect that has nothing to fetch should not need to synchronously
  // setState just to say so.
  const [loading, setLoading] = useState(() => !!queryString);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    unitPrice: "",
    quotedQuantity: "",
    moq: "",
    leadTimeDays: "",
    shippingCost: "",
    // Left blank by default rather than defaulting to a guessed rate —
    // "not specified" and "0%" must stay distinguishable end-to-end
    // (Quote Intelligence Audit; see lib/quote-cost.ts).
    taxPercent: "",
    paymentTerms: PAYMENT_TERMS_OPTIONS[0],
    validUntil: "",
    notes: "",
  });

  useEffect(() => {
    if (!queryString) return;

    fetch(`/api/rfqs/${params.id}/respond?${queryString}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((responseData: RespondData) => {
        setData(responseData);

        const existing = responseData.existingQuote;

        if (existing) {
          // `null` means the supplier left it blank last time — show an
          // empty field again, never the literal text "null".
          setForm({
            unitPrice: String(existing.unitPrice),
            quotedQuantity: String(existing.quotedQuantity),
            moq: existing.moq === null ? "" : String(existing.moq),
            leadTimeDays: String(existing.leadTimeDays),
            shippingCost:
              existing.shippingCost === null ? "" : String(existing.shippingCost),
            taxPercent:
              existing.taxPercent === null ? "" : String(existing.taxPercent),
            paymentTerms: existing.paymentTerms,
            validUntil: existing.validUntil,
            notes: existing.notes,
          });
          setSubmitted(true);
        }
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [params.id, queryString]);

  const handleSubmit = async () => {
    setError("");

    if (!form.unitPrice || !form.leadTimeDays) {
      setError("Unit price and lead time are required.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(
        `/api/rfqs/${params.id}/respond?${queryString}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            unitPrice: Number(form.unitPrice),
            quotedQuantity: Number(form.quotedQuantity) || 0,
            // Blank stays blank (null) all the way to storage — never
            // coerced to 0, which would silently claim "no minimum" /
            // "free shipping" / "0% tax" the supplier never stated. The
            // API applies the same blank-to-null parsing on its side
            // (parseOptionalNumber) regardless of what's sent here.
            moq: form.moq.trim() === "" ? null : Number(form.moq),
            leadTimeDays: Number(form.leadTimeDays),
            shippingCost:
              form.shippingCost.trim() === "" ? null : Number(form.shippingCost),
            taxPercent:
              form.taxPercent.trim() === "" ? null : Number(form.taxPercent),
            paymentTerms: form.paymentTerms,
            validUntil: form.validUntil,
            notes: form.notes,
          }),
        }
      );

      const responseBody = await res.json();

      if (!res.ok) {
        throw new Error(responseBody.error || "Failed to submit quote.");
      }

      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to submit quote."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  if (!data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <h1 className="font-ledger-serif text-2xl font-medium text-text-primary">
          This RFQ link isn&apos;t valid
        </h1>
        <p className="max-w-md text-sm text-text-secondary">
          Double check the link the buyer shared with you, or ask
          them to resend it.
        </p>
      </main>
    );
  }

  const sr = data.structuredRequirement;
  const specTags = data.requirements.quality
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .concat(data.requirements.additionalRequirements);

  return (
    <main className="min-h-screen bg-bg text-text-primary">
      <nav className="border-b border-border bg-bg">
        <div className="mx-auto max-w-3xl px-8 py-5 font-ledger-serif text-xl font-medium tracking-tight text-text-primary">
          Procure<span className="text-accent">AI</span>
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-8 py-14">
        <PageHeader
          eyebrow="Request for quotation"
          title={`Quote request for ${data.supplierName}`}
          description={`RFQ ${data.rfqId}`}
        />

        <Card padding="lg" className="mt-8">
          {sr ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <SpecValueField label="Product" value={sr.product ?? data.requirements.product} />
              <SpecValueField
                label="Quantity"
                value={sr.quantity !== null ? sr.quantity.toLocaleString("en-IN") : ""}
              />
              <SpecValueField label="Unit" value={sr.unit ?? ""} />
              <SpecValueField label="Intended use" value={sr.intendedUse ?? ""} />
              <SpecValueField label="Delivery location" value={sr.location ?? ""} />
              <SpecValueField label="Deadline" value={sr.deliveryTimeframe ?? ""} />
              <SpecValueField label="Budget / price basis" value={formatPrice(sr.price)} />
              <SpecValueField label="Material" value={sr.material ?? ""} />
              <SpecValueField label="Construction" value={joinList(sr.construction)} />
              <SpecValueField label="Quality requirements" value={joinList(sr.qualityRequirements)} />
              <SpecValueField label="Pricing preference" value={joinList(sr.pricingPreferences)} />
              <SpecValueField
                label="Sustainability requirements"
                value={joinList(sr.sustainabilityRequirements)}
              />
              <SpecValueField label="Certifications" value={joinList(sr.certifications)} />
              <SpecValueField
                label="Required capabilities"
                value={joinList(sr.requiredCapabilities)}
              />
              <SpecValueField
                label="Customization"
                value={joinList(sr.customizationRequirements)}
              />
              <SpecValueField
                label="Packaging requirements"
                value={joinList(sr.packagingRequirements)}
              />
              <SpecValueField
                label="Shipping requirements"
                value={joinList(sr.shippingRequirements)}
              />
              <SpecValueField label="Payment terms" value={sr.paymentTerms ?? ""} />
              <SpecValueField
                label="Additional constraints"
                value={joinList(sr.additionalConstraints)}
              />
            </div>
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <SpecValueField
                  label="Product"
                  value={data.requirements.product}
                />
                <SpecValueField
                  label="Quantity"
                  value={data.requirements.quantity}
                />
                <SpecValueField
                  label="Delivery location"
                  value={data.requirements.location}
                />
                <SpecValueField
                  label="Required by"
                  value={data.requirements.deadline}
                />
              </div>

              {specTags.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-5">
                  {specTags.map((tag) => (
                    <Badge key={tag} tone="neutral">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>

        {submitted ? (
          <Card padding="lg" tone="accent" className="mt-8 text-center">
            <Badge tone="success">Quote submitted</Badge>

            <p className="mt-4 text-sm text-text-secondary">
              The buyer can now see your quote and will compare it
              against other suppliers.
            </p>

            <Button
              variant="secondary"
              onClick={() => setSubmitted(false)}
              className="mt-5"
            >
              Edit my quote
            </Button>
          </Card>
        ) : (
          <Card padding="lg" className="mt-8">
            <h2 className="font-ledger-serif text-xl font-medium text-text-primary">
              Your quote
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-text-secondary">
              Share the price and delivery terms you can commit to. Blank
              optional fields remain unspecified for the buyer to confirm.
            </p>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field label="Unit price (₹)" required>
                <TextInput
                  type="number"
                  min="0"
                  value={form.unitPrice}
                  onChange={(e) =>
                    setForm({ ...form, unitPrice: e.target.value })
                  }
                />
              </Field>

              <Field
                label="Quoted quantity"
                hint={
                  data.requirements.quantity
                    ? `Buyer requested: ${data.requirements.quantity}`
                    : undefined
                }
              >
                <TextInput
                  type="number"
                  min="0"
                  placeholder={data.requirements.quantity || undefined}
                  value={form.quotedQuantity}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      quotedQuantity: e.target.value,
                    })
                  }
                />
              </Field>

              <Field
                label="Minimum order quantity"
                hint="Leave blank if you have no minimum."
              >
                <TextInput
                  type="number"
                  min="0"
                  value={form.moq}
                  onChange={(e) =>
                    setForm({ ...form, moq: e.target.value })
                  }
                />
              </Field>

              <Field label="Lead time (days)" required>
                <TextInput
                  type="number"
                  min="0"
                  value={form.leadTimeDays}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      leadTimeDays: e.target.value,
                    })
                  }
                />
              </Field>

              <Field
                label="Shipping cost (₹)"
                hint="Enter 0 for free shipping. Leave blank if you don't know yet."
              >
                <TextInput
                  type="number"
                  min="0"
                  placeholder="e.g. 0 for free shipping"
                  value={form.shippingCost}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      shippingCost: e.target.value,
                    })
                  }
                />
              </Field>

              <Field
                label="GST / Tax (%)"
                hint="Enter 0 if no tax applies. Leave blank if you don't know yet."
              >
                <TextInput
                  type="number"
                  min="0"
                  placeholder="e.g. 18"
                  value={form.taxPercent}
                  onChange={(e) =>
                    setForm({ ...form, taxPercent: e.target.value })
                  }
                />
              </Field>

              <Field label="Payment terms">
                <Select
                  value={form.paymentTerms}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      paymentTerms: e.target.value,
                    })
                  }
                >
                  {PAYMENT_TERMS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Quote valid until">
                <TextInput
                  type="date"
                  value={form.validUntil}
                  onChange={(e) =>
                    setForm({ ...form, validUntil: e.target.value })
                  }
                />
              </Field>

              <Field label="Notes (optional)">
                <TextInput
                  type="text"
                  value={form.notes}
                  onChange={(e) =>
                    setForm({ ...form, notes: e.target.value })
                  }
                />
              </Field>
            </div>

            {error && (
              <Notice tone="danger" className="mt-4">
                {error}
              </Notice>
            )}

            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={submitting}
              className="mt-6 w-full"
            >
              {submitting ? "Submitting…" : "Submit quote"}
            </Button>
          </Card>
        )}
      </section>
    </main>
  );
}

function SpecValueField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-ledger-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
        {label}
      </p>

      <p className="mt-1 font-medium text-text-primary">{value || "Not specified"}</p>
    </div>
  );
}
