// Regression tests for the second product change: India-wide supplier
// search (graduated location ranking, lib/location.ts + lib/matching.ts)
// and richer procurement-intent extraction/display (intended use,
// dashboard brief). No RFQ/quote logic is touched by anything here.
//
// Run with: npx tsx scripts/test-location-and-brief.ts
import { matchSuppliers, type SearchCriteria } from "../lib/matching";
import { compareLocations, DEFAULT_SEARCH_REGION } from "../lib/location";
import { extractProcurementRequirement } from "../lib/extraction/pipeline";
import { buildProcurementBrief, buildSpecificationsSummary, type Requirements } from "../app/page";
import type { Supplier } from "../lib/supplier-types";

let failures = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.log(`  FAIL: ${label}`);
    failures++;
  }
}

let nextId = 1;

function makeSupplier(overrides: {
  location: string;
  citiesServed?: string[];
  categories?: string[];
  products?: string[];
  productDescription?: string;
}): Supplier {
  const id = nextId++;

  return {
    id,
    identity: {
      companyName: `Test Supplier ${id}`,
      legalName: null,
      website: null,
      contact: { email: null, phone: null },
      location: overrides.location,
      citiesServed: overrides.citiesServed ?? [],
    },
    capabilities: {
      categories: overrides.categories ?? ["Packaging"],
      products: overrides.products ?? ["Corrugated boxes"],
      productDescription: overrides.productDescription ?? "Corrugated shipping boxes",
      manufacturingStatus: "manufacturer",
      manufacturingCapabilities: [],
      customizationCapabilities: [],
      industriesServed: [],
      capacity: null,
    },
    commercial: {
      moq: null,
      priceRange: null,
      currency: "INR",
      leadTime: null,
      shippingRegions: [],
      paymentTerms: [],
      quoteAvailable: true,
    },
    compliance: {
      certifications: [],
      gstNumber: null,
      isoCertifications: [],
      otherCertifications: [],
      complianceDocuments: [],
    },
    intelligence: {
      sources: [],
      lastUpdated: new Date().toISOString(),
      dataConfidence: "medium",
      publicRating: null,
      reviewCount: 0,
      performance: null,
    },
    sourcing: {
      method: "internal_seed",
      verification: { status: "unverified", verifiedAt: null },
    },
    dedupeKey: `test-${id}`,
    mergedFrom: [],
  };
}

function baseCriteria(product: string, location: string): SearchCriteria {
  return {
    product,
    quantity: "",
    location,
    budget: "",
    deadline: "",
    quality: "",
    additionalRequirements: [],
    structured: null,
  };
}

async function main() {
  console.log("=== lib/location.ts: graduated comparison tiers ===");

  check(
    "exact city match",
    compareLocations("Hyderabad", "Hyderabad, Telangana") === "exact_city"
  );
  check(
    "same state, different city",
    compareLocations("Hyderabad", "Warangal, Telangana") === "same_state"
  );
  check(
    "elsewhere in the default region — not excluded, not an exact/state match",
    compareLocations("Hyderabad", "Chennai, Tamil Nadu") === "same_region"
  );
  check(
    "a bare region-wide request ('India') matches regardless of city",
    compareLocations("India", "Chennai, Tamil Nadu") === "region_wide_requested"
  );
  check(
    "an explicit citiesServed entry counts as an exact city match",
    compareLocations("Mumbai", "Pune, Maharashtra", ["Mumbai"]) === "exact_city"
  );
  check("default search region is India", DEFAULT_SEARCH_REGION === "India");

  console.log("\n=== matching.ts: India-wide search with no location ===");
  const relevantFarSupplier = makeSupplier({ location: "Kolkata, West Bengal" });
  const noLocationResult = matchSuppliers(
    [relevantFarSupplier],
    baseCriteria("corrugated boxes", "")
  );
  const noLocationMatch = noLocationResult.suppliers[0];
  check(
    "no location stated => neutral, not a mismatch",
    noLocationMatch.explanation.locationMatch === "unknown"
  );
  check(
    "a relevant supplier anywhere in India is not excluded for having no location filter",
    noLocationMatch.tier !== "no_match"
  );
  check(
    "search response reports the default search region",
    noLocationResult.meta.searchRegion === "India"
  );

  console.log("\n=== matching.ts: city-specific search with nationwide fallback ===");
  const exactCitySupplier = makeSupplier({ location: "Hyderabad, Telangana" });
  const sameStateSupplier = makeSupplier({ location: "Warangal, Telangana" });
  const elsewhereSupplier = makeSupplier({ location: "Chennai, Tamil Nadu" });

  const cityResult = matchSuppliers(
    [exactCitySupplier, sameStateSupplier, elsewhereSupplier],
    baseCriteria("corrugated boxes", "Hyderabad")
  );
  const byId = (id: number) => cityResult.suppliers.find((s) => s.id === id)!;

  check(
    "exact-city supplier is not excluded and scores highest of the three",
    byId(exactCitySupplier.id).score >= byId(sameStateSupplier.id).score &&
      byId(sameStateSupplier.id).score >= byId(elsewhereSupplier.id).score
  );
  check(
    "a highly relevant supplier outside the requested city is still ranked (not a hard mismatch)",
    byId(elsewhereSupplier.id).tier !== "no_match" &&
      byId(elsewhereSupplier.id).explanation.locationMatch !== "mismatch"
  );
  check(
    "exact city match is reported as 'match'",
    byId(exactCitySupplier.id).explanation.locationMatch === "match"
  );
  check(
    "same-state supplier is reported as a partial (regional) match",
    byId(sameStateSupplier.id).explanation.locationMatch === "partial"
  );

  console.log("\n=== extraction pipeline: use-case extraction ===");

  const officeQuery =
    "I need 20 ergonomic office chairs for a new office in Bengaluru, delivered within 20 days";
  const officeResult = extractProcurementRequirement(officeQuery);
  check(
    "'for a new office' is captured as intended use",
    officeResult.requirement.intendedUse.value === "a new office"
  );
  check(
    "intended-use phrase is not stuck onto the product text",
    !officeResult.requirement.product.value?.toLowerCase().includes("office in bengaluru")
  );

  const cosmeticsQuery =
    "I need 500 recyclable custom 5-ply corrugated boxes for cosmetics shipping, delivered to Hyderabad within 3 weeks, under ₹12 per box";
  const cosmeticsResult = extractProcurementRequirement(cosmeticsQuery);
  check(
    "'for cosmetics shipping' use case extracted from the cosmetics-boxes example",
    cosmeticsResult.requirement.intendedUse.value === "cosmetics shipping"
  );
  check(
    "specifications still extract correctly alongside a use-case clause",
    cosmeticsResult.requirement.specifications.construction.some((c) => c.includes("5-ply")) &&
      cosmeticsResult.requirement.specifications.sustainabilityRequirements.includes("recyclable") &&
      cosmeticsResult.requirement.specifications.customizationRequirements.includes("custom")
  );
  check(
    "location still extracts correctly alongside a use-case clause",
    cosmeticsResult.requirement.location.value === "Hyderabad"
  );

  const cncQuery = "I need 25 five-axis CNC milling machines for our manufacturing unit";
  const cncResult = extractProcurementRequirement(cncQuery);
  check(
    "'for our manufacturing unit' captured as intended use",
    cncResult.requirement.intendedUse.value === "our manufacturing unit"
  );

  console.log("\n=== extraction pipeline: no fabricated product wording ===");
  const supplierPhraseQuery = "I need reliable packaging boxes from suppliers in India";
  const supplierPhraseResult = extractProcurementRequirement(supplierPhraseQuery);
  const productLower = (supplierPhraseResult.requirement.product.value ?? "").toLowerCase();
  check(
    "'suppliers' never leaks into the derived product text",
    !productLower.includes("supplier")
  );
  check(
    "'from suppliers in India' never leaks into the derived product text",
    !productLower.includes("from suppliers")
  );

  // A "for <phrase>" intended-use clause must never steal territory from
  // a more specific, dictionary-backed capability match like "reliable
  // supplier" — see extractIntendedUse's claimedSpans check. Reuses the
  // same query as the extraction regression suite's "Service request,
  // no product quantity" case, which exercises exactly this collision.
  const nestedForQuery =
    "Looking for a reliable supplier for warehouse management services in Chennai";
  const nestedForResult = extractProcurementRequirement(nestedForQuery);
  check(
    "'reliable supplier' is still recognized as a capability keyword, not swallowed by use-case extraction",
    nestedForResult.requirement.specifications.requiredCapabilities.some((c) =>
      c.includes("reliable supplier")
    )
  );

  console.log("\n=== dashboard: brief built from the canonical structured requirement ===");

  function toDisplayRequirements(query: string): Requirements {
    const result = extractProcurementRequirement(query);
    return {
      product: result.requirement.product.value ?? "",
      quantity: result.requirement.quantity.value
        ? String(result.requirement.quantity.value)
        : "",
      location: result.requirement.location.value ?? "",
      budget: result.requirement.price.amount !== null ? "Under ₹12 per unit" : "",
      deadline: result.requirement.deliveryTimeframe.raw ?? "",
      quality: "",
      additionalRequirements: [],
      structured: result.requirement,
    };
  }

  const cosmeticsBrief = buildProcurementBrief(toDisplayRequirements(cosmeticsQuery));
  check("brief includes the use case", cosmeticsBrief.includes("cosmetics shipping"));
  check("brief includes the destination", cosmeticsBrief.includes("Hyderabad"));
  check("brief never contains 'From suppliers'", !cosmeticsBrief.toLowerCase().includes("from suppliers"));

  const emptyBrief = buildProcurementBrief({
    product: "",
    quantity: "",
    location: "",
    budget: "",
    deadline: "",
    quality: "",
    additionalRequirements: [],
    structured: null,
  });
  check("a requirement with nothing extracted shows 'Not specified', never a guess", emptyBrief === "Not specified");

  const specsSummary = buildSpecificationsSummary(toDisplayRequirements(cosmeticsQuery));
  check("specifications summary includes the construction spec", specsSummary.includes("5-ply") || specsSummary.toLowerCase().includes("ply"));

  const noSpecsSummary = buildSpecificationsSummary({
    product: "Widgets",
    quantity: "",
    location: "",
    budget: "",
    deadline: "",
    quality: "",
    additionalRequirements: [],
    structured: null,
  });
  check("no specifications extracted => honest 'Not specified'", noSpecsSummary === "Not specified");

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
