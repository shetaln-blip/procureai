import { classifyEntities } from "./classify";
import { extractAllEntities } from "./entities";
import { normalizeQuery } from "./normalize";
import { deriveProductText } from "./product";
import { validateRequirement } from "./validate";
import type { ExtractionResult } from "./schema";

// The full pipeline, stage by stage:
//
//   raw request
//     -> normalize            (normalize.ts   — safe character cleanup only)
//     -> entity extraction    (entities.ts    — span-based, priority-resolved)
//     -> product derivation   (product.ts     — complement of claimed spans)
//     -> semantic classification (classify.ts — entities -> schema fields)
//     -> validation            (validate.ts   — flags suspicious results)
//
// This module has no knowledge of supplier matching or the RFQ system —
// see lib/extraction/legacy-adapter.ts for the one place that translates
// its output into the flat shape the rest of ProcureAI already consumes.
export function extractProcurementRequirement(
  rawQuery: string,
  referenceDate: Date = new Date()
): ExtractionResult {
  const normalized = normalizeQuery(rawQuery);
  const entities = extractAllEntities(normalized, referenceDate);
  const productText = deriveProductText(normalized, entities);
  const requirement = classifyEntities(entities, productText, normalized);
  const warnings = validateRequirement(requirement, normalized, entities);

  return { rawQuery: normalized, requirement, warnings };
}
