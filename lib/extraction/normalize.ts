// Stage 1 of the pipeline: normalization. Deliberately conservative — it
// only standardizes characters that are visually/semantically equivalent
// (dash variants, curly quotes, whitespace runs). It must NOT strip or
// rewrite punctuation that carries meaning (hyphens in "5-ply", decimals
// in "99.9%", commas in "10,000") — the entity extraction stage depends
// on that punctuation surviving intact.
export function normalizeQuery(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[‒–—―−]/g, "-") // en/em dash, minus sign -> hyphen
    .replace(/[‘’]/g, "'") // curly single quotes
    .replace(/[“”]/g, '"') // curly double quotes
    .replace(/\s+/g, " ")
    .trim();
}
