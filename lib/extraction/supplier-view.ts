import type {
  PriceType,
  PricingBasis,
  ProcurementRequirement,
  TimeRequirement,
} from "./schema";

// Projects the full ProcurementRequirement — which carries internal
// confidence levels and raw-source-text metadata on every field — down
// into the shape suppliers are actually shown on the response page
// (P0 #1 / P0 #2). This is the one deliberate seam between "what the
// buyer/ProcureAI knows about a requirement" and "what a supplier is
// shown": confidence metadata is never included here, by construction,
// rather than being hidden later in the UI layer.
export type SupplierFacingPrice = {
  amount: number | null;
  amountMax: number | null;
  currency: string | null;
  currencySymbol: string | null;
  basis: PricingBasis;
  type: PriceType;
};

export type SupplierFacingRequirement = {
  product: string | null;
  quantity: number | null;
  unit: string | null;
  location: string | null;
  deliveryTimeframe: string | null;
  price: SupplierFacingPrice | null;
  intendedUse: string | null;
  material: string | null;
  construction: string[];
  qualityRequirements: string[];
  sustainabilityRequirements: string[];
  certifications: string[];
  requiredCapabilities: string[];
  customizationRequirements: string[];
  packagingRequirements: string[];
  shippingRequirements: string[];
  paymentTerms: string | null;
  additionalConstraints: string[];
};

function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDeliveryTimeframe(timeframe: TimeRequirement): string | null {
  if (timeframe.raw) return capitalize(timeframe.raw);
  if (timeframe.absoluteDate) return timeframe.absoluteDate;
  if (timeframe.relativeDays !== null) {
    return `Within ${timeframe.relativeDays} day${
      timeframe.relativeDays === 1 ? "" : "s"
    }`;
  }
  return null;
}

export function toSupplierFacingRequirement(
  requirement: ProcurementRequirement
): SupplierFacingRequirement {
  const { specifications, price } = requirement;

  return {
    product: requirement.product.value,
    quantity: requirement.quantity.value,
    unit: requirement.unit.value,
    location: requirement.location.value,
    deliveryTimeframe: formatDeliveryTimeframe(requirement.deliveryTimeframe),
    price:
      price.amount !== null
        ? {
            amount: price.amount,
            amountMax: price.amountMax,
            currency: price.currency,
            currencySymbol: price.currencySymbol,
            basis: price.basis,
            type: price.type,
          }
        : null,
    intendedUse: requirement.intendedUse.value,
    material: specifications.material.value,
    construction: specifications.construction,
    qualityRequirements: specifications.qualityRequirements,
    sustainabilityRequirements: specifications.sustainabilityRequirements,
    certifications: specifications.certifications,
    requiredCapabilities: specifications.requiredCapabilities,
    customizationRequirements: specifications.customizationRequirements,
    packagingRequirements: specifications.packagingRequirements,
    shippingRequirements: specifications.shippingRequirements,
    paymentTerms: requirement.paymentTerms.value,
    additionalConstraints: requirement.additionalConstraints,
  };
}
