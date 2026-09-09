import type { ExtractionResult } from "./schema";

// The rest of ProcureAI — app/page.tsx, lib/matching.ts's SearchCriteria,
// lib/rfq-types.ts's Requirements, the RFQ/respond/RFQ-detail pages —
// already consumes one flat shape: { product, quantity, location, budget,
// deadline, quality, additionalRequirements } where every field is a
// plain string (additionalRequirements a string[]). Rewriting all of
// those call sites was explicitly out of scope for this change, so this
// is the single seam that projects the new, much richer
// ProcurementRequirement down into that legacy shape. The extraction
// pipeline itself (pipeline.ts, entities.ts, classify.ts) has no
// knowledge this adapter exists — it stays independent of matching/RFQ
// concerns, exactly as required.
export type LegacyRequirements = {
  product: string;
  quantity: string;
  location: string;
  budget: string;
  deadline: string;
  quality: string;
  additionalRequirements: string[];
};

function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatBudget(result: ExtractionResult): string {
  const { price } = result.requirement;

  if (price.amount === null) return "";

  const symbol = price.currencySymbol ?? (price.currency ? `${price.currency} ` : "");
  const perUnit = price.basis === "per_unit" ? " per unit" : "";

  if (price.type === "range" && price.amountMax !== null) {
    return `${symbol}${price.amount.toLocaleString("en-IN")}–${symbol}${price.amountMax.toLocaleString(
      "en-IN"
    )}${perUnit}`;
  }

  if (price.type === "maximum") {
    return `Under ${symbol}${price.amount.toLocaleString("en-IN")}${perUnit}`;
  }

  if (price.basis === "total_budget") {
    return `Budget: ${symbol}${price.amount.toLocaleString("en-IN")}`;
  }

  return `${symbol}${price.amount.toLocaleString("en-IN")}${perUnit}`;
}

function formatQuantity(result: ExtractionResult): string {
  const { quantity, unit } = result.requirement;

  if (quantity.value === null) return "";

  const amount = quantity.value.toLocaleString("en-IN");

  return unit.value ? `${amount} ${unit.value}` : amount;
}

export function toLegacyRequirements(result: ExtractionResult): LegacyRequirements {
  const { requirement } = result;
  const { specifications } = requirement;

  // Preserves the matching behavior lib/matching.ts already implements
  // (it looks for "eco"/"recyclable"/"biodegradable"/"custom" inside
  // `quality`) — sustainability and quality descriptors both feed it,
  // and customization terms are intentionally included too so the
  // existing "custom capabilities" match bonus keeps firing. This is the
  // one deliberate overlap with `additionalRequirements` below, kept for
  // backward compatibility with the unmodified matching layer.
  const quality = [
    ...specifications.sustainabilityRequirements,
    ...specifications.qualityRequirements,
    ...specifications.customizationRequirements,
  ].join(", ");

  const additionalRequirements = [
    ...specifications.customizationRequirements,
    ...specifications.packagingRequirements,
    ...specifications.shippingRequirements,
    ...specifications.requiredCapabilities,
    ...specifications.certifications,
  ];

  return {
    product: requirement.product.value ?? result.rawQuery,
    quantity: formatQuantity(result),
    location: requirement.location.value ?? "",
    budget: formatBudget(result),
    deadline: requirement.deliveryTimeframe.raw
      ? capitalize(requirement.deliveryTimeframe.raw)
      : "",
    quality,
    additionalRequirements,
  };
}
