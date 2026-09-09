import { promises as fs } from "fs";
import path from "path";
import type { Supplier } from "./supplier-types";

// Repository abstraction over supplier master data. FileSupplierRepository
// below is the only implementation that exists today (a single JSON file,
// same pattern as lib/store.ts for RFQs), but every caller — the search
// API route, ingestion scripts, future admin tooling — goes through the
// SupplierRepository interface. Moving to Postgres/Supabase later means
// writing one new class that implements this interface; nothing that
// calls getSupplierRepository() needs to change.
export interface SupplierRepository {
  listSuppliers(): Promise<Supplier[]>;
  getSupplier(id: number): Promise<Supplier | null>;
  // Returns the full working set for a search. At today's scale a full
  // read is fine — lib/matching.ts does the filtering/ranking. Once this
  // moves to a real database, this is where a WHERE/ILIKE/vector query
  // would go so we stop pulling every row for every search.
  searchSuppliers(): Promise<Supplier[]>;
  saveSupplier(supplier: Supplier): Promise<void>;
}

const DATA_FILE = path.join(process.cwd(), "data", "suppliers.json");
// Per-category ingestion batches (data/suppliers/office-furniture.json,
// data/suppliers/cnc-machines.json, etc.) live alongside the original
// single-file catalog above. Splitting by category lets each batch be
// sourced, reviewed, and re-run independently instead of one script
// rewriting a single ever-growing file. listSuppliers() below combines
// every file transparently — every other caller (search, tests, the
// dedup/normalize pipeline) keeps working against one flat Supplier[]
// and never needs to know how many files that came from.
//
// Ids must stay globally unique WITHOUT being reassigned on every read,
// because a Supplier's numeric id is also RFQ.vendorId — a value stored
// permanently in existing RFQ records. Re-keying ids by array position
// on each load (an earlier version of this file did that) would silently
// repoint old RFQs at a different supplier the moment a new category file
// was added or an existing file's record count changed. Instead, each
// per-category ingestion script is given a fixed id block to seed its
// `existingIds` baseline from (see scripts/import-*-batch.ts), so ids
// never collide across files by construction:
//   data/suppliers.json (legacy packaging batch)  ->  1     - 999
//   office-furniture.json                          ->  1000  - 1999
//   industrial-machinery.json                       ->  2000  - 2999
//   cnc-machines.json                               ->  3000  - 3999
//   electronics-pcb.json                            ->  4000  - 4999
//   chemicals-materials.json                        ->  5000  - 5999
//   electrical-equipment.json                       ->  6000  - 6999
//   it-hardware.json                                ->  7000  - 7999
//   safety-equipment.json                           ->  8000  - 8999
//   logistics.json                                  ->  9000  - 9999
//   raw-materials.json                              -> 10000 - 10999
//   construction-materials.json                     -> 11000 - 11999
//   laboratory-equipment.json                       -> 12000 - 12999
//   food-agriculture.json                           -> 13000 - 13999
const DATA_DIR = path.join(process.cwd(), "data", "suppliers");

async function readSupplierFile(filePath: string): Promise<Supplier[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed?.suppliers) ? parsed.suppliers : [];
  } catch {
    return [];
  }
}

class FileSupplierRepository implements SupplierRepository {
  async listSuppliers(): Promise<Supplier[]> {
    const fromLegacyFile = await readSupplierFile(DATA_FILE);

    let categoryFiles: string[] = [];
    try {
      const entries = await fs.readdir(DATA_DIR);
      categoryFiles = entries
        .filter((name) => name.endsWith(".json"))
        .sort();
    } catch {
      categoryFiles = [];
    }

    const fromCategoryFiles = (
      await Promise.all(
        categoryFiles.map((name) => readSupplierFile(path.join(DATA_DIR, name)))
      )
    ).flat();

    const combined = [...fromLegacyFile, ...fromCategoryFiles];

    // Ids come straight from the files (see the id-block scheme above) —
    // no renumbering here, so a supplier's id (and any RFQ.vendorId that
    // references it) stays stable across reads regardless of which other
    // category files exist. Duplicate ids would mean an ingestion script
    // used the wrong block; surface that loudly rather than silently
    // letting one supplier shadow another.
    const seen = new Map<number, string>();
    for (const supplier of combined) {
      const previous = seen.get(supplier.id);
      if (previous) {
        console.warn(
          `[supplier-store] duplicate supplier id ${supplier.id}: "${previous}" and "${supplier.identity.companyName}" — check the id-block assignment for the file that introduced this record.`
        );
      } else {
        seen.set(supplier.id, supplier.identity.companyName);
      }
    }

    return combined;
  }

  async getSupplier(id: number): Promise<Supplier | null> {
    const suppliers = await this.listSuppliers();

    return suppliers.find((supplier) => supplier.id === id) ?? null;
  }

  async searchSuppliers(): Promise<Supplier[]> {
    return this.listSuppliers();
  }

  async saveSupplier(supplier: Supplier): Promise<void> {
    // Only ever reads/writes the legacy single-file catalog, never the
    // per-category files — this method has no callers today, but if one
    // shows up later it must not silently duplicate a category-file
    // supplier into data/suppliers.json (that would create a second,
    // divergent copy sharing the same id the next time listSuppliers()
    // combines everything). A supplier that actually lives in a category
    // file should be edited by re-running that category's ingestion
    // script instead.
    const legacySuppliers = await readSupplierFile(DATA_FILE);
    const index = legacySuppliers.findIndex((item) => item.id === supplier.id);

    if (index >= 0) {
      legacySuppliers[index] = supplier;
    } else if (supplier.id >= 1000) {
      console.warn(
        `[supplier-store] saveSupplier() called for id ${supplier.id}, which falls in a category-file id block, not the legacy file. Ignoring — edit the owning data/suppliers/*.json file (via its ingestion script) instead.`
      );
      return;
    } else {
      legacySuppliers.push(supplier);
    }

    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(
      DATA_FILE,
      JSON.stringify({ suppliers: legacySuppliers }, null, 2),
      "utf-8"
    );
  }
}

let repository: SupplierRepository = new FileSupplierRepository();

export function getSupplierRepository(): SupplierRepository {
  return repository;
}

// Test/ingestion hook — lets a future script or test swap in a different
// repository implementation without changing any callers.
export function setSupplierRepository(repo: SupplierRepository): void {
  repository = repo;
}
