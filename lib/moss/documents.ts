import type { DocumentInfo } from "@moss-js/moss";
import { parseLocationString } from "../location";
import type { Supplier } from "../supplier-types";
import { documentIdForSupplier } from "./types";

const FORBIDDEN_INDEX_KEYS = [
  "tokenHash",
  "tokenIssuedAt",
  "invitationToken",
  "token",
  "dedupeKey",
  "mergedFrom",
] as const;

function joinUnique(values: Array<string | null | undefined>): string {
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join("\n");
}

function metadataValue(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function supplierToMossDocument(supplier: Supplier): DocumentInfo {
  const location = parseLocationString(supplier.identity.location);
  const sources = supplier.intelligence.sources ?? [];

  const sourceLines = sources.flatMap((source) => [
    source.sourceName,
    source.url,
    source.retrievedAt,
    source.snippet ?? "",
    source.fields.join(", "),
  ]);

  const text = joinUnique([
    supplier.identity.companyName,
    supplier.identity.legalName,
    supplier.identity.website,
    supplier.identity.location,
    ...supplier.identity.citiesServed,
    ...supplier.commercial.shippingRegions,
    ...supplier.capabilities.categories,
    ...supplier.capabilities.products,
    supplier.capabilities.productDescription,
    supplier.capabilities.manufacturingStatus !== "unknown"
      ? supplier.capabilities.manufacturingStatus
      : "",
    ...supplier.capabilities.manufacturingCapabilities,
    ...supplier.capabilities.customizationCapabilities,
    ...supplier.capabilities.industriesServed,
    supplier.capabilities.capacity,
    ...supplier.compliance.certifications,
    ...supplier.compliance.isoCertifications,
    ...supplier.compliance.otherCertifications,
    supplier.commercial.moq ? `MOQ ${supplier.commercial.moq}` : "",
    supplier.commercial.leadTime
      ? `Lead time ${supplier.commercial.leadTime}`
      : "",
    supplier.commercial.priceRange
      ? `Price ${supplier.commercial.priceRange}`
      : "",
    ...sourceLines,
  ]);

  return {
    id: documentIdForSupplier(supplier.id),
    text,
    metadata: {
      supplierId: String(supplier.id),
      companyName: metadataValue(supplier.identity.companyName),
      location: metadataValue(supplier.identity.location),
      city: location.city ?? "",
      state: location.state ?? "",
      categories: supplier.capabilities.categories.join(", "),
      dataConfidence: supplier.intelligence.dataConfidence,
      verificationStatus: supplier.sourcing.verification.status,
      lastUpdated: supplier.intelligence.lastUpdated,
      hasPublicPricing: supplier.commercial.priceRange ? "true" : "false",
      hasLeadTime: supplier.commercial.leadTime ? "true" : "false",
      sourceCount: String(sources.length),
    },
  };
}

export function mossDocumentsFromSuppliers(suppliers: Supplier[]): DocumentInfo[] {
  const seen = new Set<string>();
  const documents: DocumentInfo[] = [];

  for (const supplier of suppliers) {
    const document = supplierToMossDocument(supplier);

    if (seen.has(document.id)) continue;

    seen.add(document.id);
    documents.push(document);
  }

  return documents;
}

export function findForbiddenIndexContent(value: unknown): string[] {
  const hits: string[] = [];
  const seen = new Set<string>();

  function walk(node: unknown, path: string) {
    if (node == null) return;

    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }

    if (typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        const nextPath = path ? `${path}.${key}` : key;

        if (
          FORBIDDEN_INDEX_KEYS.includes(
            key as (typeof FORBIDDEN_INDEX_KEYS)[number]
          )
        ) {
          const hit = `${nextPath}`;

          if (!seen.has(hit)) {
            seen.add(hit);
            hits.push(hit);
          }
        }

        walk(child, nextPath);
      }
    }
  }

  walk(value, "");

  return hits;
}
