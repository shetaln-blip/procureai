import type {
  DataConfidence,
  ManufacturingStatus,
  SourcingMethod,
  Supplier,
  SupplierSource,
} from "../supplier-types";
import { computeDedupeKey } from "../dedup";

// The shape any future ingestion job (a directory scrape, an industry
// association member list, a registry export, a manually curated CSV)
// should produce before handing records to normalizeSupplierRecord().
// Intentionally loose — most fields are optional, because public sources
// rarely offer everything at once. normalizeSupplierRecord() fills the
// gaps with honest nulls/empty values instead of guessing, per the rule
// that missing information stays missing rather than becoming a guess.
export type RawSupplierRecord = {
  companyName: string;
  legalName?: string;
  website?: string;
  email?: string;
  phone?: string;
  location?: string;
  citiesServed?: string[];
  categories?: string[];
  products?: string[];
  productDescription?: string;
  manufacturingStatus?: ManufacturingStatus;
  manufacturingCapabilities?: string[];
  customizationCapabilities?: string[];
  industriesServed?: string[];
  capacity?: string;
  moq?: string;
  priceRange?: string;
  currency?: string;
  leadTime?: string;
  shippingRegions?: string[];
  paymentTerms?: string[];
  certifications?: string[];
  gstNumber?: string;
  isoCertifications?: string[];
  // Every raw record must name where it came from. This is the one
  // non-optional evidence requirement — a record with no source shouldn't
  // enter the catalog through this path at all.
  source: {
    url: string;
    sourceName: string;
    sourceType: SourcingMethod;
    fields: string[];
    snippet?: string;
  };
};

// Confidence is computed from the evidence actually present, never
// hand-set. A record backed by one thin source starts "low"; it only
// reaches "high" once multiple sources corroborate a broad set of fields.
export function computeDataConfidence(
  sources: SupplierSource[]
): DataConfidence {
  if (sources.length === 0) return "low";

  const coveredFields = new Set(sources.flatMap((source) => source.fields))
    .size;

  if (sources.length >= 2 && coveredFields >= 8) return "high";
  if (coveredFields >= 4) return "medium";

  return "low";
}

// Turns one raw, source-attributed record into a full Supplier record.
// `existingIds` should be every id already in the target repository, so
// the new record gets a fresh numeric id (RFQs reference suppliers by
// numeric vendorId — see lib/rfq-types.ts — so ids can't be UUIDs without
// a wider migration).
export function normalizeSupplierRecord(
  raw: RawSupplierRecord,
  existingIds: number[]
): Supplier {
  const id = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;

  const source: SupplierSource = {
    url: raw.source.url,
    sourceName: raw.source.sourceName,
    sourceType: raw.source.sourceType,
    retrievedAt: new Date().toISOString(),
    fields: raw.source.fields,
    snippet: raw.source.snippet,
  };

  const supplier: Supplier = {
    id,
    identity: {
      companyName: raw.companyName,
      legalName: raw.legalName ?? null,
      website: raw.website ?? null,
      contact: {
        email: raw.email ?? null,
        phone: raw.phone ?? null,
      },
      location: raw.location ?? "",
      citiesServed: raw.citiesServed ?? [],
    },
    capabilities: {
      categories: raw.categories ?? [],
      products: raw.products ?? [],
      productDescription: raw.productDescription ?? "",
      manufacturingStatus: raw.manufacturingStatus ?? "unknown",
      manufacturingCapabilities: raw.manufacturingCapabilities ?? [],
      customizationCapabilities: raw.customizationCapabilities ?? [],
      industriesServed: raw.industriesServed ?? [],
      capacity: raw.capacity ?? null,
    },
    commercial: {
      moq: raw.moq ?? null,
      priceRange: raw.priceRange ?? null,
      currency: raw.currency ?? "INR",
      leadTime: raw.leadTime ?? null,
      shippingRegions: raw.shippingRegions ?? [],
      paymentTerms: raw.paymentTerms ?? [],
      quoteAvailable: true,
    },
    compliance: {
      certifications: raw.certifications ?? [],
      gstNumber: raw.gstNumber ?? null,
      isoCertifications: raw.isoCertifications ?? [],
      otherCertifications: [],
      complianceDocuments: [],
    },
    intelligence: {
      sources: [source],
      lastUpdated: new Date().toISOString(),
      dataConfidence: computeDataConfidence([source]),
      publicRating: null,
      reviewCount: 0,
      performance: null,
    },
    sourcing: {
      method: raw.source.sourceType,
      verification: { status: "unverified", verifiedAt: null },
    },
    dedupeKey: "",
    mergedFrom: [],
  };

  supplier.dedupeKey = computeDedupeKey(supplier);

  return supplier;
}
