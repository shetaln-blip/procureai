import type { MatchedSupplier } from "./matching";

// Evidence rendering — moved unchanged out of app/page.tsx (hackathon
// submission-readiness pass) so the new DecisionTrace component can
// reuse the exact same "what evidence backs this supplier" logic
// instead of a second, parallel implementation. No behavior changed
// here from the original app/page.tsx version.

// Human-readable labels for the dot-path field ids that
// lib/ingestion/normalize.ts records against each source (e.g.
// "identity.companyName"). Falls back to a readable version of the raw
// path for anything not listed here, so a future source citing a field
// this map doesn't know about still renders something sensible.
const EVIDENCE_FIELD_LABELS: Record<string, string> = {
  "identity.companyName": "Company name",
  "identity.legalName": "Legal name",
  "identity.website": "Website",
  "identity.contact.email": "Email",
  "identity.contact.phone": "Phone",
  "identity.location": "Location",
  "identity.citiesServed": "Cities served",
  "capabilities.categories": "Category",
  "capabilities.products": "Products",
  "capabilities.productDescription": "Product description",
  "capabilities.manufacturingStatus": "Manufacturing status",
  "capabilities.manufacturingCapabilities": "Manufacturing capabilities",
  "capabilities.customizationCapabilities": "Customization capabilities",
  "capabilities.industriesServed": "Industries served",
  "capabilities.capacity": "Capacity",
  "commercial.moq": "Minimum order quantity",
  "commercial.priceRange": "Pricing",
  "commercial.leadTime": "Lead time",
  "commercial.shippingRegions": "Shipping regions",
  "commercial.paymentTerms": "Payment terms",
  "compliance.certifications": "Certifications",
  "compliance.gstNumber": "GST registration",
  "compliance.isoCertifications": "ISO certifications",
};

export function evidenceFieldLabel(field: string): string {
  return (
    EVIDENCE_FIELD_LABELS[field] ||
    field
      .split(".")
      .pop()!
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (char) => char.toUpperCase())
  );
}

export type EvidenceItem = {
  fieldLabel: string;
  sourceName: string;
  sourceUrl: string;
  retrievedAt: string;
};

// Flattens a supplier's sources into one row per (field, source) pair —
// this is the data behind the evidence drawer/section wherever a
// supplier's evidence is shown (the supplier detail modal, the new
// Decision Trace panel). A supplier with no sources yields an empty
// array, which callers render as "No public evidence available" rather
// than inventing anything to fill the gap.
export function buildEvidenceItems(vendor: MatchedSupplier): EvidenceItem[] {
  return vendor.intelligence.sources.flatMap((source) =>
    source.fields.map((field) => ({
      fieldLabel: evidenceFieldLabel(field),
      sourceName: source.sourceName,
      sourceUrl: source.url,
      retrievedAt: source.retrievedAt,
    }))
  );
}

export function formatEvidenceDate(date: string): string {
  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) return "Unknown date";

  return parsed.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
