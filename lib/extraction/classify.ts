import { extractMaterial } from "./entities";
import type {
  CertificationEntity,
  DateEntity,
  Entity,
  IntendedUseEntity,
  KeywordEntity,
  LocationEntity,
  PriceEntity,
  QuantityEntity,
  TechnicalSpecEntity,
} from "./entities";
import { formatProductLabel } from "./product";
import type { ExtractedField, PriceRequirement, ProcurementRequirement, TimeRequirement } from "./schema";

// Stage: semantic classification. Takes the flat, resolved entity list
// (already conflict-free — see entities.ts) and assembles it into the
// ProcurementRequirement shape, one field at a time. Nothing here does
// any string matching of its own; it only routes already-extracted
// entities into the right schema slot and fills in `null` where a kind
// of entity simply wasn't found in the request.
function isKind<K extends Entity["kind"]>(
  entity: Entity,
  kind: K
): entity is Extract<Entity, { kind: K }> {
  return entity.kind === kind;
}

function firstOf<K extends Entity["kind"]>(
  entities: Entity[],
  kind: K
): Extract<Entity, { kind: K }> | undefined {
  return entities.find((entity): entity is Extract<Entity, { kind: K }> =>
    isKind(entity, kind)
  );
}

function allOf<K extends Entity["kind"]>(
  entities: Entity[],
  kind: K
): Extract<Entity, { kind: K }>[] {
  return entities.filter((entity): entity is Extract<Entity, { kind: K }> =>
    isKind(entity, kind)
  );
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}

const nullField = <T>(): ExtractedField<T> => ({
  value: null,
  confidence: "low",
  raw: null,
});

export function classifyEntities(
  entities: Entity[],
  productText: string,
  rawQuery: string
): ProcurementRequirement {
  const quantityEntity = firstOf(entities, "quantity") as QuantityEntity | undefined;
  const priceEntity = firstOf(entities, "price") as PriceEntity | undefined;
  const dateEntity = firstOf(entities, "date") as DateEntity | undefined;
  const locationEntity = firstOf(entities, "location") as LocationEntity | undefined;
  const intendedUseEntity = firstOf(entities, "intended_use") as
    | IntendedUseEntity
    | undefined;

  const certEntities = allOf(entities, "certification") as CertificationEntity[];
  const techSpecEntities = allOf(entities, "technical_spec") as TechnicalSpecEntity[];
  const qualityEntities = allOf(entities, "quality") as KeywordEntity[];
  const pricingEntities = allOf(entities, "pricing") as KeywordEntity[];
  const sustainabilityEntities = allOf(entities, "sustainability") as KeywordEntity[];
  const customizationEntities = allOf(entities, "customization") as KeywordEntity[];
  const packagingEntities = allOf(entities, "packaging") as KeywordEntity[];
  const shippingEntities = allOf(entities, "shipping") as KeywordEntity[];
  const capabilityEntities = allOf(entities, "capability") as KeywordEntity[];
  const paymentEntities = allOf(entities, "payment_terms") as KeywordEntity[];

  const material = extractMaterial(rawQuery);

  const product: ExtractedField<string> = productText
    ? { value: formatProductLabel(productText), confidence: "high", raw: productText }
    : nullField<string>();

  const quantity: ExtractedField<number> = quantityEntity
    ? {
        value: quantityEntity.amount,
        confidence: quantityEntity.confidence,
        raw: quantityEntity.raw,
      }
    : nullField<number>();

  const unit: ExtractedField<string> =
    quantityEntity && quantityEntity.unit
      ? {
          value: quantityEntity.unit,
          confidence: quantityEntity.confidence,
          raw: quantityEntity.unit,
        }
      : nullField<string>();

  const location: ExtractedField<string> = locationEntity
    ? {
        value: locationEntity.value,
        confidence: locationEntity.confidence,
        raw: locationEntity.raw,
      }
    : nullField<string>();

  const price: PriceRequirement = priceEntity
    ? {
        amount: priceEntity.amount,
        amountMax: priceEntity.amountMax,
        currency: priceEntity.currency,
        currencySymbol: priceEntity.currencySymbol,
        basis: priceEntity.basis,
        type: priceEntity.type,
        confidence: priceEntity.confidence,
        raw: priceEntity.raw,
      }
    : {
        amount: null,
        amountMax: null,
        currency: null,
        currencySymbol: null,
        basis: null,
        type: null,
        confidence: "low",
        raw: null,
      };

  const deliveryTimeframe: TimeRequirement = dateEntity
    ? {
        kind: dateEntity.timeframeKind,
        raw: dateEntity.raw,
        relativeDays: dateEntity.relativeDays,
        absoluteDate: dateEntity.absoluteDate,
        confidence: dateEntity.confidence,
      }
    : { kind: null, raw: null, relativeDays: null, absoluteDate: null, confidence: "low" };

  const explicitUrgency = dateEntity?.timeframeKind === "urgent";
  const tightDeadline =
    deliveryTimeframe.relativeDays !== null && deliveryTimeframe.relativeDays <= 3;

  const urgency: ExtractedField<"urgent" | "standard"> = explicitUrgency
    ? { value: "urgent", confidence: "high", raw: dateEntity!.raw }
    : tightDeadline
    ? { value: "urgent", confidence: "low", raw: deliveryTimeframe.raw }
    : nullField<"urgent" | "standard">();

  const paymentTerms: ExtractedField<string> = paymentEntities[0]
    ? { value: paymentEntities[0].value, confidence: "high", raw: paymentEntities[0].raw }
    : nullField<string>();

  const intendedUse: ExtractedField<string> = intendedUseEntity
    ? {
        value: intendedUseEntity.value,
        confidence: intendedUseEntity.confidence,
        raw: intendedUseEntity.raw,
      }
    : nullField<string>();

  return {
    product,
    quantity,
    unit,
    location,
    deliveryTimeframe,
    price,
    intendedUse,
    specifications: {
      material: material
        ? { value: material.value, confidence: "high", raw: material.raw }
        : nullField<string>(),
      construction: dedupe(techSpecEntities.map((e) => e.value)),
      qualityRequirements: dedupe(qualityEntities.map((e) => e.value)),
      pricingPreferences: dedupe(pricingEntities.map((e) => e.value)),
      sustainabilityRequirements: dedupe(sustainabilityEntities.map((e) => e.value)),
      certifications: dedupe(certEntities.map((e) => e.value)),
      requiredCapabilities: dedupe(capabilityEntities.map((e) => e.value)),
      customizationRequirements: dedupe(customizationEntities.map((e) => e.value)),
      packagingRequirements: dedupe(packagingEntities.map((e) => e.value)),
      shippingRequirements: dedupe(shippingEntities.map((e) => e.value)),
    },
    paymentTerms,
    urgency,
    // Deliberately left empty rather than approximated by a generic
    // catch-all pattern — see the "remaining limitations" note in the
    // extraction README/report. Populating this reliably needs more
    // than regex; forcing something here risked exactly the kind of
    // invented requirement this pipeline is designed to avoid.
    additionalConstraints: [],
  };
}
