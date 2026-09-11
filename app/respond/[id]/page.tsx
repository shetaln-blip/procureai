"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import type { Quote } from "@/lib/rfq-types";
import type { SupplierFacingRequirement } from "@/lib/extraction/supplier-view";

const PAYMENT_TERMS_OPTIONS = [
  "On delivery",
  "Net 30",
  "Net 15",
  "25% advance",
  "50% advance",
  "100% advance",
];

const inputClass =
  "w-full rounded-md border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

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
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-400">
          Loading…
        </main>
      }
    >
      <RespondPage />
    </Suspense>
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
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-400">
        Loading…
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-50 px-6 text-center">
        <h1 className="font-display text-2xl font-semibold">
          This RFQ link isn&apos;t valid
        </h1>
        <p className="max-w-md text-sm text-zinc-500">
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
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <nav className="bg-zinc-950">
        <div className="mx-auto max-w-3xl px-8 py-5 font-display text-xl font-semibold tracking-tight text-white">
          Procure<span className="text-amber-500">AI</span>
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-8 py-14">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Request for quotation
        </div>

        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
          Quote request for {data.supplierName}
        </h1>

        <p className="mt-2 text-sm text-zinc-500">RFQ {data.rfqId}</p>

        <div className="mt-8 rounded-md border border-zinc-200 bg-white p-7">
          {sr ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <SpecField label="Product" value={sr.product ?? data.requirements.product} />
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
              <div className="grid gap-5 sm:grid-cols-2">
                <SpecField
                  label="Product"
                  value={data.requirements.product}
                />
                <SpecField
                  label="Quantity"
                  value={data.requirements.quantity}
                />
                <SpecField
                  label="Delivery location"
                  value={data.requirements.location}
                />
                <SpecField
                  label="Required by"
                  value={data.requirements.deadline}
                />
              </div>

              {specTags.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2 border-t border-zinc-100 pt-5">
                  {specTags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {submitted ? (
          <div className="mt-8 rounded-md border border-emerald-500 bg-white p-7 text-center">
            <h2 className="font-display text-xl font-semibold">
              Quote submitted ✓
            </h2>

            <p className="mt-2 text-sm text-zinc-500">
              The buyer can now see your quote and will compare it
              against other suppliers.
            </p>

            <button
              onClick={() => setSubmitted(false)}
              className="mt-5 rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950"
            >
              Edit my quote
            </button>
          </div>
        ) : (
          <div className="mt-8 rounded-md border border-zinc-200 bg-white p-7">
            <h2 className="font-display text-xl font-semibold">Your quote</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">
              Share the price and delivery terms you can commit to. Blank
              optional fields remain unspecified for the buyer to confirm.
            </p>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field label="Unit price (₹)" required>
                <input
                  type="number"
                  min="0"
                  value={form.unitPrice}
                  onChange={(e) =>
                    setForm({ ...form, unitPrice: e.target.value })
                  }
                  className={inputClass}
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
                <input
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
                  className={inputClass}
                />
              </Field>

              <Field
                label="Minimum order quantity"
                hint="Leave blank if you have no minimum."
              >
                <input
                  type="number"
                  min="0"
                  value={form.moq}
                  onChange={(e) =>
                    setForm({ ...form, moq: e.target.value })
                  }
                  className={inputClass}
                />
              </Field>

              <Field label="Lead time (days)" required>
                <input
                  type="number"
                  min="0"
                  value={form.leadTimeDays}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      leadTimeDays: e.target.value,
                    })
                  }
                  className={inputClass}
                />
              </Field>

              <Field
                label="Shipping cost (₹)"
                hint="Enter 0 for free shipping. Leave blank if you don't know yet."
              >
                <input
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
                  className={inputClass}
                />
              </Field>

              <Field
                label="GST / Tax (%)"
                hint="Enter 0 if no tax applies. Leave blank if you don't know yet."
              >
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 18"
                  value={form.taxPercent}
                  onChange={(e) =>
                    setForm({ ...form, taxPercent: e.target.value })
                  }
                  className={inputClass}
                />
              </Field>

              <Field label="Payment terms">
                <select
                  value={form.paymentTerms}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      paymentTerms: e.target.value,
                    })
                  }
                  className={inputClass}
                >
                  {PAYMENT_TERMS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Quote valid until">
                <input
                  type="date"
                  value={form.validUntil}
                  onChange={(e) =>
                    setForm({ ...form, validUntil: e.target.value })
                  }
                  className={inputClass}
                />
              </Field>

              <Field label="Notes (optional)">
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) =>
                    setForm({ ...form, notes: e.target.value })
                  }
                  className={inputClass}
                />
              </Field>
            </div>

            {error && (
              <p className="mt-4 text-sm text-red-600">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="mt-6 w-full rounded-full bg-amber-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit quote"}
            </button>
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

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {label} {required && <span className="text-amber-600">*</span>}
      </span>

      <div className="mt-1.5">{children}</div>

      {hint && (
        <span className="mt-1 block text-xs text-zinc-400">{hint}</span>
      )}
    </label>
  );
}
