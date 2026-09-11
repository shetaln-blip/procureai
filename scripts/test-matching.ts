// Manual end-to-end check of the full pipeline:
//   raw query -> extraction (lib/extraction) -> legacy-adapter -> matching (lib/matching)
// against the REAL combined supplier repository (every data/suppliers
// JSON file, via lib/supplier-store.ts), for the 7
// requirement categories the audit asked to be tested. This is not an
// automated pass/fail suite (there's no "correct" ranking to assert
// against on real, sparse, publicly-sourced data) — it's here to
// visually confirm that different requests produce different rankings,
// and that the fallback/tiering behavior does the right thing when the
// dataset has no relevant suppliers.
//
// Run with: npx tsx scripts/test-matching.ts
import { extractProcurementRequirement } from "../lib/extraction/pipeline";
import { toLegacyRequirements } from "../lib/extraction/legacy-adapter";
import { matchSuppliers, type SearchCriteria } from "../lib/matching";
import { getSupplierRepository } from "../lib/supplier-store";

const QUERIES: { label: string; query: string }[] = [
  { label: "1. Corrugated packaging (specific: 5-ply)", query: "Need 5000 5-ply corrugated shipping boxes, delivered to Bengaluru" },
  { label: "1b. Corrugated packaging (specific: food grade, different)", query: "Looking for food grade corrugated boxes for mustard oil packaging, Bengaluru" },
  { label: "2. Office furniture", query: "We need 50 ergonomic office chairs for our Bengaluru office" },
  { label: "3. Industrial machinery", query: "Sourcing a CNC milling machine for our manufacturing unit" },
  { label: "4. Electronics/components", query: "Need 10,000 PCB circuit boards, ISO 9001 certified supplier" },
  { label: "5. Raw materials", query: "Procure 20 tons of 304 stainless steel sheets, 2mm thickness" },
  { label: "6. Very specific technical requirement", query: "Need triple wall 9-ply corrugated cartons, 1000 units, under ₹50 per box" },
  { label: "7. No relevant supplier in database", query: "Looking for a supplier of industrial robotic arms for our assembly line" },
];

async function loadSuppliers() {
  return getSupplierRepository().listSuppliers();
}

async function main() {
  const suppliers = await loadSuppliers();
  console.log(`Loaded ${suppliers.length} suppliers.\n`);

  const top5ByQuery: Record<string, string> = {};

  for (const { label, query } of QUERIES) {
    const result = extractProcurementRequirement(query);
    const legacy = toLegacyRequirements(result);

    const criteria: SearchCriteria = {
      product: legacy.product,
      quantity: legacy.quantity,
      location: legacy.location,
      budget: legacy.budget,
      deadline: legacy.deadline,
      quality: legacy.quality,
      additionalRequirements: legacy.additionalRequirements,
      structured: result.requirement,
    };

    const { suppliers: matched, meta } = matchSuppliers(suppliers, criteria);

    console.log(`=== ${label} ===`);
    console.log(`query: "${query}"`);
    console.log(
      `meta: strong=${meta.strong} potential=${meta.potential} weak=${meta.weak} noMatch=${meta.noMatch}` +
        (meta.message ? `\n  message: ${meta.message}` : "")
    );

    const shown = matched.filter((s) => s.tier !== "no_match").slice(0, 5);
    top5ByQuery[label] = shown.map((s) => s.identity.companyName).join(",");

    for (const s of shown) {
      console.log(
        `  [${s.tier.toUpperCase().padEnd(9)}] ${s.score}%  ${s.identity.companyName}  (${s.identity.location})`
      );
      console.log(`     product: ${s.capabilities.products.join("; ") || "(none)"}`);
      for (const r of s.reasons.slice(0, 4)) {
        console.log(`     ${r.type === "positive" ? "✓" : "⚠"} ${r.label}`);
      }
    }
    if (shown.length === 0) {
      console.log("  (no relevant suppliers shown)");
    }
    console.log("");
  }

  // Sanity check: the two packaging queries (1 and 1b) should NOT produce
  // an identical top-5 ranking, despite both being "corrugated boxes"
  // requests in the same broad category — that's the core "request-
  // dependent" property this redesign exists to deliver.
  const a = top5ByQuery["1. Corrugated packaging (specific: 5-ply)"];
  const b = top5ByQuery["1b. Corrugated packaging (specific: food grade, different)"];
  console.log("=== Differentiation check ===");
  console.log("Query 1 top5:", a);
  console.log("Query 1b top5:", b);
  console.log(a === b ? "FAIL: identical top-5 for two different packaging requests" : "PASS: rankings differ");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
