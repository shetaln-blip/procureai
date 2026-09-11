import type { SearchCriteria } from "../matching";
import { getSupplierRepository } from "../supplier-store";
import type { Supplier } from "../supplier-types";
import {
  ensureMossIndexLoaded,
  getMossClient,
  isMossConfigured,
  isMossEnabled,
  isMossEnabledFlag,
  readMossConfig,
  withTimeout,
} from "./client";
import {
  classifyMossFailure,
  mossErrorMessage,
  publicMossError,
} from "./errors";
import { buildMossQuerySpec } from "./query";
import {
  emptyRetrievalMeta,
  supplierIdFromDocumentId,
  type MossHit,
  type RetrievalMeta,
} from "./types";

export type MossSearchBackend = {
  query(indexName: string, text: string, options: { topK: number; alpha: number }): Promise<MossHit[]>;
};

let searchBackend: MossSearchBackend | null = null;

export function setMossSearchBackend(backend: MossSearchBackend | null): void {
  searchBackend = backend;
}

async function queryMossHits(
  indexName: string,
  text: string,
  topK: number,
  alpha: number,
  timeoutMs: number
): Promise<MossHit[]> {
  if (searchBackend) {
    return searchBackend.query(indexName, text, { topK, alpha });
  }

  await ensureMossIndexLoaded(indexName);

  const result = await withTimeout(
    getMossClient().query(indexName, text, { topK, alpha }),
    timeoutMs,
    "Moss query timed out."
  );

  return result.docs.map((doc) => ({
    documentId: doc.id,
    supplierId:
      supplierIdFromDocumentId(doc.id) ??
      (doc.metadata?.supplierId ? Number(doc.metadata.supplierId) : null),
    score: doc.score,
  }));
}

async function loadCatalog(): Promise<Supplier[]> {
  return getSupplierRepository().searchSuppliers();
}

function hydrateHits(
  hits: MossHit[],
  catalog: Supplier[]
): {
  suppliers: Supplier[];
  mossScores: Record<number, number>;
  discardedStaleIds: number;
  uniqueCandidateIds: number;
} {
  const byId = new Map(catalog.map((supplier) => [supplier.id, supplier]));
  const seen = new Set<number>();
  const suppliers: Supplier[] = [];
  const mossScores: Record<number, number> = {};
  let discardedStaleIds = 0;

  for (const hit of hits) {
    const supplierId =
      hit.supplierId !== null && Number.isFinite(hit.supplierId)
        ? hit.supplierId
        : supplierIdFromDocumentId(hit.documentId);

    if (supplierId === null) {
      discardedStaleIds += 1;
      continue;
    }

    if (seen.has(supplierId)) continue;

    seen.add(supplierId);
    mossScores[supplierId] = hit.score;

    const supplier = byId.get(supplierId);

    if (!supplier) {
      discardedStaleIds += 1;
      continue;
    }

    suppliers.push(supplier);
  }

  return {
    suppliers,
    mossScores,
    discardedStaleIds,
    uniqueCandidateIds: seen.size,
  };
}

export async function recallSuppliers(
  criteria: SearchCriteria
): Promise<{ suppliers: Supplier[]; retrieval: RetrievalMeta }> {
  const catalog = await loadCatalog();

  if (!isMossEnabledFlag()) {
    return {
      suppliers: catalog,
      retrieval: emptyRetrievalMeta({ method: "catalog_scan" }),
    };
  }

  if (!isMossConfigured()) {
    return {
      suppliers: catalog,
      retrieval: emptyRetrievalMeta({
        method: "catalog_scan",
        fallback: true,
        fallbackReason: "missing_configuration",
        error: "Moss is not fully configured.",
      }),
    };
  }

  const config = readMossConfig();

  if (!config || !isMossEnabled()) {
    return {
      suppliers: catalog,
      retrieval: emptyRetrievalMeta({
        method: "catalog_scan",
        fallback: true,
        fallbackReason: "missing_configuration",
        error: "Moss is not fully configured.",
      }),
    };
  }

  const spec = buildMossQuerySpec(criteria);

  if (!spec.text) {
    return {
      suppliers: catalog,
      retrieval: emptyRetrievalMeta({
        method: "catalog_scan",
        fallback: true,
        fallbackReason: "empty_results",
        error: "No structured retrieval query could be built.",
      }),
    };
  }

  try {
    const hits = await queryMossHits(
      config.indexName,
      spec.text,
      spec.topK,
      spec.alpha,
      config.queryTimeoutMs
    );

    const hydrated = hydrateHits(hits, catalog);

    if (hydrated.suppliers.length === 0) {
      return {
        suppliers: catalog,
        retrieval: emptyRetrievalMeta({
          method: "catalog_scan",
          mossCandidates: hydrated.uniqueCandidateIds,
          hydrated: 0,
          discardedStaleIds: hydrated.discardedStaleIds,
          fallback: true,
          fallbackReason: "empty_results",
          error: "Moss returned no hydratable suppliers.",
          mossScores: hydrated.mossScores,
        }),
      };
    }

    return {
      suppliers: hydrated.suppliers,
      retrieval: emptyRetrievalMeta({
        method: "moss",
        mossCandidates: hydrated.uniqueCandidateIds,
        hydrated: hydrated.suppliers.length,
        discardedStaleIds: hydrated.discardedStaleIds,
        fallback: false,
        mossScores: hydrated.mossScores,
      }),
    };
  } catch (error) {
    console.error("Moss retrieval failed; using catalog scan:", mossErrorMessage(error));

    return {
      suppliers: catalog,
      retrieval: emptyRetrievalMeta({
        method: "catalog_scan",
        fallback: true,
        fallbackReason: classifyMossFailure(error),
        error: publicMossError(error),
      }),
    };
  }
}
