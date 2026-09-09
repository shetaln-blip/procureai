import type { Supplier } from "./supplier-types";
import type { ProcurementRequirement } from "./extraction/schema";
import { compareLocations, DEFAULT_SEARCH_REGION } from "./location";

// ---------------------------------------------------------------------
// Supplier discovery/ranking engine.
//
// This is a request-dependent scoring model: it reads the CURRENT
// structured procurement requirement (when the caller has one — see
// `structured` on SearchCriteria) and scores every supplier against
// THAT requirement specifically, rather than against a handful of fixed
// product categories. Two different requirements in the same broad
// category (e.g. "5-ply corrugated boxes" vs "food-grade corrugated
// boxes") are expected to produce different rankings, because they're
// checked against different facets of each supplier's actual data
// (per-supplier product text, certifications, location, MOQ, price,
// lead time) rather than a single flat "packaging = +30" bucket.
//
// Two principles drive every scoring decision here:
//   1. Evidence, not assumption. A supplier with no data for a field is
//      "unknown" for that field, not "satisfies it" and not "violates
//      it" — those are three different states, scored differently.
//   2. Hard requirements gate the result tier; soft preferences only
//      move the score. A confirmed mismatch on something the buyer
//      explicitly required (an unmet certification, a confirmed MOQ
//      violation, a location the supplier demonstrably doesn't serve)
//      caps how high a supplier can rank, no matter how good its other
//      numbers look.
// ---------------------------------------------------------------------

export type MatchReason = {
  type: "positive" | "warning";
  label: string;
};

// STRONG:    product-relevant, no confirmed hard-requirement mismatches,
//            and a healthy score.
// POTENTIAL: product-relevant but missing evidence for one or more
//            requirements, or a single soft mismatch — worth a look, not
//            a confident recommendation.
// WEAK:      product-relevant only loosely (thin keyword overlap) or has
//            multiple confirmed mismatches.
// NO_MATCH:  nothing in the supplier's data relates to what's being
//            bought at all. These are excluded from the primary result
//            list by the API layer (see route.ts) — returning them
//            ranked alongside real candidates is exactly the "same
//            suppliers for every query" failure mode this replaces.
export type MatchTier = "strong" | "potential" | "weak" | "no_match";

export type FieldMatch = "match" | "partial" | "mismatch" | "unknown";

export type MatchExplanation = {
  // Specific, concrete facts this supplier's data corroborates for THIS
  // request (e.g. "Manufactures corrugated boxes", "ISO 9001 certified",
  // "Located in Bengaluru, Karnataka").
  matchedCapabilities: string[];
  // Specific requirement facets the buyer stated that this supplier's
  // data does NOT confirm — either no evidence, or a confirmed mismatch.
  // Phrased so the buyer knows what to verify themselves.
  unmatchedRequirements: string[];
  locationMatch: FieldMatch;
  quantityMatch: FieldMatch;
  priceMatch: FieldMatch;
  deliveryMatch: FieldMatch;
  evidenceQuality: Supplier["intelligence"]["dataConfidence"];
  // 0-100 — how much of the STATED requirement could actually be
  // checked against real supplier data (not how well it scored). A
  // supplier with a great score but low confidence means "looks
  // relevant, but we don't have much to verify it against."
  confidence: number;
};

export type MatchedSupplier = Supplier & {
  score: number;
  tier: MatchTier;
  reasons: MatchReason[];
  explanation: MatchExplanation;
};

export type SearchCriteria = {
  product: string;
  quantity: string;
  location: string;
  budget: string;
  deadline: string;
  quality: string;
  additionalRequirements: string[];
  // The rich structured requirement from lib/extraction (Phase H), when
  // the caller has one. This is what drives matching — the flat fields
  // above are kept only as a fallback for a caller that predates it or
  // that has already flattened a saved request. Matching stays a
  // consumer of the extraction layer, never the reverse.
  structured?: ProcurementRequirement | null;
};

export type SearchMeta = {
  totalCandidates: number;
  strong: number;
  potential: number;
  weak: number;
  noMatch: number;
  // Set when the database doesn't contain enough strong matches for this
  // request — surfaced to the buyer instead of quietly padding the
  // result list with irrelevant suppliers.
  message: string | null;
  // Makes the "we search all of India by default, not just Bengaluru"
  // behavior an explicit, visible fact about every search response
  // rather than something only readable from source — see
  // lib/location.ts's DEFAULT_SEARCH_REGION, which this always echoes.
  searchRegion: string;
};

export type SearchResult = {
  suppliers: MatchedSupplier[];
  meta: SearchMeta;
};

// ---------------------------------------------------------------------
// Category taxonomy — a coarse first signal only. It groups supplier
// category labels and request keywords into the same broad concept
// ("packaging", "electronics", ...) so a request in plain English can
// find a supplier filed under an equivalent category label. This alone
// is deliberately NOT enough to call a supplier a match — see
// termCoverage below, which checks the request's actual product/spec
// words against each supplier's own product text, and is what makes two
// requests in the same broad category (e.g. two different packaging
// requests) rank suppliers differently from each other.
// ---------------------------------------------------------------------
type CategoryGroup = {
  concept: string;
  categories: string[];
  keywords: string[];
};

const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    concept: "packaging",
    categories: [
      "packaging",
      "corrugated packaging",
      "industrial packaging",
      "paper packaging",
      "custom boxes",
      "corrugated fibreboard",
      "protective packaging",
      "retail packaging",
    ],
    keywords: [
      "packaging",
      "box",
      "boxes",
      "carton",
      "cartons",
      "corrugated",
      "crate",
      "crates",
      "shipping box",
      "fibreboard",
      "fiberboard",
      "ply",
    ],
  },
  {
    concept: "electronics",
    categories: ["electronics", "electronic components", "hardware"],
    keywords: [
      "electronic",
      "electronics",
      "component",
      "components",
      "circuit",
      "pcb",
      "sensor",
    ],
  },
  {
    concept: "office_furniture",
    categories: ["office furniture", "commercial furniture"],
    keywords: [
      "office",
      "furniture",
      "chair",
      "chairs",
      "desk",
      "desks",
      "workstation",
    ],
  },
  {
    concept: "industrial",
    categories: ["industrial equipment", "industrial supplies"],
    keywords: ["industrial", "machinery", "equipment"],
  },
  {
    concept: "raw_materials",
    categories: ["raw materials", "metals", "chemicals"],
    keywords: [
      "steel",
      "aluminum",
      "aluminium",
      "raw material",
      "metal",
      "sheet",
      "coil",
      "resin",
      "polymer",
    ],
  },
];

function conceptsForCategories(categories: string[]): Set<string> {
  const lower = categories.map((category) => category.toLowerCase());
  const concepts = new Set<string>();

  for (const group of CATEGORY_GROUPS) {
    if (group.categories.some((category) => lower.includes(category))) {
      concepts.add(group.concept);
    }
  }

  return concepts;
}

function conceptsForText(text: string): Set<string> {
  const lower = text.toLowerCase();
  const concepts = new Set<string>();

  for (const group of CATEGORY_GROUPS) {
    if (group.keywords.some((keyword) => lower.includes(keyword))) {
      concepts.add(group.concept);
    }
  }

  return concepts;
}

// ---------------------------------------------------------------------
// Small parsing utilities (legacy-field fallbacks only — when a
// structured field is available it's used directly, never re-parsed).
// ---------------------------------------------------------------------
function parseNumber(text: string): number | null {
  const match = text.match(/[\d,]+(?:\.\d+)?/);

  return match ? Number(match[0].replace(/,/g, "")) : null;
}

function parseRange(text: string): [number, number] | null {
  const numbers = text.match(/[\d,]+(?:\.\d+)?/g);

  if (!numbers || numbers.length === 0) return null;

  const values = numbers.map((value) => Number(value.replace(/,/g, "")));

  return [Math.min(...values), Math.max(...values)];
}

function parseDeadlineDays(deadline: string): number | null {
  const match = deadline.match(/\d+/);

  if (!match) return null;

  let days = Number(match[0]);
  const lower = deadline.toLowerCase();

  if (lower.includes("week")) days *= 7;
  if (lower.includes("month")) days *= 30;

  return days;
}

function parseLeadTimeDays(leadTime: string | null): number | null {
  if (!leadTime) return null;

  const rangeMatch = leadTime.match(/(\d+)\s*[–-]\s*(\d+)/);

  if (rangeMatch) return Number(rangeMatch[2]);

  return parseNumber(leadTime);
}

function isStale(lastUpdated: string): boolean {
  const days =
    (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);

  return Number.isFinite(days) && days > 365;
}

const CONFIDENCE_SCORE: Record<Supplier["intelligence"]["dataConfidence"], number> = {
  high: 8,
  medium: 5,
  low: 2,
};

const STOPWORDS = new Set([
  "the", "a", "an", "for", "of", "with", "and", "our", "my", "your", "we",
  "i", "need", "want", "require", "looking", "source", "procure",
  "purchase", "buy", "get", "please", "in", "at", "to", "from", "under",
  "delivered", "delivery", "supplier", "suppliers", "quality",
]);

// Splits free text into meaningful lowercase tokens for keyword-overlap
// scoring. Deliberately keeps hyphenated/decimal compounds intact ("5-ply",
// "99.9%") rather than splitting on every punctuation mark — those
// compounds are exactly the kind of specific, checkable fact this
// function exists to preserve.
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.%-]+/i)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary containment, not raw substring — this is what stops a
// short token from "matching" as a fragment buried inside an unrelated
// word (e.g. the stripped singular of "arms" is "arm", which IS a raw
// substring of "Garment"; \b anchoring means it can't match unless "arm"
// stands alone as a word). Boundaries are only asserted on a side whose
// edge character is a word character, so tokens ending in punctuation
// like "99.9%" still match correctly.
function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;

  const escaped = escapeRegex(needle);
  const lead = /^\w/.test(needle) ? "\\b" : "";
  const trail = /\w$/.test(needle) ? "\\b" : "";

  return new RegExp(`${lead}${escaped}${trail}`, "i").test(haystack);
}

// Checks whether `term` (a request-side token, possibly hyphenated like
// "5-ply" or plural like "boxes") is corroborated somewhere in a
// supplier's searchable text — tolerating the two most common surface
// mismatches between how a buyer phrases a request and how a real,
// publicly-sourced product listing is worded: hyphen vs space ("5-ply"
// vs "5 Ply") and singular vs plural ("box" vs "boxes"). This is not
// stemming — it's two narrow, explainable equivalences on WHOLE words,
// not a fuzzy match, so it doesn't manufacture matches out of unrelated
// words that merely happen to contain the same letters.
function termMatches(searchableText: string, term: string): boolean {
  const spaced = term.replace(/-/g, " ");

  if (containsPhrase(searchableText, term) || containsPhrase(searchableText, spaced)) {
    return true;
  }

  if (spaced.endsWith("es") && spaced.length > 4) {
    // Word-boundary anchoring (not raw substring) is what makes this
    // safe even for a short resulting root — "boxes" -> "box" can only
    // match a standalone "box" token, never a fragment of a longer word.
    if (containsPhrase(searchableText, spaced.slice(0, -2))) return true;
  } else if (spaced.endsWith("s") && !spaced.endsWith("ss") && spaced.length > 3) {
    if (containsPhrase(searchableText, spaced.slice(0, -1))) return true;
  } else if (containsPhrase(searchableText, `${spaced}s`)) {
    return true;
  }

  return false;
}

function supplierSearchableText(supplier: Supplier): string {
  return [
    ...supplier.capabilities.categories,
    ...supplier.capabilities.products,
    supplier.capabilities.productDescription,
    ...supplier.capabilities.manufacturingCapabilities,
    ...supplier.capabilities.customizationCapabilities,
    ...supplier.capabilities.industriesServed,
  ]
    .join(" ")
    .toLowerCase();
}

function supplierCertificationText(supplier: Supplier): string {
  return [
    ...supplier.compliance.certifications,
    ...supplier.compliance.isoCertifications,
    ...supplier.compliance.otherCertifications,
  ]
    .join(" ")
    .toLowerCase();
}

// ---------------------------------------------------------------------
// The requirement signal: a single normalized view of "what does this
// specific request actually need", built once from either the rich
// structured requirement or the flat legacy fields. Every supplier is
// then scored against this SAME signal, so the differences between two
// requests come entirely from what's in it, not from ad hoc per-call
// logic scattered through the scoring function.
// ---------------------------------------------------------------------
type RequirementSignal = {
  productTerms: string[]; // product name + material + construction, tokenized — the "what is this, specifically" signal
  productConceptText: string; // product + all spec text, for coarse category matching
  hasProductInfo: boolean;
  location: { value: string; explicit: boolean } | null;
  quantity: number | null;
  unit: string | null;
  moqRequirementStated: boolean;
  price: {
    amount: number | null;
    amountMax: number | null;
    basis: "per_unit" | "total_budget" | null;
    explicit: boolean;
  } | null;
  deadlineDays: number | null;
  deadlineExplicit: boolean;
  certifications: string[]; // explicit, verbatim (e.g. "ISO 9001")
  material: string | null;
  softFacets: { kind: string; label: string; terms: string[] }[]; // sustainability / customization / packaging / shipping / quality / capabilities
};

function buildRequirementSignal(criteria: SearchCriteria): RequirementSignal {
  const structured = criteria.structured ?? null;

  if (structured) {
    const req = structured;
    const specs = req.specifications;

    const productTerms = [
      ...tokenize(req.product.value ?? ""),
      ...tokenize(specs.material.value ?? ""),
      ...specs.construction.map((term) => term.toLowerCase()),
    ];

    const softFacets: RequirementSignal["softFacets"] = [];

    if (specs.sustainabilityRequirements.length > 0) {
      softFacets.push({
        kind: "sustainability",
        label: specs.sustainabilityRequirements.join(", "),
        terms: specs.sustainabilityRequirements.map((t) => t.toLowerCase()),
      });
    }
    if (specs.customizationRequirements.length > 0) {
      softFacets.push({
        kind: "customization",
        label: specs.customizationRequirements.join(", "),
        terms: specs.customizationRequirements.map((t) => t.toLowerCase()),
      });
    }
    if (specs.packagingRequirements.length > 0) {
      softFacets.push({
        kind: "packaging",
        label: specs.packagingRequirements.join(", "),
        terms: specs.packagingRequirements.map((t) => t.toLowerCase()),
      });
    }
    if (specs.shippingRequirements.length > 0) {
      softFacets.push({
        kind: "shipping",
        label: specs.shippingRequirements.join(", "),
        terms: specs.shippingRequirements.map((t) => t.toLowerCase()),
      });
    }
    if (specs.qualityRequirements.length > 0) {
      softFacets.push({
        kind: "quality",
        label: specs.qualityRequirements.join(", "),
        terms: specs.qualityRequirements.map((t) => t.toLowerCase()),
      });
    }
    if (specs.requiredCapabilities.length > 0) {
      softFacets.push({
        kind: "capability",
        label: specs.requiredCapabilities.join(", "),
        terms: specs.requiredCapabilities.map((t) => t.toLowerCase()),
      });
    }
    // Intended use / context ("a new office", "shipping cosmetics") —
    // routed through the same soft-facet mechanism as the others so a
    // supplier whose listing corroborates the buyer's actual USE of the
    // product (not just its category) scores higher, and one that
    // doesn't gets an honest "not confirmed" note rather than silence.
    if (req.intendedUse.value) {
      softFacets.push({
        kind: "use_case",
        label: req.intendedUse.value,
        terms: tokenize(req.intendedUse.value),
      });
    }

    return {
      productTerms,
      productConceptText: [
        req.product.value ?? "",
        specs.material.value ?? "",
        ...specs.construction,
        ...specs.sustainabilityRequirements,
        ...specs.customizationRequirements,
        ...specs.packagingRequirements,
      ].join(" "),
      hasProductInfo: productTerms.length > 0,
      location: req.location.value
        ? { value: req.location.value, explicit: true }
        : null,
      quantity: req.quantity.value,
      unit: req.unit.value,
      moqRequirementStated: req.quantity.value !== null,
      price:
        req.price.amount !== null
          ? {
              amount: req.price.amount,
              amountMax: req.price.amountMax,
              basis: req.price.basis,
              explicit: true,
            }
          : null,
      deadlineDays: req.deliveryTimeframe.relativeDays,
      deadlineExplicit: req.deliveryTimeframe.kind !== null,
      certifications: specs.certifications,
      material: specs.material.value,
      softFacets,
    };
  }

  // Legacy fallback — a caller with only the flat fields (an older saved
  // request, or a direct API call without `structured`). Best-effort:
  // everything is inferred from plain text since there's no structured
  // signal to lean on.
  const productTerms = tokenize(
    `${criteria.product} ${criteria.additionalRequirements.join(" ")}`
  );

  return {
    productTerms,
    productConceptText: `${criteria.product} ${criteria.additionalRequirements.join(" ")}`,
    hasProductInfo: productTerms.length > 0,
    location: criteria.location ? { value: criteria.location, explicit: true } : null,
    quantity: criteria.quantity ? parseNumber(criteria.quantity) : null,
    unit: null,
    moqRequirementStated: Boolean(criteria.quantity),
    price: criteria.budget
      ? {
          amount: parseNumber(criteria.budget),
          amountMax: parseRange(criteria.budget)?.[1] ?? null,
          basis: null,
          explicit: true,
        }
      : null,
    deadlineDays: criteria.deadline ? parseDeadlineDays(criteria.deadline) : null,
    deadlineExplicit: Boolean(criteria.deadline),
    certifications: [],
    material: null,
    softFacets: criteria.quality
      ? [{ kind: "quality", label: criteria.quality, terms: tokenize(criteria.quality) }]
      : [],
  };
}

// ---------------------------------------------------------------------
// Scoring — every supplier is scored against the SAME RequirementSignal.
// Weights are chosen so product/capability fit dominates (a supplier
// with zero relevance to what's being bought cannot out-score a relevant
// one just by having a filled-in MOQ), while confirmed hard-requirement
// violations are tracked separately from the numeric score and gate the
// tier directly.
// ---------------------------------------------------------------------
function scoreSupplier(
  supplier: Supplier,
  signal: RequirementSignal
): MatchedSupplier {
  const reasons: MatchReason[] = [];
  const matchedCapabilities: string[] = [];
  const unmatchedRequirements: string[] = [];
  let hardMismatches = 0;
  let checkableFacets = 0;
  let verifiedFacets = 0;
  let score = 0;

  const searchableText = supplierSearchableText(supplier);

  // --- PRODUCT / CAPABILITY FIT (up to 40) ---------------------------
  const supplierConcepts = conceptsForCategories(supplier.capabilities.categories);
  const requestConcepts = conceptsForText(signal.productConceptText);
  const conceptMatch = [...requestConcepts].some((c) => supplierConcepts.has(c));

  const matchedTerms = signal.productTerms.filter((term) =>
    termMatches(searchableText, term)
  );
  const termCoverage =
    signal.productTerms.length > 0
      ? matchedTerms.length / signal.productTerms.length
      : 0;

  const productRelevant =
    !signal.hasProductInfo || conceptMatch || matchedTerms.length > 0;

  if (!signal.hasProductInfo) {
    // Nothing stated to check against — neutral, not a positive signal.
    score += 12;
  } else if (!productRelevant) {
    unmatchedRequirements.push(
      `No evidence this supplier handles "${signal.productTerms.slice(0, 4).join(" ")}"`
    );
  } else {
    if (conceptMatch) {
      score += 16;
      const category = supplier.capabilities.categories[0];
      if (category) {
        matchedCapabilities.push(`Categorized under ${category}`);
      }
    }

    score += Math.round(24 * termCoverage);

    if (matchedTerms.length > 0) {
      matchedCapabilities.push(
        `Product listing matches: ${matchedTerms.slice(0, 4).join(", ")}`
      );
    }

    const uncoveredTerms = signal.productTerms.filter(
      (term) => !matchedTerms.includes(term)
    );
    if (uncoveredTerms.length > 0 && matchedTerms.length > 0) {
      unmatchedRequirements.push(
        `Not confirmed: ${uncoveredTerms.slice(0, 3).join(", ")}`
      );
    }
  }

  // --- CERTIFICATIONS (explicit = hard requirement) -------------------
  if (signal.certifications.length > 0) {
    checkableFacets++;
    const certText = supplierCertificationText(supplier);
    const matched = signal.certifications.filter((cert) =>
      certText.includes(cert.toLowerCase())
    );

    if (matched.length === signal.certifications.length) {
      score += 12;
      verifiedFacets++;
      matchedCapabilities.push(`${matched.join(", ")} certified`);
    } else if (matched.length > 0) {
      score += 6;
      verifiedFacets++;
      matchedCapabilities.push(`${matched.join(", ")} certified`);
      const missing = signal.certifications.filter((c) => !matched.includes(c));
      unmatchedRequirements.push(`${missing.join(", ")} not listed`);
      hardMismatches++;
    } else {
      unmatchedRequirements.push(
        `${signal.certifications.join(", ")} not listed for this supplier`
      );
      hardMismatches++;
    }
  }

  // --- SOFT FACETS (sustainability / customization / packaging /
  //     shipping / quality / capabilities) — up to 4 each -------------
  for (const facet of signal.softFacets) {
    const hit = facet.terms.some((term) => termMatches(searchableText, term));

    if (hit) {
      score += 4;
      matchedCapabilities.push(`Supports ${facet.label}`);
    } else {
      unmatchedRequirements.push(`${facet.label} not confirmed`);
    }
  }

  // --- LOCATION FIT (up to 15) ----------------------------------------
  // Graduated, not binary (Quote Intelligence Audit's "expand supplier
  // coverage from Bengaluru to all of India"): a supplier outside the
  // buyer's requested city is real, relevant evidence — never a
  // confirmed mismatch — as long as it's still within the default
  // search region (lib/location.ts). Only ranks WORSE the further it
  // gets from what the buyer actually asked for; it never gets excluded
  // or tier-capped for it the way a genuine hard mismatch does.
  let locationMatch: FieldMatch = "unknown";

  if (signal.location) {
    checkableFacets++;

    const tier = compareLocations(
      signal.location.value,
      supplier.identity.location,
      supplier.identity.citiesServed
    );

    if (tier === "region_wide_requested") {
      // The buyer explicitly asked for the whole region ("India") —
      // every supplier in this catalog is (by default) in it, so this
      // is a full, confirmed match, not a fallback.
      locationMatch = "match";
      score += 15;
      verifiedFacets++;
      matchedCapabilities.push(
        `Serves customers across ${DEFAULT_SEARCH_REGION}`
      );
    } else if (tier === "exact_city") {
      locationMatch = "match";
      score += 15;
      verifiedFacets++;
      matchedCapabilities.push(`Located in ${supplier.identity.location}`);
    } else if (tier === "same_state") {
      locationMatch = "partial";
      score += 9;
      verifiedFacets++;
      matchedCapabilities.push(`Regionally based (${supplier.identity.location})`);
      unmatchedRequirements.push(`Not confirmed specifically in ${signal.location.value}`);
    } else if (tier === "same_region") {
      // Outside the requested city/state, but still a real, relevant
      // supplier within the default search region — kept in the running
      // (no hardMismatches++) rather than excluded for being non-local.
      locationMatch = "partial";
      score += 3;
      unmatchedRequirements.push(
        `Not confirmed to serve ${signal.location.value} — located in ${supplier.identity.location} (elsewhere in ${DEFAULT_SEARCH_REGION})`
      );
    } else {
      // "different_region" — reachable once supplier records carry an
      // explicit country that differs from the requested one.
      locationMatch = "mismatch";
      hardMismatches++;
      unmatchedRequirements.push(
        `Not based in the requested region (listed: ${supplier.identity.location})`
      );
    }
  } else {
    // No location stated — defaults to a region-wide (India) search,
    // not to any one city. Neutral: neither confirms nor penalizes.
    score += 5;
  }

  // --- QUANTITY / MOQ FIT (up to 10) ----------------------------------
  let quantityMatch: FieldMatch = "unknown";

  if (signal.moqRequirementStated) {
    const moq = supplier.commercial.moq ? parseNumber(supplier.commercial.moq) : null;

    if (signal.quantity !== null && moq !== null) {
      checkableFacets++;
      if (signal.quantity >= moq) {
        quantityMatch = "match";
        score += 10;
        verifiedFacets++;
        matchedCapabilities.push(`MOQ (${supplier.commercial.moq}) fits requested quantity`);
      } else {
        quantityMatch = "mismatch";
        hardMismatches++;
        verifiedFacets++;
        unmatchedRequirements.push(
          `Requested quantity is below this supplier's MOQ (${supplier.commercial.moq})`
        );
      }
    } else if (moq === null) {
      unmatchedRequirements.push("MOQ not publicly listed");
    }
  } else {
    score += 3;
  }

  // --- PRICE FIT (up to 10) --------------------------------------------
  let priceMatch: FieldMatch = "unknown";

  if (!supplier.commercial.priceRange) {
    if (signal.price?.explicit) unmatchedRequirements.push("Public pricing unavailable");
  } else if (signal.price?.explicit && signal.price.amount !== null) {
    checkableFacets++;
    const range = parseRange(supplier.commercial.priceRange);

    if (range) {
      const [min, max] = range;
      const target = signal.price.amountMax ?? signal.price.amount;

      if (target >= min && target <= max) {
        priceMatch = "match";
        score += 10;
        verifiedFacets++;
        matchedCapabilities.push(`Pricing (${supplier.commercial.priceRange}) within your target`);
      } else if (signal.price.amount >= min) {
        priceMatch = "partial";
        score += 5;
        verifiedFacets++;
      } else {
        priceMatch = "mismatch";
        hardMismatches++;
        verifiedFacets++;
        unmatchedRequirements.push(
          `Listed pricing (${supplier.commercial.priceRange}) exceeds your target`
        );
      }
    }
  } else {
    score += 3;
  }

  // --- DELIVERY FIT (up to 10) ------------------------------------------
  let deliveryMatch: FieldMatch = "unknown";
  const leadTimeDays = parseLeadTimeDays(supplier.commercial.leadTime);

  if (signal.deadlineExplicit) {
    if (signal.deadlineDays !== null && leadTimeDays !== null) {
      checkableFacets++;
      if (leadTimeDays <= signal.deadlineDays) {
        deliveryMatch = "match";
        score += 10;
        verifiedFacets++;
        matchedCapabilities.push("Meets your delivery timeframe");
      } else {
        deliveryMatch = "mismatch";
        hardMismatches++;
        verifiedFacets++;
        unmatchedRequirements.push(
          `Lead time (${supplier.commercial.leadTime}) may miss your deadline`
        );
      }
    } else if (leadTimeDays === null) {
      unmatchedRequirements.push("Lead time not publicly listed");
    }
  } else {
    score += 3;
  }

  // --- EVIDENCE / DATA CONFIDENCE (up to 8) ------------------------------
  score += CONFIDENCE_SCORE[supplier.intelligence.dataConfidence];

  if (supplier.intelligence.dataConfidence === "low") {
    unmatchedRequirements.push("Limited public evidence for this supplier");
  }

  if (isStale(supplier.intelligence.lastUpdated)) {
    unmatchedRequirements.push("Supplier data may be outdated");
  }

  // --- RELIABILITY (up to 5, only when we actually have a rating) -------
  if (supplier.intelligence.publicRating !== null) {
    score += Math.min(Math.round(supplier.intelligence.publicRating), 5);
  }

  // --- Tier -------------------------------------------------------------
  const clampedScore = Math.max(1, Math.min(Math.round(score), 99));
  let tier: MatchTier;

  if (!productRelevant) {
    tier = "no_match";
  } else if (hardMismatches === 0 && clampedScore >= 55) {
    tier = "strong";
  } else if (hardMismatches <= 1 && clampedScore >= 32) {
    tier = "potential";
  } else {
    tier = "weak";
  }

  // Build the final `reasons` list (unchanged shape, for the existing UI)
  // directly from the same matched/unmatched facts used above — one
  // source of truth for "why", not a second parallel explanation.
  for (const label of matchedCapabilities) {
    reasons.push({ type: "positive", label });
  }
  for (const label of unmatchedRequirements) {
    reasons.push({ type: "warning", label });
  }

  const confidence =
    checkableFacets === 0 ? 50 : Math.round((verifiedFacets / checkableFacets) * 100);

  return {
    ...supplier,
    score: clampedScore,
    tier,
    reasons,
    explanation: {
      matchedCapabilities,
      unmatchedRequirements,
      locationMatch,
      quantityMatch,
      priceMatch,
      deliveryMatch,
      evidenceQuality: supplier.intelligence.dataConfidence,
      confidence,
    },
  };
}

const STRONG_MATCH_FLOOR = 3;

function buildMeta(suppliers: MatchedSupplier[]): SearchMeta {
  const strong = suppliers.filter((s) => s.tier === "strong").length;
  const potential = suppliers.filter((s) => s.tier === "potential").length;
  const weak = suppliers.filter((s) => s.tier === "weak").length;
  const noMatch = suppliers.filter((s) => s.tier === "no_match").length;

  let message: string | null = null;

  if (strong === 0 && potential === 0 && weak === 0) {
    message =
      "No suppliers in our current database appear relevant to this requirement. ProcureAI's supplier catalog doesn't yet cover this category — we're not showing unrelated suppliers as if they were matches.";
  } else if (strong < STRONG_MATCH_FLOOR) {
    const relevant = strong + potential + weak;
    message = `Only ${strong} supplier${strong === 1 ? "" : "s"} in our current database strongly match${
      strong === 1 ? "es" : ""
    } this requirement${
      relevant > strong
        ? ` (${relevant - strong} more shown below as potential matches — verify capability directly)`
        : ""
    }.`;
  }

  return {
    totalCandidates: suppliers.length,
    strong,
    potential,
    weak,
    noMatch,
    message,
    searchRegion: DEFAULT_SEARCH_REGION,
  };
}

export function matchSuppliers(
  suppliers: Supplier[],
  criteria: SearchCriteria
): SearchResult {
  const signal = buildRequirementSignal(criteria);

  const scored = suppliers
    .map((supplier) => scoreSupplier(supplier, signal))
    .sort((a, b) => b.score - a.score);

  return { suppliers: scored, meta: buildMeta(scored) };
}
