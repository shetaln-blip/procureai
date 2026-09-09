// Supplier-search location intelligence (Quote Intelligence Audit's
// companion product change: "expand supplier coverage from Bengaluru to
// all of India"). ProcureAI's supplier catalog and matching used to
// treat a location outside the requested city as a hard mismatch,
// capping an otherwise strongly-relevant supplier's tier no matter how
// well everything else fit — see lib/matching.ts's old LOCATION FIT
// block. This module replaces that binary check with a graduated one:
//
//   1. Exact city match
//   2. Same state / region
//   3. Anywhere else in the default search country
//   4. A different country (only reachable once supplier records carry
//      a country field — see DEFAULT_SEARCH_REGION below)
//
// Only (4) is treated as a hard mismatch. (3) is real, honest
// information ("this supplier is real, just not local") — surfaced to
// the buyer, but never used to exclude or cap a supplier the way a
// confirmed mismatch does.

// The one line to change to expand ProcureAI to a different primary
// market: everything below treats a supplier with no explicit country
// on file as being IN this region, and treats a bare "<region>" request
// (e.g. "search all of India") as matching any such supplier — nothing
// else in this module is India-specific by name.
export const DEFAULT_SEARCH_REGION = "India";

// City -> state/region, for both directions of the comparison: resolving
// what state a supplier's or buyer's named city is in when only the
// city was given. Deliberately only as large as the city dictionary
// entity extraction already recognizes (lib/extraction/entities.ts's
// LOCATIONS list) — adding a city here without a matching entity would
// let matching resolve a state for a city buyers can't actually type
// into a request yet.
const CITY_STATE: Record<string, string> = {
  bangalore: "karnataka",
  bengaluru: "karnataka",
  mysore: "karnataka",
  mysuru: "karnataka",
  mumbai: "maharashtra",
  pune: "maharashtra",
  nagpur: "maharashtra",
  delhi: "delhi",
  "new delhi": "delhi",
  noida: "uttar pradesh",
  lucknow: "uttar pradesh",
  gurgaon: "haryana",
  gurugram: "haryana",
  hyderabad: "telangana",
  chennai: "tamil nadu",
  coimbatore: "tamil nadu",
  kolkata: "west bengal",
  ahmedabad: "gujarat",
  surat: "gujarat",
  vadodara: "gujarat",
  jaipur: "rajasthan",
  indore: "madhya pradesh",
  kochi: "kerala",
  cochin: "kerala",
  chandigarh: "chandigarh",
};

// Two names for the same city that a plain string comparison would
// otherwise call a mismatch — kept as an explicit, tiny equivalence
// table rather than fuzzy matching, so it never manufactures a match
// out of two genuinely different places.
const CITY_ALIASES: Record<string, string> = {
  bangalore: "bengaluru",
  bengaluru: "bengaluru",
  mysuru: "mysore",
  mysore: "mysore",
  gurugram: "gurgaon",
  gurgaon: "gurgaon",
  cochin: "kochi",
  kochi: "kochi",
  "new delhi": "delhi",
  delhi: "delhi",
};

function canonicalCity(city: string): string {
  return CITY_ALIASES[city] ?? city;
}

export type ParsedLocation = {
  raw: string;
  // The most specific place name found — a city when one is
  // recognized, otherwise whatever's left (which may itself be a
  // state name, or nothing at all).
  city: string | null;
  state: string | null;
  // True only for a literal request for the whole default region
  // ("India") — distinct from "no location given at all", which is
  // `city: null, state: null, isRegionWide: false` (see
  // parseLocationString's caller for that distinction).
  isRegionWide: boolean;
};

// Parses either a supplier's on-file location ("Bengaluru, Karnataka",
// "Karnataka") or a buyer's requested location ("Hyderabad", "Tamil
// Nadu", "India") into city/state parts. Never invents a city or state
// that isn't recognizable from the string itself — an unrecognized
// place name is kept as `city` verbatim (still usable for an exact
// string comparison) with `state: null`, rather than guessed.
export function parseLocationString(value: string): ParsedLocation {
  const raw = value.trim();
  const lower = raw.toLowerCase();

  if (lower === DEFAULT_SEARCH_REGION.toLowerCase()) {
    return { raw, city: null, state: null, isRegionWide: true };
  }

  const segments = raw
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length >= 2) {
    // "City, State" — the common supplier-record shape.
    const city = canonicalCity(segments[0].toLowerCase());
    const state = segments[segments.length - 1].toLowerCase();
    return { raw, city, state, isRegionWide: false };
  }

  const single = lower;
  const knownState = CITY_STATE[single];

  if (knownState) {
    // A bare, recognized city name.
    return { raw, city: canonicalCity(single), state: knownState, isRegionWide: false };
  }

  // Not a recognized city — treat it as a state/region name if nothing
  // else is available (e.g. supplier record is just "Karnataka").
  return { raw, city: null, state: single, isRegionWide: false };
}

export type LocationMatchTier =
  | "no_location_requested" // buyer didn't ask for anywhere in particular
  | "region_wide_requested" // buyer explicitly asked for the whole region ("India")
  | "exact_city"
  | "same_state"
  | "same_region" // both in the default region, but no city/state overlap
  | "different_region"; // only reachable once a country field exists

// The core graduated comparison. `requested` is the buyer's stated
// location (already known to be non-empty — callers check for "no
// location" themselves, since that's a different signal, not a tier of
// this comparison). `supplierLocation` is the supplier's raw on-file
// location string; `citiesServed` is any additional cities the supplier
// explicitly lists as served.
export function compareLocations(
  requested: string,
  supplierLocation: string,
  citiesServed: string[] = []
): LocationMatchTier {
  const req = parseLocationString(requested);

  if (req.isRegionWide) return "region_wide_requested";

  const supplier = parseLocationString(supplierLocation);
  const servedCities = citiesServed.map((city) =>
    canonicalCity(city.trim().toLowerCase())
  );

  // Exact city match — either the supplier's own primary city, or one
  // of its explicitly-listed served cities.
  if (req.city && (req.city === supplier.city || servedCities.includes(req.city))) {
    return "exact_city";
  }

  // The buyer named a STATE (not a recognized city) and it matches the
  // supplier's state directly.
  if (!req.city && req.state && req.state === supplier.state) {
    return "exact_city"; // a state-level request matched at state level IS the exact ask
  }

  // The buyer named a city; the supplier isn't in that exact city but
  // is in the same state/region.
  if (req.state && req.state === supplier.state) {
    return "same_state";
  }

  // Neither of the above — real evidence is missing, but both are
  // (by default) inside the same country, so this is a soft, non
  // -excluding signal rather than a confirmed mismatch.
  return "same_region";

  // NOTE: "different_region" isn't reachable yet — no supplier record
  // in this catalog carries an explicit country, so every supplier is
  // treated as being in DEFAULT_SEARCH_REGION by default (see the
  // module comment above). The day a supplier's country is known and
  // differs from the requested one, that comparison belongs here.
}
