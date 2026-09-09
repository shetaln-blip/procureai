// Structured requirement schema for the procurement-request extraction
// pipeline (lib/extraction/*). This is intentionally independent from
// lib/rfq-types.ts and lib/matching.ts — the extraction layer's job ends
// at producing this object; app/api/analyze/route.ts is responsible for
// projecting it down into the flat `Requirements` shape the rest of the
// app (supplier matching, RFQ creation, saved requests) already expects.
// See lib/extraction/legacy-adapter.ts for that projection.

export type ConfidenceLevel = "high" | "medium" | "low";

// A single extracted fact. `confidence` is only meaningful when `value`
// is non-null — a null value means the pipeline found no evidence for
// this field and is intentionally not guessing (see the project's
// standing rule: missing information stays missing, never invented).
// `raw` is the literal source text the value was derived from, kept for
// traceability/debugging and for the validators in validate.ts.
export type ExtractedField<T> = {
  value: T | null;
  confidence: ConfidenceLevel;
  raw: string | null;
};

export type PricingBasis = "per_unit" | "total_budget" | null;
export type PriceType = "maximum" | "target" | "range" | null;

export type PriceRequirement = {
  amount: number | null;
  // Set only when the request expresses a range ("₹8–₹14 per unit").
  amountMax: number | null;
  currency: string | null; // ISO-ish code, e.g. "INR", "USD"
  currencySymbol: string | null; // e.g. "₹", "$"
  basis: PricingBasis;
  type: PriceType;
  confidence: ConfidenceLevel;
  raw: string | null;
};

export type TimeframeKind = "relative" | "absolute" | "urgent" | null;

export type TimeRequirement = {
  kind: TimeframeKind;
  raw: string | null;
  // Populated when kind === "relative": how many days from now.
  relativeDays: number | null;
  // Populated when kind === "absolute" and the date could be resolved.
  absoluteDate: string | null; // ISO date (YYYY-MM-DD)
  confidence: ConfidenceLevel;
};

export type ProcurementSpecifications = {
  material: ExtractedField<string>;
  // Construction/build descriptors like "5-ply", "3-layer", "10-inch".
  construction: string[];
  qualityRequirements: string[];
  sustainabilityRequirements: string[];
  certifications: string[];
  requiredCapabilities: string[];
  customizationRequirements: string[];
  packagingRequirements: string[];
  shippingRequirements: string[];
};

export type ProcurementRequirement = {
  product: ExtractedField<string>;
  quantity: ExtractedField<number>;
  unit: ExtractedField<string>;
  location: ExtractedField<string>;
  deliveryTimeframe: TimeRequirement;
  price: PriceRequirement;
  specifications: ProcurementSpecifications;
  paymentTerms: ExtractedField<string>;
  urgency: ExtractedField<"urgent" | "standard">;
  // What the buyer is actually going to DO with the product — "a new
  // office", "shipping cosmetics", "our manufacturing unit" — extracted
  // from an explicit "for <phrase>" clause (see entities.ts's
  // extractIntendedUse). Kept separate from `product` and from
  // `additionalConstraints` because it answers a different question
  // ("why do they need it") that both the dashboard brief and supplier
  // matching (lib/matching.ts) treat as its own signal. Null — never a
  // guessed default — when no such clause is present.
  intendedUse: ExtractedField<string>;
  // Anything explicitly stated that doesn't fit a more specific field —
  // never a place to stash a guess.
  additionalConstraints: string[];
};

export type ValidationWarning = {
  code: string;
  message: string;
  field?: string;
};

export type ExtractionResult = {
  rawQuery: string;
  requirement: ProcurementRequirement;
  warnings: ValidationWarning[];
};

// A claimed character span in the ORIGINAL (normalized) query string.
// Every entity matcher in entities.ts produces these; the product
// deriver in product.ts computes the complement of every claimed span
// in one pass rather than repeatedly mutating a string, which is the
// core fix for the old parser's corruption/duplication problems.
export type EntitySpan = {
  start: number;
  end: number;
  kind: string;
  priority: number; // lower number = claimed first when spans overlap
  raw: string;
};
