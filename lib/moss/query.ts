import type { ProcurementRequirement } from "../extraction/schema";
import type { SearchCriteria } from "../matching";
import {
  DEFAULT_MOSS_ALPHA,
  DEFAULT_MOSS_TOP_K,
  type MossQuerySpec,
} from "./types";

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";

    if (!trimmed) continue;

    const key = trimmed.toLowerCase();

    if (seen.has(key)) continue;

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

export function buildMossQueryFromRequirement(
  requirement: ProcurementRequirement
): string {
  const specs = requirement.specifications;

  return uniqueNonEmpty([
    requirement.product.value,
    specs.material.value,
    ...specs.construction,
    ...specs.requiredCapabilities,
    requirement.intendedUse.value,
    ...specs.qualityRequirements,
    ...specs.customizationRequirements,
    ...specs.sustainabilityRequirements,
    ...specs.packagingRequirements,
    ...specs.shippingRequirements,
    ...specs.certifications,
    requirement.location.value,
  ]).join(" ");
}

export function buildMossQueryFromCriteria(criteria: SearchCriteria): string {
  if (criteria.structured) {
    return buildMossQueryFromRequirement(criteria.structured);
  }

  return uniqueNonEmpty([
    criteria.product,
    criteria.quality,
    ...criteria.additionalRequirements,
  ]).join(" ");
}

export function buildMossQuerySpec(criteria: SearchCriteria): MossQuerySpec {
  return {
    text: buildMossQueryFromCriteria(criteria),
    topK: DEFAULT_MOSS_TOP_K,
    alpha: DEFAULT_MOSS_ALPHA,
  };
}
