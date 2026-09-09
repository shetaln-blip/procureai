// One-off ingestion run: first real supplier batch — corrugated/packaging
// manufacturers in India, prioritizing Bengaluru/Karnataka. Every record
// here traces to a real, fetched public source (see SOURCES below); this
// script is intentionally NOT a template to fill with invented data.
//
// Run with: npx tsx scripts/import-packaging-batch.ts
// Replaces data/suppliers.json entirely (the 5 old placeholder records are
// being retired per explicit instruction, not merged with these).
import { promises as fs } from "fs";
import path from "path";
import {
  normalizeSupplierRecord,
  computeDataConfidence,
  type RawSupplierRecord,
} from "../lib/ingestion/normalize";
import { findPotentialDuplicates } from "../lib/dedup";
import type { Supplier } from "../lib/supplier-types";

// ---------------------------------------------------------------------
// SOURCES
// ---------------------------------------------------------------------
// 1. IndiaMART directory — "Corrugated Box Suppliers in Bengaluru" category
//    page. Fetched 2026-09-07. Gives: company name, city, one product
//    listing snippet per company. Does NOT reliably give MOQ, lead time,
//    certifications, or pricing at the category-page level — those stay
//    null unless a company's own listing/site was individually checked.
const INDIAMART_BLR_URL =
  "https://dir.indiamart.com/bengaluru/corrugated-boxes.html";
const INDIAMART_BLR_NAME =
  "IndiaMART — Corrugated Box Suppliers in Bengaluru (directory)";

// 2. KACBMA — Karnataka Corrugated Box Manufacturers Association member
//    directory. Fetched 2026-09-07. Gives: company name only (no city,
//    product, or contact detail on the directory page itself) — location
//    is recorded as "Karnataka" (state-level, matching what the source
//    actually supports) rather than guessing a city.
const KACBMA_URL = "https://kacbma.com/members-directory/";
const KACBMA_NAME =
  "Karnataka Corrugated Box Manufacturers Association (KACBMA) — Members Directory";

// 3. One supplier's own storefront/site (Marudhar Packaging), fetched
//    2026-09-07 — used for the one record in this batch with richer,
//    company-confirmed fields (address, phone, GST registration,
//    industries served, manufacturing status).
const MARUDHAR_URL = "https://www.marudharpackagings.com/";
const MARUDHAR_NAME = "Marudhar Packaging — company storefront";

const RETRIEVED_AT = new Date().toISOString();

function indiamartRecord(
  companyName: string,
  snippet: string
): RawSupplierRecord {
  return {
    companyName,
    location: "Bengaluru, Karnataka",
    categories: ["Packaging", "Corrugated packaging"],
    products: [snippet],
    source: {
      url: INDIAMART_BLR_URL,
      sourceName: INDIAMART_BLR_NAME,
      sourceType: "public_directory",
      fields: [
        "identity.companyName",
        "identity.location",
        "capabilities.categories",
        "capabilities.products",
      ],
      snippet,
    },
  };
}

function kacbmaRecord(companyName: string): RawSupplierRecord {
  return {
    companyName,
    location: "Karnataka",
    categories: ["Packaging", "Corrugated packaging"],
    source: {
      url: KACBMA_URL,
      sourceName: KACBMA_NAME,
      sourceType: "industry_association",
      fields: [
        "identity.companyName",
        "identity.location",
        "capabilities.categories",
      ],
      snippet: "Listed as a member company on the KACBMA members directory.",
    },
  };
}

// --- Set A: IndiaMART Bengaluru directory (28 companies) ---
const INDIAMART_ENTRIES: [string, string][] = [
  ["Aryan Enterprises", "5kg 3 Ply Corrugated Packaging Box"],
  ["ARK Corporation", "4.4x4x2 Inch Plain Corrugated Box"],
  ["Packopedia", "Double Wall 5 Ply Brown Corrugated Shipping Box"],
  ["Ecosoft", "Brown Kraft Paper 3 Ply Corrugated Packaging Boxes (8x4x4)"],
  ["MM Will Care", "Single Wall 3 Ply Auto Lock Corrugated Box"],
  ["Forever Diary India Private Limited", "Brown Flat Box"],
  ["Goldenstars Enterprises", "Double Wall 5 Ply Mustard Oil Corrugated Packaging Box"],
  ["Seaa Packaging Private Limited", "Single Wall 3 Ply Plain Corrugated Boxes"],
  ["Unikube Kartons", "3 Kg Corrugated Box"],
  ["Shree Parshwanath Packaging", "Corrugated Carton Box"],
  ["M I Packaging", "8 Ply Corrugated Packaging Box"],
  ["Matrix Engineering Company", "Corrugated Box, Carton Box For PPF"],
  ["Prathamesh Packaging", "9 Ply Corrugated Packaging Box"],
  ["Chanchal Enterprises", "3 Ply Corrugated Box"],
  ["City Prints & Packs", "120 GSM Corrugated Box"],
  ["Saifi Packaging", "Triple Wall 5 Ply Corrugated Cartons Box"],
  ["Nova Pack Care", "Single Wall 3 Ply Fruit Corrugated Paper Box"],
  ["Image Print Process", "Corrugated Cartons Box"],
  ["Boxpool LLP", "Double Wall 5 Ply Regular Corrugated Box"],
  ["Shree Packaging", "Plain Corrugated Packaging Box"],
  ["Maurya Enterprises", "Laminated Corrugated Boxes"],
  ["SKN Industries", "150 GSM Corrugated Carton Box"],
  ["Square Solutions", "8x6x4 Inch 3 Ply Corrugated Box"],
  ["Kutlery Ventures", "5 Ply Kraft Paper Corrugated Cartons Box"],
  ["R.V. Enterprises", "Corrugated Cartons Box"],
  ["S N V Packaging", "Regular Slotted Corrugated Box, Kraft Paper"],
  ["A-One Packaging Co.", "Corrugated Boxes"],
  ["Surana Packaging", "Mango Packaging Corrugated Box"],
];

// --- Set B: KACBMA members directory, first 22 listed members minus one
// (A-One Packaging — treated as the same company as the IndiaMART "A-One
// Packaging Co." entry above rather than a separate record, though it
// fell just under the automated similarity threshold; see the dedup note
// in the run summary) (21 companies) ---
const KACBMA_ENTRIES: string[] = [
  "Accupack Private Limited",
  "Adarsh Packagers",
  "Adarsha Packaging Private Limited",
  "Adishwar Packaging",
  "Afnosh Enterprises",
  "Agile Engineering and Packaging Private Limited",
  "AIW Cartons",
  "Akruthi Packaging",
  "Akshaya Packaging Industries",
  "Andromeda Packaging Private Limited",
  "Ashish Packaging Industries",
  "Astra Pack",
  "B&B Triple Wall Containers Limited",
  "Bag Factory",
  "Bahety Converters",
  "Balaji Packaging",
  "Balaji Packaging Company",
  "Balaji Packaging Industries",
  "Best Cartons",
  "Bhargav Packaging",
  "Canara Paper Products",
];

// --- Marudhar Packaging: company storefront, fetched directly (1 company) ---
const MARUDHAR_RECORD: RawSupplierRecord = {
  companyName: "Marudhar Packaging",
  location: "Bengaluru, Karnataka",
  categories: ["Packaging", "Corrugated packaging"],
  products: [
    "Packaging Box",
    "Corrugated Box",
    "Carton Box",
    "Plastic Courier Bag",
    "Corrugated Roll",
    "Angle Board",
    "Stretch Film",
    "Cardboard Box",
    "Bopp Tape",
    "Shipping Labels",
    "Bubble Wrap",
    "Air Bubble Roll",
    "Zip Lock Bags",
  ],
  manufacturingStatus: "manufacturer",
  industriesServed: ["FMCG", "Garment", "Food", "Plastic", "Automotive"],
  phone: "07942796808",
  gstNumber: "29AAXFM8984G1Z4",
  source: {
    url: MARUDHAR_URL,
    sourceName: MARUDHAR_NAME,
    sourceType: "public_directory", // IndiaMART-hosted storefront, not an independent corporate domain
    fields: [
      "identity.companyName",
      "identity.location",
      "identity.contact.phone",
      "capabilities.categories",
      "capabilities.products",
      "capabilities.manufacturingStatus",
      "capabilities.industriesServed",
      "compliance.gstNumber",
    ],
    snippet:
      "No 31 and 32, Doddanna Industrial Estate Main Road, I.P. Nagar, Bengaluru - 560058. Nature: Manufacturer. Industries served: FMCG, Garment, Food, Plastic, Automotive. GST: 29AAXFM8984G1Z4.",
  },
};

// Merge two independently-normalized Supplier records for the SAME real
// company (here: Unikube Kartons, confirmed on both IndiaMART and the
// KACBMA member list) into one record carrying both sources. This is a
// manual/curated merge, not the automated dedup pipeline — it exists so
// the one clean, high-confidence duplicate in this batch doesn't end up
// as two rows in the catalog.
function mergeSuppliers(primary: Supplier, secondary: Supplier): Supplier {
  const sources = [
    ...primary.intelligence.sources,
    ...secondary.intelligence.sources,
  ];

  return {
    ...primary,
    capabilities: {
      ...primary.capabilities,
      categories: Array.from(
        new Set([
          ...primary.capabilities.categories,
          ...secondary.capabilities.categories,
        ])
      ),
      products: Array.from(
        new Set([
          ...primary.capabilities.products,
          ...secondary.capabilities.products,
        ])
      ),
    },
    intelligence: {
      ...primary.intelligence,
      sources,
      dataConfidence: computeDataConfidence(sources),
    },
    mergedFrom: [...primary.mergedFrom, secondary.id],
  };
}

async function main() {
  let existingIds: number[] = [];
  const suppliers: Supplier[] = [];

  const pushNormalized = (raw: RawSupplierRecord) => {
    const supplier = normalizeSupplierRecord(raw, existingIds);
    existingIds = [...existingIds, supplier.id];
    suppliers.push(supplier);
    return supplier;
  };

  for (const [name, snippet] of INDIAMART_ENTRIES) {
    pushNormalized(indiamartRecord(name, snippet));
  }

  for (const name of KACBMA_ENTRIES) {
    pushNormalized(kacbmaRecord(name));
  }

  pushNormalized(MARUDHAR_RECORD);

  // Merge the one confirmed duplicate: Unikube Kartons appears both on
  // the IndiaMART Bengaluru category page and the KACBMA member list.
  const unikubeFromIndiamart = suppliers.find(
    (s) => s.identity.companyName === "Unikube Kartons"
  );

  const unikubeFromKacbma = normalizeSupplierRecord(
    kacbmaRecord("Unikube Kartons"),
    existingIds
  );

  if (unikubeFromIndiamart) {
    const merged = mergeSuppliers(unikubeFromIndiamart, unikubeFromKacbma);
    const index = suppliers.findIndex((s) => s.id === merged.id);
    suppliers[index] = merged;
  }

  // Run the actual duplicate detector over the finished batch — report
  // what it flags rather than silently trusting the manual pass above.
  const candidates = findPotentialDuplicates(suppliers);

  console.log(`Normalized ${suppliers.length} suppliers.`);
  console.log(
    `findPotentialDuplicates() flagged ${candidates.length} candidate pair(s):`
  );
  for (const candidate of candidates) {
    console.log(
      `  - "${candidate.a.identity.companyName}" <-> "${candidate.b.identity.companyName}" (${candidate.reason})`
    );
  }

  const dataFile = path.join(process.cwd(), "data", "suppliers.json");
  await fs.writeFile(
    dataFile,
    JSON.stringify({ suppliers }, null, 2),
    "utf-8"
  );

  console.log(`Wrote ${suppliers.length} suppliers to ${dataFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
