import type { Entity } from "./entities";

// Stage: product derivation. This is the direct fix for the old parser's
// corruption/duplication bug. The old code repeatedly ran `.replace()`
// against a string that earlier replacements had already mutated, so a
// later pattern could match leftover fragments of an earlier removal (or
// miss text that had shifted position) — that's how a spec or a location
// word could survive partially, or get chewed into the product string.
//
// Here, every entity was found against the SAME untouched source string
// (see entities.ts), so the "what's left" computation is a single
// complement pass: walk the accepted entity spans in order and collect
// only the text between them. No repeated mutation, no cascading
// side-effects between matchers.
export function deriveProductText(text: string, entities: Entity[]): string {
  const spans = [...entities]
    .map((entity) => [entity.start, entity.end] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  const parts: string[] = [];
  let cursor = 0;
  let sawLeadingChunk = false;

  for (const [start, end] of spans) {
    if (start > cursor) {
      const rawChunk = text.slice(cursor, start);
      // The very first gap (before any entity at all) is left alone at
      // its leading edge: it's where request phrases like "I need" or
      // "looking for" live, and those are stripped as a unit from the
      // final joined string below (LEADING_REQUEST_PHRASE /
      // LEADING_ACTION_PHRASE) rather than word-by-word here — trimming
      // connector words off this chunk would eat the "for" out of
      // "looking for" before that regex ever sees it.
      const isLeadingChunk = cursor === 0 && !sawLeadingChunk;
      const chunk = isLeadingChunk
        ? trimChunkTrailingEdge(rawChunk)
        : trimChunkEdges(rawChunk);

      if (chunk) parts.push(chunk);
      sawLeadingChunk = true;
    }

    cursor = Math.max(cursor, end);
  }

  if (cursor < text.length) {
    const chunk = trimChunkEdges(text.slice(cursor));
    if (chunk) parts.push(chunk);
  }

  return cleanupProductText(parts.join(" "));
}

// Words that only ever glue two entities together — prepositions,
// articles, "and" — and never carry procurement meaning on their own.
// Reused here (per gap-chunk) and by DANGLING_*_CONNECTORS below (on the
// fully-joined string), so the same list resolves both boundary cases:
// connectors stranded between two removed entities in the MIDDLE of the
// product text, and connectors stranded at the very edges of the whole
// derived phrase.
const CHUNK_CONNECTOR_WORDS = new Set([
  "of", "for", "with", "and", "in", "at", "by", "under", "to", "from",
  "a", "an", "the",
]);

function stripEdgePunctuation(word: string): string {
  return word.replace(/^[.,;:\-]+|[.,;:\-]+$/g, "");
}

// Trims a single gap-chunk (the leftover text between two accepted entity
// spans, or before the first / after the last one) from BOTH edges,
// dropping connector words and stray punctuation word-by-word until a
// real content word is hit. This is what fixes text stranded in the
// MIDDLE of the derived product phrase (e.g. "boxes with , certified"),
// which whole-string edge trimming (cleanupProductText) can never reach
// because that text isn't at the edge of the final joined string — only
// at the edge of its own chunk.
function trimChunkEdges(chunk: string): string {
  const words = chunk.trim().split(/\s+/).filter(Boolean);

  let startIdx = 0;
  while (startIdx < words.length) {
    const stripped = stripEdgePunctuation(words[startIdx]).toLowerCase();
    if (stripped === "" || CHUNK_CONNECTOR_WORDS.has(stripped)) {
      startIdx++;
    } else {
      break;
    }
  }

  let endIdx = words.length - 1;
  while (endIdx >= startIdx) {
    const stripped = stripEdgePunctuation(words[endIdx]).toLowerCase();
    if (stripped === "" || CHUNK_CONNECTOR_WORDS.has(stripped)) {
      endIdx--;
    } else {
      break;
    }
  }

  if (startIdx > endIdx) return "";

  const kept = words.slice(startIdx, endIdx + 1);
  kept[0] = stripEdgePunctuation(kept[0]);
  kept[kept.length - 1] = stripEdgePunctuation(kept[kept.length - 1]);

  return kept.filter(Boolean).join(" ");
}

// Same idea as trimChunkEdges, but only trims the TRAILING edge — used
// for the leading chunk (see deriveProductText) so a leading request
// phrase stays intact for LEADING_REQUEST_PHRASE / LEADING_ACTION_PHRASE
// to strip as a unit afterward.
function trimChunkTrailingEdge(chunk: string): string {
  const words = chunk.trim().split(/\s+/).filter(Boolean);

  let endIdx = words.length - 1;
  while (endIdx >= 0) {
    const stripped = stripEdgePunctuation(words[endIdx]).toLowerCase();
    if (stripped === "" || CHUNK_CONNECTOR_WORDS.has(stripped)) {
      endIdx--;
    } else {
      break;
    }
  }

  if (endIdx < 0) return "";

  const kept = words.slice(0, endIdx + 1);
  kept[kept.length - 1] = stripEdgePunctuation(kept[kept.length - 1]);

  return kept.filter(Boolean).join(" ");
}

const LEADING_REQUEST_PHRASE =
  /^(?:i\s+|we\s+|please\s+)?(?:need|want|require|am\s+looking\s+for|looking\s+for|are\s+looking\s+for|am\s+searching\s+for|searching\s+for)\s+/i;

const LEADING_ACTION_PHRASE =
  /^(?:please\s+)?(?:find|source|procure|purchase|buy|get)(?:\s+me)?\s+/i;

const DANGLING_LEADING_CONNECTORS =
  /^(?:(?:of|for|with|and|in|at|by|under|to|from|a|an|the)\s+)+/i;

const DANGLING_TRAILING_CONNECTORS =
  /(?:\s+(?:of|for|with|and|in|at|by|under|to|from|a|an|the))+$/i;

// "I need reliable packaging boxes from suppliers in India" should
// derive the product "Packaging Boxes," not "Packaging Boxes Suppliers"
// — "suppliers"/"vendors" name who the buyer is asking, never what
// they're buying, so a trailing mention of either (optionally preceded
// by "from"/an adjective like "reliable") is stripped from the very end
// of the derived phrase. Scoped to the trailing edge only, so a
// legitimate product that genuinely IS about suppliers/vendors
// (uncommon, but not this pipeline's business to rule out) survives
// anywhere else in the phrase.
const TRAILING_SUPPLIER_NOISE =
  /\s+(?:from\s+)?(?:reliable|verified|trusted|good|quality)?\s*(?:suppliers?|vendors?)\s*$/i;
const TRAILING_PREFERENCE_INTRO = /\s+i\s+want\s*$/i;

function cleanupProductText(text: string): string {
  let result = text.replace(/\s+/g, " ").trim();

  result = result.replace(LEADING_REQUEST_PHRASE, "");
  result = result.replace(LEADING_ACTION_PHRASE, "");

  // Strip dangling connector words left stranded at either edge once
  // the entities around them are gone (run twice — removing one
  // dangling connector can expose another right behind it, e.g. "with
  // and" after two adjacent specs are both removed), and the same for
  // trailing "from suppliers"/"vendors" noise — removing one can expose
  // a connector that was gluing it to the rest of the phrase.
  for (let i = 0; i < 2; i++) {
    result = result.replace(TRAILING_SUPPLIER_NOISE, "");
    result = result.replace(TRAILING_PREFERENCE_INTRO, "");
    result = result.replace(DANGLING_LEADING_CONNECTORS, "");
    result = result.replace(DANGLING_TRAILING_CONNECTORS, "");
  }

  result = result.replace(/^[\s,.\-]+|[\s,.\-]+$/g, "");
  result = result.replace(/\s+/g, " ").trim();

  return result;
}

// Title-cases a derived product phrase for display without touching
// technical tokens (keeps acronym-looking words like "PPF" or "GSM" as
// typed rather than mangling their casing).
export function formatProductLabel(product: string): string {
  return product
    .split(" ")
    .map((word) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      if (word.length === 0) return word;

      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}
