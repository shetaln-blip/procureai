import type { Supplier } from "./supplier-types";

// Duplicate detection for supplier records. The same real company will
// often show up under slightly different names across sources ("ABC
// Packaging", "ABC Packaging Pvt Ltd", "ABC Packaging India") — this module
// flags likely duplicates for review. It intentionally does NOT auto-merge
// anything: merging is a decision with real consequences (RFQ history,
// contact info, evidence from different sources) and should stay a
// human-reviewed step until there's a track record to trust it.

const LEGAL_SUFFIXES = [
  "private limited",
  "pvt ltd",
  "pvt. ltd.",
  "limited",
  "ltd",
  "llp",
  "incorporated",
  "inc",
  "industries",
  "enterprises",
  "india",
];

// Normalizes a company name into a comparison key: lowercase, strip legal
// suffixes and punctuation, collapse whitespace. "ABC Packaging Pvt Ltd"
// and "ABC Packaging India" both reduce to "abc packaging".
export function normalizeCompanyName(name: string): string {
  let normalized = name.toLowerCase().replace(/[.,()]/g, "");

  for (const suffix of LEGAL_SUFFIXES) {
    normalized = normalized.replace(new RegExp(`\\b${suffix}\\b`, "g"), "");
  }

  return normalized.replace(/\s+/g, " ").trim();
}

function domainOf(url: string | null): string | null {
  if (!url) return null;

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Stable key used to group records that are probably the same supplier.
// Combines the normalized name with the website domain (when available) —
// two records with different domains are kept apart even if the names are
// similar, since name collisions across unrelated companies do happen.
export function computeDedupeKey(supplier: Supplier): string {
  const domain = domainOf(supplier.identity.website);
  const name = normalizeCompanyName(supplier.identity.companyName);

  return domain ? `${name}::${domain}` : name;
}

export type DuplicateCandidate = {
  a: Supplier;
  b: Supplier;
  reason: string;
};

// Cheap token-overlap similarity — enough to flag likely duplicates for
// human review, not to auto-merge.
function nameSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let shared = 0;

  for (const token of tokensA) {
    if (tokensB.has(token)) shared += 1;
  }

  return shared / Math.max(tokensA.size, tokensB.size);
}

export function findPotentialDuplicates(
  suppliers: Supplier[]
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];

  for (let i = 0; i < suppliers.length; i++) {
    for (let j = i + 1; j < suppliers.length; j++) {
      const a = suppliers[i];
      const b = suppliers[j];

      const domainA = domainOf(a.identity.website);
      const domainB = domainOf(b.identity.website);

      if (domainA && domainB && domainA === domainB) {
        candidates.push({
          a,
          b,
          reason: `Same website domain (${domainA})`,
        });
        continue;
      }

      const similarity = nameSimilarity(
        normalizeCompanyName(a.identity.companyName),
        normalizeCompanyName(b.identity.companyName)
      );

      if (similarity >= 0.7) {
        candidates.push({
          a,
          b,
          reason: `Similar company name (${Math.round(
            similarity * 100
          )}% token overlap)`,
        });
      }
    }
  }

  return candidates;
}
