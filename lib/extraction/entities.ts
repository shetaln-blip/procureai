import type { ConfidenceLevel, PriceType, PricingBasis } from "./schema";

// Stage 2 of the pipeline: entity extraction. Every matcher below scans
// the ORIGINAL normalized string and reports character spans — nothing
// here mutates the string. Overlapping spans are resolved once, by
// priority, in resolveOverlaps() at the bottom of this file. This is the
// structural fix for the old parser: instead of a sequence of .replace()
// calls each operating on an already-mutated string (which is how a
// technical spec like "5-ply" or a location like "Bengaluru" could end
// up partially consumed by an earlier, unrelated regex and reappear
// mangled or duplicated), every entity is found against the same
// untouched source text and conflicts are settled by explicit priority,
// not by accident of regex execution order.

export type BaseEntity = {
  start: number;
  end: number;
  raw: string;
  priority: number; // lower = claimed first on overlap
  confidence: ConfidenceLevel;
};

export type CertificationEntity = BaseEntity & {
  kind: "certification";
  value: string;
};

export type TechnicalSpecEntity = BaseEntity & {
  kind: "technical_spec";
  value: string;
};

export type PriceEntity = BaseEntity & {
  kind: "price";
  amount: number;
  amountMax: number | null;
  currency: string | null;
  currencySymbol: string | null;
  basis: PricingBasis;
  type: PriceType;
};

export type QuantityEntity = BaseEntity & {
  kind: "quantity";
  amount: number;
  unit: string;
};

export type LocationEntity = BaseEntity & {
  kind: "location";
  value: string;
};

export type DateEntity = BaseEntity & {
  kind: "date";
  timeframeKind: "relative" | "absolute" | "urgent";
  relativeDays: number | null;
  absoluteDate: string | null;
};

export type KeywordCategory =
  | "quality"
  | "sustainability"
  | "customization"
  | "packaging"
  | "shipping"
  | "capability"
  | "payment_terms";

export type KeywordEntity = BaseEntity & {
  kind: KeywordCategory;
  value: string;
};

export type IntendedUseEntity = BaseEntity & {
  kind: "intended_use";
  value: string;
};

export type Entity =
  | CertificationEntity
  | TechnicalSpecEntity
  | PriceEntity
  | QuantityEntity
  | LocationEntity
  | DateEntity
  | KeywordEntity
  | IntendedUseEntity;

function parseNum(text: string): number {
  return Number(text.replace(/,/g, ""));
}

// ---------------------------------------------------------------------
// Priority 0 — certifications & standards. Claimed first so a bare
// number inside "ISO 9001" or "Grade 304" can never be mistaken for a
// quantity or a different technical spec later.
// ---------------------------------------------------------------------
function extractCertifications(text: string): CertificationEntity[] {
  const entities: CertificationEntity[] = [];

  for (const match of text.matchAll(
    /\b(ISO\s?\d{3,5}(?::\d{4})?)\b(?:\s*(?:certified|certification|compliant|approved))?/gi
  )) {
    entities.push({
      kind: "certification",
      start: match.index!,
      end: match.index! + match[0].length,
      raw: match[0],
      // `value` keeps just the code itself ("ISO 9001") — the trailing
      // "certified"/"compliant" word is still consumed by the match (so
      // it doesn't survive as an orphan word in the derived product
      // text), but it's not part of the certification's identity.
      value: match[1].replace(/\s+/g, " ").trim(),
      priority: 0,
      confidence: "high",
    });
  }

  // Written-out acronym certifications — matched case-sensitively since
  // real requests write these in caps; a lowercase "ce" or "fda" inside
  // an unrelated word is not a certification claim.
  for (const match of text.matchAll(
    /\b(BIS|FSSAI|CE|RoHS|FDA|HACCP|GMP|CPSIA|REACH)\b(?:\s*(?:certified|certification|marking|approved|compliant))?/g
  )) {
    entities.push({
      kind: "certification",
      start: match.index!,
      end: match.index! + match[0].length,
      raw: match[0],
      value: match[1].trim(),
      priority: 0,
      confidence: "high",
    });
  }

  for (const match of text.matchAll(/\bgrade\s+([A-Za-z0-9]+)\b/gi)) {
    entities.push({
      kind: "certification",
      start: match.index!,
      end: match.index! + match[0].length,
      raw: match[0],
      value: match[0].replace(/\s+/g, " ").trim(),
      priority: 0,
      confidence: "high",
    });
  }

  return entities;
}

// ---------------------------------------------------------------------
// Priority 1 — technical/measurement specs. Hyphenated "N-unit" is
// treated as a compound adjective (spec), never a standalone quantity —
// that's the actual signal, not a hardcoded list of "known" specs like
// 5-ply. A material immediately preceded by a bare number ("304
// stainless steel") is a grade reference, not a count. GSM/micron never
// denote a quantity even without a hyphen.
// ---------------------------------------------------------------------
const TECH_UNITS =
  "ply|layers?|inch(?:es)?|in|mm|cm|m|ml|litres?|liters?|l|tons?|tonnes?|kg|watts?|w|volts?|v|gauge|axis|axes";

const MATERIAL_WORDS =
  "stainless steel|aluminum|aluminium|titanium|brass|copper|plastic|polymer|steel";

function extractTechnicalSpecs(text: string): TechnicalSpecEntity[] {
  const entities: TechnicalSpecEntity[] = [];

  for (const match of text.matchAll(
    new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*-\\s*(${TECH_UNITS})\\b`, "gi")
  )) {
    entities.push({
      kind: "technical_spec",
      start: match.index!,
      end: match.index! + match[0].length,
      raw: match[0],
      value: match[0].trim(),
      priority: 1,
      confidence: "high",
    });
  }

  for (const match of text.matchAll(/\b(\d+(?:\.\d+)?)\s*(gsm|microns?|mil)\b/gi)) {
    entities.push({
      kind: "technical_spec",
      start: match.index!,
      end: match.index! + match[0].length,
      raw: match[0],
      value: match[0].trim(),
      priority: 1,
      confidence: "high",
    });
  }

  for (const match of text.matchAll(/\b\d+(?:\.\d+)?\s*%(\s*(?:pure|purity))?/gi)) {
    entities.push({
      kind: "technical_spec",
      start: match.index!,
      end: match.index! + match[0].length,
      raw: match[0],
      value: match[0].trim(),
      priority: 1,
      confidence: "high",
    });
  }

  for (const match of text.matchAll(
    new RegExp(`\\b(\\d{2,4})\\s+(${MATERIAL_WORDS})\\b`, "gi")
  )) {
    entities.push({
      kind: "technical_spec",
      start: match.index!,
      end: match.index! + match[0].length,
      raw: match[0],
      value: match[0].trim(),
      priority: 1,
      confidence: "high",
    });
  }

  return entities;
}

// ---------------------------------------------------------------------
// Priority 2 — price/budget. Distinguishes a maximum/ceiling, a range,
// an explicit total-budget phrase, and a bare currency+amount, and
// records the pricing basis (per-unit vs total) whenever a "per X"
// phrase is present — that basis is exactly what the old string-cleanup
// parser silently dropped.
//
// The word-based alternatives ("Rs", "INR", "USD", "Rupees") are each
// anchored with a leading \b. Without it, the case-insensitive "Rs"
// branch matches the tail of ANY ordinary word ending in "rs" —
// "changers", "computers", "flowers" — and combined with AMOUNT (below)
// being able to match a bare comma with zero digits, that produced a
// completely fabricated price (amount 0) out of a phrase like "...tool
// changers, delivered...". \b prevents the mid-word match; requiring a
// leading digit in AMOUNT closes the same hole from the other side.
// ---------------------------------------------------------------------
const CURRENCY = "(₹|\\bRs\\.?|\\bINR|\\$|\\bUSD|\\bRupees?)";
const AMOUNT = "(\\d[\\d,]*(?:\\.\\d+)?)";
const BASIS = "(?:per\\s*(unit|piece|item|box|kg|pc|machine|machines))?";

function currencyMeta(symbolOrCode: string): {
  currency: string | null;
  currencySymbol: string | null;
} {
  const normalized = symbolOrCode.trim().toLowerCase();

  if (normalized === "₹" || normalized.startsWith("rs") || normalized === "inr" || normalized.startsWith("rupee")) {
    return { currency: "INR", currencySymbol: "₹" };
  }

  if (normalized === "$" || normalized === "usd") {
    return { currency: "USD", currencySymbol: "$" };
  }

  return { currency: null, currencySymbol: null };
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function extractPriceEntities(text: string): PriceEntity[] {
  const entities: PriceEntity[] = [];
  const claimed: [number, number][] = [];

  const claim = (start: number, end: number) => {
    claimed.push([start, end]);
  };

  const isClaimed = (start: number, end: number) =>
    claimed.some(([s, e]) => overlaps(start, end, s, e));

  // Indian lakh/crore shorthand: "₹20 lakh", "budget of ₹20 lakh per
  // machine", "under ₹1.5 crore" — common for higher-value equipment
  // (machinery, CNC) where per-unit prices aren't quoted in bare rupees.
  // Runs first so it claims its span before the generic patterns below
  // would otherwise match just the bare currency+amount and silently
  // drop the x100,000 / x10,000,000 multiplier.
  const lakhCrorePattern = new RegExp(
    `\\b(?:(under|below|less than|maximum|max|up to)\\s+)?(?:(?:total\\s+)?budget(?:\\s+of)?\\s*(?:is)?\\s*)?${CURRENCY}\\s?${AMOUNT}\\s*(lakhs?|lacs?|crores?)\\b\\s*${BASIS}`,
    "gi"
  );

  for (const match of text.matchAll(lakhCrorePattern)) {
    const start = match.index!;
    const end = start + match[0].length;

    if (isClaimed(start, end)) continue;

    const { currency, currencySymbol } = currencyMeta(match[2]);
    const isCeiling = Boolean(match[1]);
    const multiplier = match[4].toLowerCase().startsWith("crore") ? 10_000_000 : 100_000;
    const basisWord = match[5];

    entities.push({
      kind: "price",
      start,
      end,
      raw: match[0],
      amount: parseNum(match[3]) * multiplier,
      amountMax: null,
      currency,
      currencySymbol,
      basis: basisWord ? "per_unit" : isCeiling ? null : "total_budget",
      type: isCeiling ? "maximum" : "target",
      priority: 2,
      confidence: "high",
    });
    claim(start, end);
  }

  // Range: "₹8-₹14 per unit", "between ₹8 and ₹14"
  const rangePattern = new RegExp(
    `(?:between\\s+)?${CURRENCY}\\s?${AMOUNT}\\s*(?:-|to|and)\\s*${CURRENCY}?\\s?${AMOUNT}\\s*${BASIS}`,
    "gi"
  );

  for (const match of text.matchAll(rangePattern)) {
    const start = match.index!;
    const end = start + match[0].length;

    if (isClaimed(start, end)) continue;

    const { currency, currencySymbol } = currencyMeta(match[1]);
    const basisWord = match[5];

    entities.push({
      kind: "price",
      start,
      end,
      raw: match[0],
      amount: parseNum(match[2]),
      amountMax: parseNum(match[4]),
      currency,
      currencySymbol,
      basis: basisWord ? "per_unit" : null,
      type: "range",
      priority: 2,
      confidence: "high",
    });
    claim(start, end);
  }

  // Ceiling: "under ₹12 per box", "below $20", "max ₹500"
  const maxPattern = new RegExp(
    `\\b(?:under|below|less than|maximum|max|up to)\\s*${CURRENCY}\\s?${AMOUNT}\\s*${BASIS}`,
    "gi"
  );

  for (const match of text.matchAll(maxPattern)) {
    const start = match.index!;
    const end = start + match[0].length;

    if (isClaimed(start, end)) continue;

    const { currency, currencySymbol } = currencyMeta(match[1]);
    const basisWord = match[3];

    entities.push({
      kind: "price",
      start,
      end,
      raw: match[0],
      amount: parseNum(match[2]),
      amountMax: null,
      currency,
      currencySymbol,
      basis: basisWord ? "per_unit" : "total_budget",
      type: "maximum",
      priority: 2,
      confidence: "high",
    });
    claim(start, end);
  }

  // Explicit total-budget phrase, currency optional in the phrase itself
  // (e.g. "budget of 50000").
  const budgetPattern = new RegExp(
    `\\b(?:total\\s+)?budget(?:\\s+of)?\\s*(?:is)?\\s*${CURRENCY}?\\s?${AMOUNT}`,
    "gi"
  );

  for (const match of text.matchAll(budgetPattern)) {
    const start = match.index!;
    const end = start + match[0].length;

    if (isClaimed(start, end)) continue;

    const { currency, currencySymbol } = match[1]
      ? currencyMeta(match[1])
      : { currency: null, currencySymbol: null };

    entities.push({
      kind: "price",
      start,
      end,
      raw: match[0],
      amount: parseNum(match[2]),
      amountMax: null,
      currency,
      currencySymbol,
      basis: "total_budget",
      type: "target",
      priority: 2,
      confidence: currency ? "high" : "medium",
    });
    claim(start, end);
  }

  // Bare currency + amount, optionally with a per-unit basis — lowest
  // priority within pricing so the more specific patterns above get
  // first claim on the same digits.
  const barePattern = new RegExp(`${CURRENCY}\\s?${AMOUNT}\\s*${BASIS}`, "gi");

  for (const match of text.matchAll(barePattern)) {
    const start = match.index!;
    const end = start + match[0].length;

    if (isClaimed(start, end)) continue;

    const { currency, currencySymbol } = currencyMeta(match[1]);
    const basisWord = match[3];

    entities.push({
      kind: "price",
      start,
      end,
      raw: match[0],
      amount: parseNum(match[2]),
      amountMax: null,
      currency,
      currencySymbol,
      basis: basisWord ? "per_unit" : null,
      type: "target",
      priority: 2,
      confidence: "medium",
    });
    claim(start, end);
  }

  return entities;
}

// ---------------------------------------------------------------------
// Priority 3 — delivery timeframe & urgency.
// ---------------------------------------------------------------------
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function resolveAbsoluteDate(monthName: string, day: number, year: number | null, referenceDate: Date): string | null {
  const monthIndex = MONTHS.indexOf(monthName.toLowerCase());

  if (monthIndex === -1 || day < 1 || day > 31) return null;

  const refYear = referenceDate.getFullYear();
  let resolvedYear = year ?? refYear;

  if (!year) {
    const candidate = new Date(refYear, monthIndex, day);

    if (candidate.getTime() < referenceDate.getTime()) {
      resolvedYear = refYear + 1;
    }
  }

  const date = new Date(resolvedYear, monthIndex, day);

  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

function extractDateEntities(text: string, referenceDate: Date): DateEntity[] {
  const entities: DateEntity[] = [];

  for (const match of text.matchAll(
    /\bwithin\s+(?:the\s+next\s+)?(\d+)\s*(day|days|week|weeks|month|months)\b/gi
  )) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const days = unit.startsWith("week") ? amount * 7 : unit.startsWith("month") ? amount * 30 : amount;

    entities.push({
      kind: "date",
      start: match.index!,
      end: match.index! + match[0].length,
      raw: match[0],
      timeframeKind: "relative",
      relativeDays: days,
      absoluteDate: null,
      priority: 3,
      confidence: "high",
    });
  }

  for (const match of text.matchAll(/\bin\s+(\d+)\s*(day|days|week|weeks|month|months)\b/gi)) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const days = unit.startsWith("week") ? amount * 7 : unit.startsWith("month") ? amount * 30 : amount;

    entities.push({
      kind: "date",
      start: match.index!,
      end: match.index! + match[0].length,
      raw: match[0],
      timeframeKind: "relative",
      relativeDays: days,
      absoluteDate: null,
      priority: 3,
      confidence: "high",
    });
  }

  for (const match of text.matchAll(/\bwithin\s+the\s+next\s+(day|week|month)\b/gi)) {
    const unit = match[1].toLowerCase();
    const days = unit === "week" ? 7 : unit === "month" ? 30 : 1;

    entities.push({
      kind: "date",
      start: match.index!,
      end: match.index! + match[0].length,
      raw: match[0],
      timeframeKind: "relative",
      relativeDays: days,
      absoluteDate: null,
      priority: 3,
      confidence: "medium",
    });
  }

  for (const match of text.matchAll(
    /\bby\s+(?:the\s+)?([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/gi
  )) {
    const monthName = match[1];

    if (MONTHS.indexOf(monthName.toLowerCase()) === -1) continue;

    const day = Number(match[2]);
    const year = match[3] ? Number(match[3]) : null;
    const absoluteDate = resolveAbsoluteDate(monthName, day, year, referenceDate);

    entities.push({
      kind: "date",
      start: match.index!,
      end: match.index! + match[0].length,
      raw: match[0],
      timeframeKind: "absolute",
      relativeDays: null,
      absoluteDate,
      priority: 3,
      confidence: year ? "high" : "medium",
    });
  }

  for (const match of text.matchAll(
    /\bby\s+(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g
  )) {
    entities.push({
      kind: "date",
      start: match.index!,
      end: match.index! + match[0].length,
      raw: match[0],
      timeframeKind: "absolute",
      relativeDays: null,
      // Ambiguous day/month order (DD/MM vs MM/DD) without more context —
      // recorded as raw text rather than guessed into a specific ISO date.
      absoluteDate: null,
      priority: 3,
      confidence: "low",
    });
  }

  for (const match of text.matchAll(
    /\b(asap|as soon as possible|urgent(?:ly)?|immediately|right away)\b/gi
  )) {
    entities.push({
      kind: "date",
      start: match.index!,
      end: match.index! + match[0].length,
      raw: match[0],
      timeframeKind: "urgent",
      relativeDays: null,
      absoluteDate: null,
      priority: 3,
      confidence: "high",
    });
  }

  return entities;
}

// ---------------------------------------------------------------------
// Priority 3 — intended use / context. Captures an explicit "for
// <phrase>" clause as the buyer's own stated purpose ("for a new
// office", "for shipping cosmetics", "for our manufacturing unit") —
// never inferred from the product name itself. The clause is cut at the
// first word that clearly starts a DIFFERENT kind of clause (a
// delivery/location connector, a comma) so "for a new office in
// Bengaluru, delivered within 20 days" yields "a new office", not the
// location or timing riding along with it. Runs at the same priority as
// dates — before location/quantity — so its span (including the "for")
// is removed from the leftover text product derivation reads, instead
// of surviving as noise stuck to the product name.
// ---------------------------------------------------------------------
const INTENDED_USE_STOP_PATTERN =
  /[,.]|\b(?:in|delivered|deliver|shipped|ship|to|within|by|under|below|budget|near|at|via|using|with)\b/i;

// `claimedSpans` are the higher-confidence entities already found
// elsewhere (certifications, technical specs, price, dates, and —
// crucially — the keyword dictionary in extractKeywordEntities, which
// includes phrases like "reliable supplier" or "export capability").
// Without this check, "Looking for a reliable supplier for warehouse
// management services" would have this function's greedy "for ... "
// capture swallow "reliable supplier" whole and prevent it from ever
// being recognized as the capability keyword it actually is. A "for"
// clause that overlaps any already-claimed span is skipped entirely
// (not truncated) — safer to miss a use case than to steal territory
// from a more specific, dictionary-backed match.
function extractIntendedUse(
  text: string,
  claimedSpans: [number, number][]
): IntendedUseEntity[] {
  const entities: IntendedUseEntity[] = [];

  for (const match of text.matchAll(/\bfor\s+/gi)) {
    const start = match.index!;
    const afterFor = start + match[0].length;
    const rest = text.slice(afterFor);

    const stopMatch = rest.match(INTENDED_USE_STOP_PATTERN);
    const clause = stopMatch ? rest.slice(0, stopMatch.index) : rest;
    const trimmed = clause.trim();

    if (!trimmed) continue;
    // A "for" immediately followed by a currency/number is a price
    // clause ("for ₹12 each"), not a use case — skip it rather than
    // misreading it as intended use.
    if (/^[\d₹$]/.test(trimmed)) continue;
    // "for suppliers", "for me" alone aren't a use case worth surfacing
    // — require at least two real words of content.
    if (trimmed.split(/\s+/).filter(Boolean).length < 2) continue;

    const end = afterFor + clause.length;

    if (claimedSpans.some(([s, e]) => overlaps(start, end, s, e))) continue;

    entities.push({
      kind: "intended_use",
      start,
      end,
      raw: text.slice(start, end).trim(),
      value: trimmed,
      priority: 3,
      confidence: "medium",
    });
  }

  return entities;
}

// ---------------------------------------------------------------------
// Priority 4 — delivery location. Dictionary-matched so it's a real
// entity with its own span (including a leading connector word like
// "in"/"near"/"at" when present) rather than something later scraped out
// of whatever text happens to be left over — that's what keeps "custom
// boxes in Bengaluru" from leaving "in Bengaluru" stuck to the product.
// ---------------------------------------------------------------------
const LOCATIONS = [
  "Bangalore", "Bengaluru", "Mumbai", "Delhi", "New Delhi", "Hyderabad",
  "Chennai", "Pune", "Kolkata", "Ahmedabad", "Mysore", "Mysuru", "Noida",
  "Gurgaon", "Gurugram", "Jaipur", "Coimbatore", "Surat", "Nagpur",
  "Indore", "Kochi", "Cochin", "Chandigarh", "Lucknow", "Vadodara",
  "Karnataka", "Maharashtra", "Tamil Nadu", "Gujarat", "India",
];

function extractLocationEntities(text: string): LocationEntity[] {
  const entities: LocationEntity[] = [];
  const sorted = [...LOCATIONS].sort((a, b) => b.length - a.length);

  for (const location of sorted) {
    const withConnector = new RegExp(
      `\\b(?:delivered\\s+to|delivery\\s+to|shipped\\s+to|deliver\\s+to|ship\\s+to|in|at|near|from|to|within)\\s+(${location})\\b`,
      "gi"
    );

    for (const match of text.matchAll(withConnector)) {
      entities.push({
        kind: "location",
        start: match.index!,
        end: match.index! + match[0].length,
        raw: match[0],
        value: location,
        priority: 4,
        confidence: "high",
      });
    }

    const bare = new RegExp(`\\b(${location})\\b`, "gi");

    for (const match of text.matchAll(bare)) {
      entities.push({
        kind: "location",
        start: match.index!,
        end: match.index! + match[0].length,
        raw: match[0],
        value: location,
        priority: 4,
        confidence: "medium",
      });
    }
  }

  return entities;
}

// ---------------------------------------------------------------------
// Priority 5 — quantity. A quantity claim is a NUMBER, not the whole
// "number + unit" phrase — the counting-unit word (e.g. "boxes") is left
// untouched in the source text so it can still surface as part of the
// product noun phrase later ("10,000 boxes" -> quantity 10000, and
// "boxes" remains available for product derivation instead of being
// deleted along with the number). Any candidate number that overlaps a
// span a higher-priority matcher (certification, technical spec, price,
// date) already claimed is skipped entirely — that's what stops
// "5-ply", "304 stainless steel", "99.9%", "ISO 9001", and "₹12 per box"
// from ever being read as a quantity. The unit itself is found by
// looking ahead from the number for the nearest counting-unit word,
// which is what lets "10,000 recyclable 5-ply corrugated boxes" still
// pair 10,000 with "boxes" despite the adjectives in between.
// ---------------------------------------------------------------------
const QUANTITY_UNITS =
  "units?|pieces?|pcs?|boxes?|items?|sets?|chairs?|tables?|kgs?|kilograms?|tons?|tonnes?|litres?|liters?|packs?|cartons?|rolls?|sheets?|bags?|bottles?|nos\\.?|pallets?|cases?|reams?|dozens?|crates?";

const QUANTITY_UNIT_PATTERN = new RegExp(`\\b(${QUANTITY_UNITS})\\b`, "i");
// Only a token that IS a number (ignoring trailing punctuation) stops the
// lookahead — a token that merely contains a digit as part of a compound
// spec like "5-ply" must not, or the search would give up before ever
// reaching the real unit word further along ("10,000 recyclable 5-ply
// corrugated boxes" would otherwise stop dead at "5-ply").
const STANDALONE_NUMBER_PATTERN = /^\d[\d,]*(?:\.\d+)?$/;
const LOOKAHEAD_WORD_LIMIT = 8;
// Words that end the immediate noun phrase following a quantity number —
// once one of these is hit, whatever word came right before it is taken
// as the best guess for the phrase's head noun (see the fallback below).
const LOOKAHEAD_STOP_WORDS = new Set([
  "with", "for", "under", "by", "within", "delivered", "delivery",
  "shipped", "deliver", "ship", "to", "from", "of", "and", "near", "at",
  "in", "on",
]);

function extractQuantityEntities(
  text: string,
  claimedSpans: [number, number][]
): QuantityEntity[] {
  const entities: QuantityEntity[] = [];
  const numberPattern = /\b\d[\d,]*(?:\.\d+)?\b/g;

  for (const match of text.matchAll(numberPattern)) {
    const start = match.index!;
    const end = start + match[0].length;

    if (claimedSpans.some(([s, e]) => overlaps(start, end, s, e))) continue;

    // Look ahead word-by-word for the nearest counting-unit noun,
    // stopping if another number is reached first (that number gets its
    // own, separate pairing attempt).
    const rest = text.slice(end);
    const words = rest.trim().split(/\s+/).slice(0, LOOKAHEAD_WORD_LIMIT);

    let unit: string | null = null;
    let unitIsDictionaryMatch = false;
    // Running "last content word seen" — if the lookahead never finds a
    // dictionary unit before hitting a phrase-ending stop word (or the
    // word limit), this is the best available guess for the head noun of
    // the quantified phrase, e.g. "mailers" in "7500 biodegradable
    // 3-layer kraft paper mailers with custom branding". It's an
    // inference rather than a dictionary hit, so it's recorded at lower
    // confidence.
    let fallbackUnit: string | null = null;

    for (const word of words) {
      const strippedWord = word.replace(/[.,;:]+$/, "");

      if (STANDALONE_NUMBER_PATTERN.test(strippedWord)) break;

      const unitMatch = word.match(QUANTITY_UNIT_PATTERN);

      if (unitMatch) {
        unit = unitMatch[1].toLowerCase();
        unitIsDictionaryMatch = true;
        break;
      }

      if (LOOKAHEAD_STOP_WORDS.has(strippedWord.toLowerCase())) break;

      if (strippedWord) fallbackUnit = strippedWord.toLowerCase();
    }

    if (!unit && fallbackUnit) unit = fallbackUnit;

    entities.push({
      kind: "quantity",
      start,
      end,
      raw: match[0],
      amount: parseNum(match[0]),
      unit: unit ?? "",
      priority: 5,
      confidence: unitIsDictionaryMatch ? "high" : "medium",
    });
  }

  return entities;
}

// ---------------------------------------------------------------------
// Keyword categories — adjectives/phrases, not numeric, so they don't
// compete with the spans above for overlap resolution in practice.
// Still routed through the same priority system for consistency.
// ---------------------------------------------------------------------
const KEYWORD_DICTIONARY: { category: KeywordCategory; phrases: string[] }[] = [
  {
    category: "quality",
    phrases: [
      "premium quality", "high quality", "good quality", "industrial grade",
      "commercial grade", "food grade", "medical grade", "export quality",
      "durable",
    ],
  },
  {
    category: "sustainability",
    phrases: ["eco-friendly", "eco friendly", "biodegradable", "recyclable", "sustainable", "compostable"],
  },
  {
    category: "customization",
    phrases: [
      "custom printing", "custom branding", "custom size", "customized",
      "private label", "custom",
    ],
  },
  {
    category: "packaging",
    phrases: [
      "gift wrapped", "gift wrapping", "retail ready", "bulk packaging",
      "individually packed", "shrink wrapped", "palletized",
    ],
  },
  {
    category: "shipping",
    phrases: [
      "express shipping", "air freight", "sea freight", "door delivery",
      "white glove delivery", "fragile handling",
    ],
  },
  {
    category: "capability",
    phrases: [
      "reliable supplier", "verified supplier", "export capability",
      "in-house printing", "own fleet", "24/7 support",
      "automatic tool changer", "automatic tool changers",
    ],
  },
  {
    category: "payment_terms",
    phrases: [
      "net 30", "net 15", "on delivery", "cash on delivery",
      "50% advance", "25% advance", "advance payment", "letter of credit",
    ],
  },
];

function extractKeywordEntities(text: string): KeywordEntity[] {
  const entities: KeywordEntity[] = [];

  for (const { category, phrases } of KEYWORD_DICTIONARY) {
    const sorted = [...phrases].sort((a, b) => b.length - a.length);

    for (const phrase of sorted) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\b${escaped}\\b`, "gi");

      for (const match of text.matchAll(pattern)) {
        entities.push({
          kind: category,
          start: match.index!,
          end: match.index! + match[0].length,
          raw: match[0],
          value: phrase,
          priority: 6,
          confidence: "high",
        });
      }
    }
  }

  return entities;
}

// ---------------------------------------------------------------------
// Material — a lookup, not a span-priority participant. It never claims
// territory for product-removal purposes (a bare material adjective like
// "corrugated" reads as part of the product noun phrase — "corrugated
// boxes" — rather than something that should be stripped out of it).
// ---------------------------------------------------------------------
const MATERIALS = [
  "corrugated fibreboard", "corrugated fiberboard", "corrugated",
  "kraft paper", "cardboard", "stainless steel", "aluminum", "aluminium",
  "polypropylene", "polyethylene", "plastic", "wooden", "wood", "glass",
  "cotton", "leather", "rubber", "ceramic", "fabric", "steel", "titanium",
  "brass", "copper", "paper",
];

export function extractMaterial(text: string): { value: string; raw: string } | null {
  const sorted = [...MATERIALS].sort((a, b) => b.length - a.length);

  for (const material of sorted) {
    const pattern = new RegExp(`\\b${material.replace(/\s+/g, "\\s+")}\\b`, "i");
    const match = text.match(pattern);

    if (match) {
      return {
        value: material.charAt(0).toUpperCase() + material.slice(1),
        raw: match[0],
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------
// Overlap resolution — sort every collected entity by priority then by
// position, and greedily accept a span only if it doesn't collide with
// one already accepted. This single pass (not per-category) is what
// makes precedence explicit and independent of matcher execution order.
// ---------------------------------------------------------------------
export function resolveOverlaps(entities: Entity[]): Entity[] {
  const sorted = [...entities].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.start - b.start;
  });

  const accepted: Entity[] = [];

  for (const entity of sorted) {
    const collides = accepted.some((existing) =>
      overlaps(entity.start, entity.end, existing.start, existing.end)
    );

    if (!collides) accepted.push(entity);
  }

  return accepted.sort((a, b) => a.start - b.start);
}

export function extractAllEntities(
  text: string,
  referenceDate: Date
): Entity[] {
  // Higher-priority categories run first — quantity extraction needs
  // their spans to know which numbers are already spoken for (a cert
  // code, a technical spec, a price, a date, or a digit-bearing keyword
  // phrase like "net 30" or "50% advance") before it goes looking for
  // bare quantity numbers. Keyword phrases are included here (not just
  // the numeric categories) specifically because some of them contain
  // digits themselves.
  const dictionaryBacked = resolveOverlaps([
    ...extractCertifications(text),
    ...extractTechnicalSpecs(text),
    ...extractPriceEntities(text),
    ...extractDateEntities(text, referenceDate),
    ...extractKeywordEntities(text),
  ]);

  // Intended-use runs against what's left after every dictionary-backed
  // match above — see extractIntendedUse's comment on why a keyword
  // phrase like "reliable supplier" must win a territory dispute with a
  // generic "for ..." clause, not lose to it.
  const dictionaryClaimedSpans: [number, number][] = dictionaryBacked.map(
    (e) => [e.start, e.end]
  );
  const higherPriority = resolveOverlaps([
    ...dictionaryBacked,
    ...extractIntendedUse(text, dictionaryClaimedSpans),
  ]);

  const claimedSpans: [number, number][] = higherPriority.map((e) => [
    e.start,
    e.end,
  ]);

  const raw: Entity[] = [
    ...higherPriority,
    ...extractLocationEntities(text),
    ...extractQuantityEntities(text, claimedSpans),
  ];

  return resolveOverlaps(raw);
}
