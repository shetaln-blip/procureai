// Moss retrieval types. This module is intentionally free of the Moss
// SDK so client components can import retrieval metadata without pulling
// credentials or native bindings into the browser bundle.

export const DEFAULT_MOSS_ALPHA = 0.55;
export const DEFAULT_MOSS_TOP_K = 60;
export const DEFAULT_MOSS_QUERY_TIMEOUT_MS = 15_000;

export type RetrievalMethod = "moss" | "catalog_scan";

export type RetrievalFallbackReason =
  | "disabled"
  | "missing_configuration"
  | "unauthorized"
  | "index_not_found"
  | "index_not_loaded"
  | "timeout"
  | "empty_results"
  | "error";

export type RetrievalMeta = {
  // How the candidate set was produced. Moss is recall only —
  // `method: "moss"` never means the suppliers are verified.
  method: RetrievalMethod;
  mossCandidates: number;
  hydrated: number;
  discardedStaleIds: number;
  // True only when Moss was attempted and the existing full-catalog
  // scan was used instead. A disabled configuration is the normal
  // catalog path, not a fallback.
  fallback: boolean;
  fallbackReason: RetrievalFallbackReason | null;
  // Safe, short explanation for operators/UI. Never contains secrets.
  error: string | null;
  // Moss similarity scores keyed by supplier id — diagnostic only.
  // Never used as the supplier match score.
  mossScores: Record<number, number>;
};

export type MossHit = {
  documentId: string;
  supplierId: number | null;
  score: number;
};

export type MossQuerySpec = {
  text: string;
  topK: number;
  alpha: number;
};

export function emptyRetrievalMeta(
  overrides: Partial<RetrievalMeta> = {}
): RetrievalMeta {
  return {
    method: "catalog_scan",
    mossCandidates: 0,
    hydrated: 0,
    discardedStaleIds: 0,
    fallback: false,
    fallbackReason: null,
    error: null,
    mossScores: {},
    ...overrides,
  };
}

export function documentIdForSupplier(id: number): string {
  return `supplier-${id}`;
}

export function supplierIdFromDocumentId(documentId: string): number | null {
  const match = /^supplier-(\d+)$/.exec(documentId);

  if (!match) return null;

  const id = Number(match[1]);

  return Number.isFinite(id) ? id : null;
}
