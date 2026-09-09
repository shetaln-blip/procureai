import type { Entity, TechnicalSpecEntity } from "./entities";
import type { ProcurementRequirement, ValidationWarning } from "./schema";

// Stage: validation. Runs after classification and reports anything that
// looks like the extraction went wrong — it never "fixes" a bad result
// silently, it just surfaces the problem so a caller (today: the
// warnings array returned alongside the structured requirement) can
// decide what to do with it.
export function validateRequirement(
  requirement: ProcurementRequirement,
  normalizedQuery: string,
  entities: Entity[]
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const productValue = requirement.product.value?.toLowerCase() ?? "";

  // 1. Quantity leaked into the product string.
  if (requirement.quantity.raw && productValue.includes(requirement.quantity.raw.toLowerCase())) {
    warnings.push({
      code: "quantity_in_product",
      field: "product",
      message: `The product text still contains the extracted quantity ("${requirement.quantity.raw}").`,
    });
  }

  // 2. A price was found but no currency could be resolved.
  if (requirement.price.amount !== null && !requirement.price.currency && !requirement.price.currencySymbol) {
    warnings.push({
      code: "price_missing_currency",
      field: "price",
      message: "A price amount was extracted but no currency symbol or code could be resolved.",
    });
  }

  // 2b. A currency symbol appears in the raw text but never made it into
  // the extracted price at all — the exact "currency symbol disappears"
  // failure mode this pipeline is meant to catch.
  if (/[₹$]/.test(normalizedQuery) && !requirement.price.currencySymbol) {
    warnings.push({
      code: "currency_symbol_lost",
      field: "price",
      message: "A currency symbol appears in the request text but was not captured in the extracted price.",
    });
  }

  // 3. An absolute deadline was detected but couldn't be resolved to a
  // real calendar date (ambiguous month/day format, unrecognized month).
  if (requirement.deliveryTimeframe.kind === "absolute" && !requirement.deliveryTimeframe.absoluteDate) {
    warnings.push({
      code: "incomplete_deadline",
      field: "deliveryTimeframe",
      message: `A delivery date was mentioned ("${requirement.deliveryTimeframe.raw}") but could not be resolved to a specific date.`,
    });
  }

  // 4. The product string still contains the extracted location.
  if (requirement.location.value && productValue.includes(requirement.location.value.toLowerCase())) {
    warnings.push({
      code: "location_in_product",
      field: "product",
      message: `The product text still contains the extracted location ("${requirement.location.value}").`,
    });
  }

  // 5. The same phrase appears in more than one specification bucket.
  const bucketed: [string, string[]][] = [
    ["construction", requirement.specifications.construction],
    ["qualityRequirements", requirement.specifications.qualityRequirements],
    ["sustainabilityRequirements", requirement.specifications.sustainabilityRequirements],
    ["certifications", requirement.specifications.certifications],
    ["requiredCapabilities", requirement.specifications.requiredCapabilities],
    ["customizationRequirements", requirement.specifications.customizationRequirements],
    ["packagingRequirements", requirement.specifications.packagingRequirements],
    ["shippingRequirements", requirement.specifications.shippingRequirements],
  ];

  const seenPhrases = new Map<string, string>();

  for (const [bucketName, values] of bucketed) {
    for (const value of values) {
      const key = value.toLowerCase();
      const existingBucket = seenPhrases.get(key);

      if (existingBucket && existingBucket !== bucketName) {
        warnings.push({
          code: "duplicate_specification",
          field: "specifications",
          message: `"${value}" appears in both "${existingBucket}" and "${bucketName}".`,
        });
      } else {
        seenPhrases.set(key, bucketName);
      }
    }
  }

  // 6. Defensive self-check: the accepted quantity's digits shouldn't
  // ever coincide with a technical-spec span (this would indicate the
  // priority-based overlap resolution in entities.ts let something
  // through it shouldn't have).
  if (requirement.quantity.raw) {
    const techSpecs = entities.filter(
      (entity): entity is TechnicalSpecEntity => entity.kind === "technical_spec"
    );

    for (const spec of techSpecs) {
      if (spec.raw.includes(requirement.quantity.raw)) {
        warnings.push({
          code: "quantity_matches_technical_spec",
          field: "quantity",
          message: `The extracted quantity ("${requirement.quantity.raw}") overlaps a technical specification ("${spec.raw}").`,
        });
      }
    }
  }

  // 7. Multiple quantity mentions — the schema only keeps one, so make
  // that choice visible rather than silently dropping the rest.
  const quantityEntities = entities.filter((entity) => entity.kind === "quantity");

  if (quantityEntities.length > 1) {
    warnings.push({
      code: "multiple_quantities_detected",
      field: "quantity",
      message: `${quantityEntities.length} quantity mentions were found in the request; only the first ("${requirement.quantity.raw}") was kept as the primary quantity.`,
    });
  }

  return warnings;
}
