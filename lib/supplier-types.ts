// Rich supplier data model. Replaces the old flat `Vendor` type (see
// data/vendors.ts, now superseded by data/suppliers.json) with a structure
// that can carry real sourcing evidence, compliance data, and commercial
// terms as ProcureAI's supplier database grows from a handful of seed
// records toward a real, publicly-sourced catalog.
//
// Every supplier keeps a numeric `id` (not a UUID) specifically so RFQs
// created against `lib/rfq-types.ts` (which store `vendorId: number`) don't
// need to change. RFQs/Quotes store a *snapshot* of vendorId + vendorName
// at invite time rather than a live foreign key into this table, so this
// model can be edited, enriched, merged, or migrated to a real database
// later without invalidating any RFQ that already exists.

export type DataConfidence = "high" | "medium" | "low";

export type VerificationStatus = "unverified" | "pending" | "verified";

// Where a supplier record (or a specific field on it) came from. Keep this
// list in sync with whatever `lib/ingestion/normalize.ts` is taught to pull
// from next.
export type SourcingMethod =
  | "official_website"
  | "public_directory"
  | "industry_association"
  | "government_registry"
  | "other_public_source"
  // Records typed into the app before a real sourcing pipeline existed.
  // Anything with this method should be treated as low-confidence and
  // scheduled for replacement with a properly sourced record.
  | "internal_seed";

// One piece of evidence backing some subset of a supplier's fields. A
// supplier can (and eventually should) have more than one of these as it
// gets corroborated by multiple sources.
export type SupplierSource = {
  url: string;
  sourceName: string;
  sourceType: SourcingMethod;
  retrievedAt: string; // ISO date
  // Which top-level Supplier fields this particular source backs, e.g.
  // ["identity.website", "capabilities.categories"]. Lets the UI show
  // "where did this specific fact come from" instead of one vague badge.
  fields: string[];
  snippet?: string;
};

export type SupplierIdentity = {
  companyName: string;
  legalName: string | null;
  website: string | null;
  contact: {
    email: string | null;
    phone: string | null;
  };
  location: string; // primary city/HQ, e.g. "Bengaluru, Karnataka"
  citiesServed: string[];
};

export type ManufacturingStatus =
  | "manufacturer"
  | "distributor"
  | "trader"
  | "unknown";

export type SupplierCapabilities = {
  categories: string[]; // e.g. ["Corrugated packaging", "Industrial packaging"]
  products: string[];
  productDescription: string;
  manufacturingStatus: ManufacturingStatus;
  manufacturingCapabilities: string[];
  customizationCapabilities: string[];
  industriesServed: string[];
  capacity: string | null; // publicly stated capacity, when available
};

export type SupplierCommercial = {
  moq: string | null;
  priceRange: string | null;
  currency: string; // ISO currency code, e.g. "INR"
  leadTime: string | null;
  shippingRegions: string[];
  paymentTerms: string[];
  quoteAvailable: boolean;
};

export type SupplierCompliance = {
  certifications: string[];
  gstNumber: string | null;
  isoCertifications: string[];
  otherCertifications: string[];
  complianceDocuments: string[]; // URLs/evidence, when public
};

// Derived from real RFQ/quote/award history by
// lib/supplier-performance.ts — never hand-set, never persisted onto a
// supplier's own record (data/suppliers.json). Every rate/average field
// is null, not zero, when there isn't enough underlying data to compute
// it honestly; `completedOrders` and `onTimeDeliveryRate` are null
// permanently under the current schema, which has no confirmed actual-
// delivery event (only a promised delivery-by estimate) — see
// lib/supplier-performance.ts for why.
export type SupplierPerformance = {
  rfqsReceived: number;
  quotesSubmitted: number;
  ordersAwarded: number;
  quoteResponseRate: number | null; // quotesSubmitted / rfqsReceived
  winRate: number | null; // ordersAwarded / quotesSubmitted
  averageQuotedPrice: number | null; // mean unitPrice across submitted quotes
  completedOrders: number | null; // always null today — no completion event exists
  onTimeDeliveryRate: number | null; // always null today — no actual delivery date exists
  averageResponseHours: number | null;
};

export type SupplierIntelligence = {
  sources: SupplierSource[];
  lastUpdated: string; // ISO date
  // Computed, not hand-set — see computeDataConfidence() in
  // lib/ingestion/normalize.ts. Nothing should be marked "high" without
  // actual source backing.
  dataConfidence: DataConfidence;
  publicRating: number | null;
  reviewCount: number;
  // Filled in once ProcureAI has real transaction history for this
  // supplier (RFQs sent, quotes received, orders awarded).
  performance: SupplierPerformance | null;
};

export type Supplier = {
  id: number;
  identity: SupplierIdentity;
  capabilities: SupplierCapabilities;
  commercial: SupplierCommercial;
  compliance: SupplierCompliance;
  intelligence: SupplierIntelligence;
  sourcing: {
    method: SourcingMethod;
    // Deliberately separate from "publicly sourced" (which just means we
    // have evidence for the record). Verified means ProcureAI itself
    // checked this supplier's claims — nothing sets this to "verified"
    // today.
    verification: {
      status: VerificationStatus;
      verifiedAt: string | null;
    };
  };
  // Deduplication scaffolding — see lib/dedup.ts. `dedupeKey` is a
  // normalized company-name/domain key used to flag likely duplicates;
  // `mergedFrom` records which supplier ids (if any) were folded into this
  // one during a manual/assisted merge.
  dedupeKey: string;
  mergedFrom: number[];
};
