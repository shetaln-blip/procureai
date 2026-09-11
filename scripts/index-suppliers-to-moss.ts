// Indexes the complete ProcureAI supplier repository into Moss.
// Run from a machine with Moss credentials — never from a request handler.
//
//   npx tsx scripts/index-suppliers-to-moss.ts
import { getSupplierRepository } from "../lib/supplier-store";
import { getMossClient, isMossConfigured, readMossConfig } from "../lib/moss/client";
import { mossDocumentsFromSuppliers } from "../lib/moss/documents";

const UPSERT_BATCH_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

async function indexExists(indexName: string): Promise<boolean> {
  const client = getMossClient();
  const indexes = await client.listIndexes();

  return indexes.some((index) => index.name === indexName);
}

async function main() {
  if (!isMossConfigured()) {
    console.error(
      "Moss is not configured. Set MOSS_PROJECT_ID, MOSS_PROJECT_KEY, and MOSS_INDEX_NAME."
    );
    process.exit(1);
  }

  const config = readMossConfig();

  if (!config) {
    console.error("Moss is not configured.");
    process.exit(1);
  }

  const suppliers = await getSupplierRepository().listSuppliers();
  const documents = mossDocumentsFromSuppliers(suppliers);
  const skippedDuplicates = suppliers.length - documents.length;

  console.log(`Loaded ${suppliers.length} suppliers from the JSON repository.`);
  console.log(
    `Prepared ${documents.length} Moss documents with stable ids (supplier-{id}).`
  );

  if (skippedDuplicates > 0) {
    console.warn(`Skipped ${skippedDuplicates} duplicate supplier id(s).`);
  }

  const client = getMossClient();
  const exists = await indexExists(config.indexName);

  if (!exists) {
    console.log(`Creating Moss index "${config.indexName}" with model ${config.modelId}...`);

    const created = await client.createIndex(config.indexName, documents, {
      modelId: config.modelId,
    });

    console.log(
      `Created index "${created.indexName}" with ${created.docCount} documents (job ${created.jobId}).`
    );
  } else {
    console.log(`Index "${config.indexName}" already exists — upserting documents, not recreating.`);

    let upserted = 0;

    for (const batch of chunk(documents, UPSERT_BATCH_SIZE)) {
      const result = await client.addDocs(config.indexName, batch, {
        upsert: true,
      });

      upserted += batch.length;
      console.log(
        `Upserted ${upserted}/${documents.length} documents (index now ${result.docCount}).`
      );
    }
  }

  console.log(`Indexed ${documents.length} supplier documents into Moss.`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown indexing error";

  console.error(`Indexing failed: ${message.replace(/moss_access_key_[a-zA-Z0-9_-]+/gi, "[redacted]")}`);
  process.exit(1);
});
