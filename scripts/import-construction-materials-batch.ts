// Ingestion run: Construction Materials supplier batch (India-wide) — Batch
// 12 of the master plan, eleventh per-category dataset added to the
// existing multi-file supplier repository (see lib/supplier-store.ts's
// id-block scheme). Same architecture as every prior batch:
// normalizeSupplierRecord / computeDataConfidence / computeDedupeKey /
// findPotentialDuplicates from the existing lib/ingestion + lib/dedup
// modules — nothing new invented.
//
// SCOPE NOTE: to avoid overlap with the prior "Chemicals/Materials" batch
// (industrial chemicals, resins, adhesives, plastic polymers, rubber,
// non-ferrous metals, sheet metals, stainless steel, industrial paints,
// industrial coatings) and the "Raw Materials" batch (MS billets, steel
// ingots, TMT bars, sponge iron, pig iron — so NO structural steel/TMT
// bars here), this batch is scoped to eight construction-specific product
// categories: Cement, Bricks & Blocks, Tiles, Ready Mix Concrete & Paver
// Blocks, Sanitaryware & Bathroom Fittings, uPVC/CPVC Pipes & Plumbing
// Fittings, Doors & Windows, and Waterproofing & Construction Chemicals
// (construction-specific chemical products, distinct from the general
// "industrial chemicals" already covered in the Chemicals/Materials batch).
//
// SOURCES: 21 pan-India IndiaMART "impcat" category pages across the eight
// subcategory groups above. Raw listing data was gathered via two parallel
// research passes, each using WebSearch first to verify the correct current
// impcat slug (never guessed), then WebFetching each page's base URL plus
// its "?pg=2" variant or, where pg=2 collapsed to the same page, the site's
// own "?biz=NN" business-type filtered view as the pagination-equivalent
// second page — the established technique from every prior batch. Every
// listing was transcribed verbatim; exact-duplicate rows produced by
// fetching two overlapping views of the same page were mechanically merged
// by the research pass (not fuzzy name matching) and are noted below.
//
// INCLUSION RULE applied while curating the raw listings below:
//   - EXCLUDED: foreign companies not based in India.
//   - EXCLUDED: listings that are purely a reseller of ONE specific named
//     foreign brand via an otherwise-unrelated trading company with no
//     independent evidence of dealing in the material itself.
//   - EXCLUDED: spare-parts/machinery-only listings (a brick-making
//     machine, a tile-cutting machine, a concrete mixer, a pipe-extrusion
//     machine — the EQUIPMENT that makes the product, not the product
//     itself).
//   - EXCLUDED: tiny/hobby/decorative/luxury/novelty items not standard
//     building fixtures — "Stone Agate Washbasin" (gemstone art piece),
//     "AGATE GEMS STONE WASH BASIN...HOME DECOR/LUXURY" (explicitly
//     labeled home decor), "Guitar Wash Basin" (novelty-shaped item).
//   - EXCLUDED: keyword-coincidence unrelated businesses — a "Cemented
//     Triplet Prism" optics component (not building-material cement), a
//     "Galvanised Exposed Grid Everest Aluminium False Ceiling" grid
//     system surfaced on a tile page (a different product entirely), a
//     natural-stone (granite) slab lacking any literal ceramic/vitrified/
//     porcelain wording (excluded per the natural-stone rule — tiles here
//     means manufactured ceramic/vitrified product, not raw dimension
//     stone).
//   - EXCLUDED: a listing carrying no literal textual evidence of dealing
//     in the material itself ("Industrial Material" with no cement-related
//     wording).
//   - EXCLUDED: rental/hire-only or installation-service-only listings.
//   - A company name alone was NOT used to exclude a listing whose title
//     carried genuine construction-material evidence — same rule as every
//     prior batch.
//   - Do NOT exclude an India-registered subsidiary of a foreign-
//     headquartered brand merely for having a foreign parent — only
//     exclude if the company itself is foreign-based/foreign-registered.
//
// MANUFACTURER/DISTRIBUTOR/TRADER STATUS: the ManufacturingStatus type in
// lib/supplier-types.ts only accepts "manufacturer" | "distributor" |
// "trader" | "unknown" — it does NOT include "exporter". IndiaMART's
// "Verified Exporter" / "Exporter" / "TrustSEAL" badges, though extremely
// common across this batch's raw data, are therefore never mapped to any
// status value (mapping "Exporter" to "manufacturer"/"distributor"/
// "trader" would be fabrication). Only the literal word "Manufacturer" is
// mapped, which appears on two Bricks & Blocks listings. Every other
// listing in this batch is left "unknown".
//
// TECHNICAL SPECS: extracted only when literally present in the title via
// parseConstructionSpecs() — size (mm/inch/sq ft/cubic meter), weight (kg),
// volume (litre), and concrete/mortar grade (M-number, e.g. "M20").
// Nothing is inferred beyond the title text.
//
// PRICE-UNIT HONESTY NOTE: prices and their units are copied exactly as
// displayed on IndiaMART (including apparent per-unit inconsistencies,
// e.g. one cement listing priced "₹800/Bag" versus most others' ~₹250-450/
// Bag) — these are reported as-is per the zero-fabrication policy, never
// corrected, normalized, or second-guessed.
import { promises as fs } from "fs";
import path from "path";
import {
  normalizeSupplierRecord,
  type RawSupplierRecord,
} from "../lib/ingestion/normalize";
import { findPotentialDuplicates, normalizeCompanyName } from "../lib/dedup";
import type { ManufacturingStatus, Supplier } from "../lib/supplier-types";

const RETRIEVED_AT_NOTE = "September 2026";

type Listing = [
  company: string,
  city: string,
  title: string,
  price: string | null,
  bizType?: ManufacturingStatus,
];

type SubcategorySource = {
  subcategory: string;
  group: string;
  url: string;
  sourceName: string;
};

const SOURCES = {
  cement: {
    subcategory: "OPC, PPC & white cement (bagged)",
    group: "Cement",
    url: "https://m.indiamart.com/impcat/construction-cement.html",
    sourceName: "IndiaMART — Construction Cement directory",
  },
  bricksBlocks: {
    subcategory: "Fly ash bricks, AAC blocks & concrete blocks",
    group: "Bricks & Blocks",
    url: "https://m.indiamart.com/impcat/fly-ash-bricks.html",
    sourceName:
      "IndiaMART — Fly Ash Bricks / AAC Block / Concrete Blocks directories",
  },
  tiles: {
    subcategory: "Ceramic & vitrified tiles",
    group: "Tiles",
    url: "https://m.indiamart.com/impcat/vitrified-tiles.html",
    sourceName: "IndiaMART — Vitrified Tiles / Ceramic Tiles directories",
  },
  rmcPaverBlocks: {
    subcategory: "Ready mix concrete, paver blocks & kerb stones",
    group: "Ready Mix Concrete & Paver Blocks",
    url: "https://m.indiamart.com/impcat/ready-mixed-concrete.html",
    sourceName:
      "IndiaMART — Ready Mixed Concrete / Concrete Paver Block / Kerb Stones directories",
  },
  sanitaryware: {
    subcategory: "Wash basins, water closets & bathroom faucets",
    group: "Sanitaryware & Bathroom Fittings",
    url: "https://m.indiamart.com/impcat/wash-basins.html",
    sourceName:
      "IndiaMART — Wash Basins / Water Closets / Bathroom Faucets directories",
  },
  pvcPipes: {
    subcategory: "uPVC pipes, uPVC pipe fittings & CPVC pipe",
    group: "uPVC/CPVC Pipes & Plumbing Fittings",
    url: "https://m.indiamart.com/impcat/upvc-pipes.html",
    sourceName:
      "IndiaMART — UPVC Pipes / UPVC Pipe Fittings / CPVC Pipe directories",
  },
  doorsWindows: {
    subcategory: "uPVC windows, flush doors & aluminium windows",
    group: "Doors & Windows",
    url: "https://m.indiamart.com/impcat/upvc-windows.html",
    sourceName:
      "IndiaMART — UPVC Windows / Flush Doors / Aluminium Window directories",
  },
  waterproofing: {
    subcategory:
      "Waterproofing chemicals, tile adhesives/grout & concrete admixtures",
    group: "Waterproofing & Construction Chemicals",
    url: "https://m.indiamart.com/impcat/waterproofing-chemicals.html",
    sourceName:
      "IndiaMART — Waterproofing Chemicals / Tile Adhesives / Concrete Admixture directories",
  },
} satisfies Record<string, SubcategorySource>;

const STATE_BY_CITY: Record<string, string> = {
  // Maharashtra
  Mumbai: "Maharashtra",
  Pune: "Maharashtra",
  Nagpur: "Maharashtra",
  Thane: "Maharashtra",
  "Navi Mumbai": "Maharashtra",
  Kalyan: "Maharashtra",
  Nashik: "Maharashtra",
  Nanded: "Maharashtra",
  Akola: "Maharashtra",
  Bhiwandi: "Maharashtra",
  Vasai: "Maharashtra",
  "Vasai Virar": "Maharashtra",
  Boisar: "Maharashtra",
  Butibori: "Maharashtra",
  // Stray-city fixes found in the Batch 12 (Construction Materials) state
  // distribution review — verified via WebSearch against IndiaMART/Justdial
  // listings for the specific supplier records that surfaced them.
  "North 24 Parganas": "West Bengal",
  Jalpaiguri: "West Bengal",
  Ayodhya: "Uttar Pradesh",
  Barwala: "Haryana", // Barwala, Panchkula — confirmed cement-dealer hub
  Taranagar: "Rajasthan",
  Rewa: "Madhya Pradesh",
  Ramgarh: "Jharkhand", // confirmed via Justdial listing for this exact supplier
  Kota: "Rajasthan",
  Beawar: "Rajasthan",
  Maheshwaram: "Telangana",
  Dombivli: "Maharashtra",
  Badlapur: "Maharashtra",
  Chembur: "Maharashtra",
  "Bhayander West": "Maharashtra",
  "Borivali East": "Maharashtra",
  "Tarapur, Pandharpur": "Maharashtra",
  Aurangabad: "Maharashtra",
  // Gujarat
  Ahmedabad: "Gujarat",
  Rajkot: "Gujarat",
  Surat: "Gujarat",
  Morbi: "Gujarat",
  Vadodara: "Gujarat",
  Gondal: "Gujarat",
  Paddhari: "Gujarat",
  Jamnagar: "Gujarat",
  Thangadh: "Gujarat",
  Sihor: "Gujarat",
  Kalol: "Gujarat",
  Sabarkantha: "Gujarat",
  Anand: "Gujarat",
  Valsad: "Gujarat",
  Vapi: "Gujarat",
  Sarigam: "Gujarat",
  Junagadh: "Gujarat",
  Banswara: "Rajasthan",
  Bodakdev: "Gujarat",
  Odhav: "Gujarat",
  Gangad: "Gujarat",
  // Rajasthan
  Jaipur: "Rajasthan",
  Ajmer: "Rajasthan",
  Kishangarh: "Rajasthan",
  Jodhpur: "Rajasthan",
  Udaipur: "Rajasthan",
  Alwar: "Rajasthan",
  Bikaner: "Rajasthan",
  Makrana: "Rajasthan",
  Bhilwara: "Rajasthan",
  Nagaur: "Rajasthan",
  "Jhotwara, Jaipur": "Rajasthan",
  // Delhi
  "New Delhi": "Delhi",
  Delhi: "Delhi",
  "Chandni Chowk, New Delhi": "Delhi",
  "Hauz Qazi, New Delhi": "Delhi",
  // Uttar Pradesh
  Kanpur: "Uttar Pradesh",
  Varanasi: "Uttar Pradesh",
  Lucknow: "Uttar Pradesh",
  Noida: "Uttar Pradesh",
  Agra: "Uttar Pradesh",
  Ghaziabad: "Uttar Pradesh",
  Prayagraj: "Uttar Pradesh",
  Gorakhpur: "Uttar Pradesh",
  "Greater Noida": "Uttar Pradesh",
  Sikandrabad: "Uttar Pradesh",
  Rampur: "Uttar Pradesh",
  Muzaffarnagar: "Uttar Pradesh",
  Dadri: "Uttar Pradesh",
  Hapur: "Uttar Pradesh",
  // Madhya Pradesh
  Indore: "Madhya Pradesh",
  Bhopal: "Madhya Pradesh",
  Gwalior: "Madhya Pradesh",
  Jabalpur: "Madhya Pradesh",
  Katni: "Madhya Pradesh",
  Manawar: "Madhya Pradesh",
  Pithampur: "Madhya Pradesh",
  Satna: "Madhya Pradesh",
  Orchha: "Madhya Pradesh",
  // Chhattisgarh
  Raipur: "Chhattisgarh",
  Raigarh: "Chhattisgarh",
  // Telangana
  Hyderabad: "Telangana",
  Secunderabad: "Telangana",
  Warangal: "Telangana",
  Khammam: "Telangana",
  "Konijerla, Khammam": "Telangana",
  "Suchitra Junction, Hyderabad": "Telangana",
  "Miyapur, Hyderabad": "Telangana",
  "Mallapur, Hyderabad": "Telangana",
  Rangareddy: "Telangana",
  Maheswaram: "Telangana",
  // Andhra Pradesh
  Ongole: "Andhra Pradesh",
  Visakhapatnam: "Andhra Pradesh",
  Rajahmundry: "Andhra Pradesh",
  Vijayawada: "Andhra Pradesh",
  Tandur: "Telangana",
  // Karnataka
  Bengaluru: "Karnataka",
  Dharwad: "Karnataka",
  Belagavi: "Karnataka",
  Hoskote: "Karnataka",
  // Tamil Nadu
  Chennai: "Tamil Nadu",
  Coimbatore: "Tamil Nadu",
  Erode: "Tamil Nadu",
  Salem: "Tamil Nadu",
  Tiruppur: "Tamil Nadu",
  Kancheepuram: "Tamil Nadu",
  Madurai: "Tamil Nadu",
  "Thathaneri, Madurai": "Tamil Nadu",
  Tiruvallur: "Tamil Nadu",
  "Walajabad": "Tamil Nadu",
  "Thirumalairayan Pattinam": "Tamil Nadu",
  Chettipalayam: "Tamil Nadu",
  // Kerala
  Perinthalmanna: "Kerala",
  Ernakulam: "Kerala",
  Palakkad: "Kerala",
  // West Bengal
  Kolkata: "West Bengal",
  Howrah: "West Bengal",
  Siliguri: "West Bengal",
  Gairkata: "West Bengal",
  "Narsingpur, Jalpaiguri": "West Bengal",
  "Burrabazar, Kolkata": "West Bengal",
  "Kankurgachi, Kolkata": "West Bengal",
  Jaleswar: "West Bengal",
  // Odisha
  Cuttack: "Odisha",
  Barbil: "Odisha",
  Jajpur: "Odisha",
  // Bihar
  Patna: "Bihar",
  Gaya: "Bihar",
  Darbhanga: "Bihar",
  Teghra: "Bihar",
  // Assam
  Guwahati: "Assam",
  "North Guwahati": "Assam",
  Bongaigaon: "Assam",
  Nongpoh: "Meghalaya",
  Singtam: "Sikkim",
  // Jharkhand
  Ranchi: "Jharkhand",
  Jamshedpur: "Jharkhand",
  // Punjab
  Moga: "Punjab",
  Jalandhar: "Punjab",
  Ludhiana: "Punjab",
  "Dera Bassi": "Punjab",
  // Haryana
  Ambala: "Haryana",
  Faridabad: "Haryana",
  Gurugram: "Haryana",
  Gurgaon: "Haryana",
  Panchkula: "Haryana",
  Zirakpur: "Punjab",
  Sonipat: "Haryana",
  Manesar: "Haryana",
  "Yamuna Nagar": "Haryana",
  // Chandigarh
  Chandigarh: "Chandigarh",
  // Kerala/others
  Kochi: "Kerala",
  // Goa
  Panaji: "Goa",
  // Himachal Pradesh
  "Paonta Sahib": "Himachal Pradesh",
  Nalagarh: "Himachal Pradesh",
  // Haridwar (Uttarakhand)
  Haridwar: "Uttarakhand",
  // Maksi (Madhya Pradesh)
  Maksi: "Madhya Pradesh",
  // Bhiwadi (Rajasthan)
  Bhiwadi: "Rajasthan",
};

function locationFor(city: string): string {
  const cleanCity = city.split(",")[0].trim();
  if (!cleanCity) return "";
  const state = STATE_BY_CITY[city] ?? STATE_BY_CITY[cleanCity];
  return state ? `${cleanCity}, ${state}` : cleanCity;
}

// Literal-evidence-only technical spec extraction — same discipline as
// every prior batch's spec parser.
function parseConstructionSpecs(title: string): string[] {
  const specs: string[] = [];
  const push = (label: string) => {
    if (!specs.includes(label)) specs.push(label);
  };

  const mmMatch = title.match(/(\d+(?:\.\d+)?)\s*mm\b/i);
  if (mmMatch) push(`${mmMatch[1]}mm`);

  const inchMatch = title.match(/(\d+(?:\.\d+)?)\s*inch/i);
  if (inchMatch) push(`${inchMatch[1]} inch`);

  const sqFtMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:sq\s*\.?\s*ft|square\s*feet)/i);
  if (sqFtMatch) push(`${sqFtMatch[1]} sq ft`);

  const cubicMMatch = title.match(/(\d+(?:\.\d+)?)\s*[Cc]ubic\s*[Mm]eter/);
  if (cubicMMatch) push(`${cubicMMatch[1]} cubic meter`);

  const kgMatch = title.match(/(\d+(?:\.\d+)?)\s*[Kk]g\b/);
  if (kgMatch) push(`${kgMatch[1]} kg`);

  const litreMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:litre|liter|ltr)\b/i);
  if (litreMatch) push(`${litreMatch[1]} litre`);

  const gradeMatch = title.match(/\bM(\d{1,3})\b/);
  if (gradeMatch) push(`Grade M${gradeMatch[1]}`);

  return specs;
}

function rawRecordsForSubcategory(
  key: keyof typeof SOURCES,
  entries: Listing[]
): RawSupplierRecord[] {
  const { subcategory, group, url, sourceName } = SOURCES[key];
  const categories = Array.from(new Set(["Construction Materials", group, subcategory]));

  return entries.map(([companyName, city, title, price, bizType]) => {
    const specs = parseConstructionSpecs(title);
    const fields = [
      "identity.companyName",
      "identity.location",
      "capabilities.categories",
      "capabilities.products",
      "capabilities.productDescription",
    ];
    if (price) fields.push("commercial.priceRange");
    if (specs.length > 0) fields.push("capabilities.manufacturingCapabilities");
    if (bizType) fields.push("capabilities.manufacturingStatus");

    return {
      companyName,
      location: locationFor(city),
      categories,
      products: [title],
      productDescription: title,
      manufacturingCapabilities: specs,
      manufacturingStatus: bizType,
      priceRange: price ? `${price} (indicative, for: ${title})` : undefined,
      source: {
        url,
        sourceName,
        sourceType: "public_directory",
        fields,
        snippet: `Listed on IndiaMART's ${subcategory} category page (retrieved ${RETRIEVED_AT_NOTE}). Full listing title: "${title}".`,
      },
    } satisfies RawSupplierRecord;
  });
}

// ---------------------------------------------------------------------
// Raw listings — curated GENUINE-only (see the inclusion rule in the file
// header). Every entry is transcribed verbatim from WebFetch results
// against the live IndiaMART pages.
// ---------------------------------------------------------------------

const CEMENT: Listing[] = [
  ["Shivhare Traders", "Raipur", "5kg Jindal Panther Tuffy PCC Cement, M20", "₹250/Bag"],
  ["Laxmi Industries", "Patna", "Jindal Panther Cement, Type: PSC", "₹155/Bag"],
  ["Nuvoco Vistas Corporation Limited", "North 24 Parganas", "Nuvoco PSC Cement", "₹430/Bag"],
  ["Sadguru Krupa Production", "Pune", "Birla Super Cement", "₹386/Bag"],
  ["Jabalpur Cement Industries Private Limited", "Jabalpur", "50kg Yoddha Power Cement, Cement Type: PPC, 43 Grade", "₹250/Bag"],
  ["Midland Concrete Private Limited", "Gondal", "50 Kg Ultra Fine GGBS Solid Cement", "₹375/Bag"],
  ["Balaji Industries", "Ayodhya", "Shree Ultra Cement, Packaging Size: 50 kg, Type: OPC (Ordinary Portland Cement), 43 Grade", "₹310/Bag"],
  ["Coral Precast Products (A Unit Of M/S. Pluton Cements Pvt Ltd)", "Indore", "King Ultra PPC Cement", "₹320/Bag"],
  ["Pioneer Industries", "Manawar", "MYROCK PPC 53 Grade Cement", "₹320/Bag"],
  ["Vamana Cements Private Limited", "Salem", "Vamana Cement Vamanaa Cements, Type: PPC", "₹275/Bag"],
  ["Orka Industries", "Pune", "Birla Super Cement", "₹386/Bag"],
  ["Shri Bala Ji Cement Industries", "Moga", "BUILD POWER CEMENT (CONCRETE MASTER), High Strength PPC", "₹350/Bag"],
  ["Vasantham Bluemetals", "Chettipalayam", "All Brand Cement", "₹300/Bag"],
  ["Dua Stones & Tiles", "Ajmer", "Ppc Cement All Brands", "₹315/Bag"],
  ["Star Cement Limited", "Kolkata", "Dhalai Master Cement", null],
  ["R N Maurya Concrete Udyog", "Varanasi", "cement 24/24", null],
  ["Mahanadi Spun Pipe Industries", "Cuttack", "Cement", "₹250/Bag"],
  ["Abhiram Enterprises", "Barbil", "RCC Cement", null],
  ["JSW Cement Limited", "Mumbai", "Concreel HD Cement, Cement Grade: General High Grade, Packing Size: 50 Kg Bag", null],
  ["Creative Housewares Private Limited", "Katni", "Ultra strong Cement", "₹310/Bag"],
  ["Highchem India Cement Concret Private Limited", "Gwalior", "Jp Laxmi Cement, Cement Type: PPC, 43 Grade", "₹245/Bag"],
  ["Manah Enterprises", "Bhopal", "Non Trade Cement. In Bags & Bulker ( Acc,Jk Super, Wonder Cement), 53 Grade", "₹250/Bag"],
  ["RK Industries", "Warangal", "UltraTech Kcp 53 Grade Cement", "₹330/Bag"],
  ["Incorporate Style", "Lucknow", "Cement", "₹400/Bag"],
  ["Gour Nitai Store", "Jaleswar", "Jindal Cement, Type: PPC, 43 Grade", "₹270/Bag"],
  ["Shri Salasar Industry", "North Guwahati", "Adhunik Cement Ltd", "₹340/Bag"],
  ["Tapee Cement Industries", "Rajkot", "Fly Ash Cement", "₹325/Bag"],
  ["Banadurga Traders", "Cuttack", "Solid Hd Cement", null],
  ["KLG Ecolite", "Kolkata", "Ultratech Premium Cement", "₹300/Bag"],
  ["TIRUMALA TRADERS", "Chennai", "Maha Ppc Cement", "₹300/Bag"],
  ["Jai Bajrang Steels", "Kanpur", "Jk Lakshmi Pro Cement", "₹800/Bag"],
  ["Khandelwal Enterprises", "Indore", "JK Sixer Non Trade Cement", "₹260/Bag"],
  ["Mangilal Vijayvargiya And Sons", "Indore", "Cement", "₹300/Bag"],
  ["S R Enterprise", "Vadodara", "Jk Super Cement In Ranoli", null],
  ["Venture Consultants", "Chembur", "42.5 N GRADE OPC", null],
  ["Shree Hari Enterprise", "Barwala", "Cement (OPC grades 52.5, 42.5, 32.5)", null],
  ["Gadia Stonex", "Kishangarh", "WONDER Cement", null],
  ["D John Agency", "Chennai", "Cement", "₹340/Piece"],
  ["DV Impex", "Kanpur", "Export of Fly Ash and Cement", null],
  ["Bhuvaneshari Traders Steel & Cement", "Hyderabad", "KCP Cement", null],
  ["golden muilding material", "Pune", "Cement", null],
  ["R.K. Enterprise", "Kolkata", "i stock cement", null],
  ["Ishan Enterprises", "Ranchi", "Jindal Cement / Acc Cement", "₹380/Bag"],
  ["Himmel Heights Construction Company", "Lucknow", "Cement", "₹390/Pack"],
  ["Duoco Corporation", "Bhayander West", "Cement", "₹250/Piece"],
  ["M/s Amit Steel", "Varanasi", "Cement", null],
  ["Shree Ultra Cement", "Jaipur", "Cement", null],
  ["Killada Nagalatha Imports & Exports", "Hyderabad", "Cement Powder", null],
  ["Paradise Group", "Kochi", "Cement", null],
  ["Tirodkar Corporation, Bakul", "Navi Mumbai", "Cement", null],
  ["Genial International", "Rajkot", "Cement", null],
  ["Tilak Paints & Chemicals", "Chandigarh", "Cement", null],
  ["Bhagyoday Enterprises", "Tarapur, Pandharpur", "Cement", null],
  ["Advance Export Private Limited", "Junagadh", "Cement, Packing Size: 50 Kg (53 Grade OPC)", null],
  ["Sandwala", "Borivali East", "Cement", null],
  ["VKM Exports", "Navi Mumbai", "Cement", null],
  ["Puskal Steel", "Howrah", "Cement", null],
  ["New Swastika Electric & Scientific Works", "Ambala", "Cement", null],
  ["Divyank Enterprises", "Cuttack", "Cement", null],
  ["Viva International", "Kolkata", "Construction Cement", null],
  ["Ghar Export", "Gaya", "Construction Cement", null],
  ["T. S. Traders", "Bongaigaon", "UltraTech Max Ppc Cement", "₹450/Bag"],
  ["Khinvasara Associates Construction Private Limited", "Pune", "Chettinad Cement Opc 53", "₹315/Bag"],
  ["Rasheediya Enterprises", "Chennai", "Building Construction Cement", "₹280/Bag"],
  ["Rohit Enterprises", "Pune", "Jk Super Cement", "₹285/Bag"],
  ["Varaahi Enterprises", "Chennai", "UltraTech Cement, Type: PPC, 53 Grade", "₹275/Bag"],
  ["Sri Jagannath Steelex", "Cuttack", "Solid Hd Cement", "₹360/Bag"],
  ["RK TMT Mart", "Chennai", "UltraTech Cement, Type: PPC, 43 Grade", "₹325/Bag"],
  ["Yash Enterprises", "Chennai", "Maha Hd Cement", "₹270/Bag"],
  ["Singhal Building Material", "Lucknow", "Kjs Concrete Cement", "₹320/Bag"],
  ["GK Elite Infra", "Bengaluru", "Opc Cement 43 Grade", "₹350/Bag"],
  ["Meghani Enterprises", "Thane", "Jsw Cement Grade 43", "₹300/Bag"],
  ["Himansu Builders", "Jaipur", "Shree Roofon Cement", "₹320/Bag"],
  ["National Trading Co.", "Nagpur", "Bangur Cement 50 Kg, 43 Grade, OPC", "₹260/Bag"],
  ["Sree Balaji Enterprises", "Chennai", "50kg Bhavya Solid Gold Cement, Grade 43", "₹350/Bag"],
  ["SLN Elite Group", "Bengaluru", "Zuari Opc Cement", "₹345/Bag"],
  ["Balaji Traders", "Bengaluru", "ACC Suraksha Power Cement", "₹340/Bag"],
  ["Selvi Trading Company", "Coimbatore", "Ramco Cement Dealers In Coimbatore, PPC", "₹320/Bag"],
  ["Premier Steels", "Coimbatore", "UltraTech Ordinary Portland Cement, Type: OPC", "₹350/Bag"],
  ["Vetrivel Building Solutions", "Coimbatore", "Ramco Super Grade PPC Fly Ash Cement", "₹305/Bag"],
  ["Balaji Hardwares", "Chennai", "Mp Birla Cement, 53 Grade, Cement Type: PPC", "₹410/Bag"],
  ["Ambika Enterprise", "Vadodara", "Ambuja Cement In Padra, PPC", "₹320/Bag"],
  ["Shree Lakshmi Enterprises", "Chennai", "Dalmia Cement, 43 Grade, Cement Type: PPC", "₹285/Bag"],
  ["Gayatri Traders", "Sabarkantha", "Shree Roofon Concrete Master Cement", "₹355/Bag"],
  ["RNT Steels And Cements", "Tiruppur", "RAMCO Cement Wholesale Dealer in palladam", "₹310/Bag"],
  ["Kamakhya Associates", "Guwahati", "30kg Sika Cement", "₹450/Piece"],
  ["Arihant Enterprise", "Mumbai", "50Kg Birla OPC Cement, 53 Grade", "₹315/Bag"],
  ["Srinivasa Steel Traders", "Hyderabad", "50 kg KCP Super OPC Cement, 53 Grade", "₹290/Bag"],
  ["J S Traders", "Darbhanga", "Cement Wholesale All Brands", "₹420/Bag"],
];

const BRICKS_BLOCKS: Listing[] = [
  ["Ethios Enviro Solutions Private Limited", "Ahmedabad", "Fly Ash Bricks", "₹6.47/Piece"],
  ["G. B. Asbestos Pipes", "Jaipur", "228.6 X 101.6 X 76.2mm Fly Ash Bricks", "₹5.10/Piece"],
  ["Renaatus Procon Private Limited", "Erode", "Renacon Fly Ash Bricks, Size: 24x12x4 Inch", "₹40/Piece"],
  ["Ace Infracon Products", "Ahmedabad", "ACE Fly Ash Bricks, 9 in x 4 in x 3 in", "₹6/Piece"],
  ["Kataria Ecotech Private Limited", "Kanpur", "Fly Ash Bricks, Size: 9 in x 4.5 in x 3 in", "₹7/Piece"],
  ["Fusion Building Materials (Vizag) Private Limited", "Ongole", "Light Weight Bricks, Size: 24 in x 8 in x 4 in", "₹45/Piece"],
  ["Conecc Industries Private Limited", "Dharwad", "Fly Ash Bricks, Size: 24*8*4", "₹45/Piece"],
  ["Clavecon India Pvt. Ltd.", "Dadri", "Fly Ash Bricks", "₹45/Piece"],
  ["Garg Brothers Plaster Industries", "Taranagar", "8 Inch Fly Ash Bricks, Size: 625X200X200 mm, Solid", "₹5.50/Piece"],
  ["Kumar Tile Industries", "Dera Bassi", "Fly Ash Bricks", "₹8/Piece"],
  ["Faith Bricks Industries", "Rewa", "Fly Ash Bricks Concrete Products, Size: 8*4*8", "₹31.50/Piece"],
  ["Parshwa Cement", "Banswara", "Grey Fly Ash Brick, Compressive Strength: m7 to m 12m", "₹4.70/Piece"],
  ["Vijaya Industries", "Gairkata", "Fly Ash Bricks", "₹4/Piece"],
  ["Mathi Agency", "Chennai", "Fly Ash Bricks, Size: 204 x 102 mm x 76 mm", "₹8.50/Piece", "manufacturer"],
  ["RJP Tech And Minerals Private Limited", "Ahmedabad", "Fly Ash Bricks", "₹3/Piece"],
  ["Sri Guru Enterprises", "Chennai", "Lightweight Flyash Blocks", "₹46/Piece"],
  ["Advait Industries", "Jaipur", "9x4x3 Inch Fly Ash Brick", "₹4/Piece"],
  ["KLG Ecolite", "Kolkata", "Grey ACC Fly Ash Bricks, Size: 12 X 6 X 4 Inch", "₹10/Piece"],
  ["S.A. Roofings", "Perinthalmanna", "4inch AAC Weightless Fly Ash Block", "₹64/Piece"],
  ["Vee.Aar Industries", "Faridabad", "Lightweight Fly Ash Bricks, Size: 12 in x 4 in x 2 in", "₹21/Piece"],
  ["Om Sai Traders Kolar Bhopal", "Bhopal", "Fly Ash Bricks, Size: 230x110x75 mm", "₹5.50/Piece"],
  ["Velmart Traders", "Kancheepuram", "230x110x75mm Fly Ash Brick", "₹20/Piece"],
  ["Supreme Sand And Building Material Suppliers", "Kalyan", "Flyash Cement Blocks", "₹43/Piece"],
  ["RS Green Infra India Private Limited", "Nalagarh", "Aac Fly Ash Block, Size: 24 in x 10 in x 12 in", "₹3,000/Tonne"],
  ["Gayatri Tiles", "Ramgarh", "Fly Ash Bricks, Size: 9 in x 3 in x 2 in", "₹8/Piece"],
  ["Surajmal Tansukhrai", "Kishangarh", "Fly Ash Bricks, Size: 12 x 4 x 2 in", "₹50/Piece"],
  ["Mohta Cement Private Limited", "Pithampur", "Fly Ash Bricks", "₹5/Piece"],
  ["Cconorb Build Products Private Limited", "Hyderabad", "Fly Ash Bricks, Size: 600x200100mm", "₹39/Piece"],
  ["Rancare Industries Ltd.", "Khammam", "Fly Ash Cement Bricks, 9 in x 4 in x 3 in", "₹8/Piece"],
  ["Bengal Concretes", "Jalpaiguri", "75mm Maa Fly Ash Bricks, Size: 230x110x75 mm", "₹4.80/Piece", "manufacturer"],
  ["Ncl Buildtek Limited", "Hyderabad", "230x110x70mm Fly Ash Bricks", "₹150/Piece"],
  ["MR Enterprises", "Ranchi", "Fly Ash Bricks, Size: 250x120x75 mm", "₹5/Piece"],
  ["Moulik Enterprises", "Indore", "Fly Ash Bricks, Size: 9 in x 4 in x 3 in", "₹5.50/Piece"],
  ["Concretia Rock Products Private Limited", "Madurai", "Fly Ash Bricks", "₹9/Piece"],
  ["S D Block", "Akola", "Fly Ash Block, Size: 9 in x 4 in x 3 in", "₹4.50/Piece"],
  ["Asquare AAAC Products", "Visakhapatnam", "Fly Ash Bricks", "₹3,000/Tonne"],
  ["Shree Jee Ash Products", "Kota", "9 x 4 x 3 Inch Fly Ash Bricks", "₹3.50/Piece"],
  ["Adiyogi Constructions And Precast", "Prayagraj", "Fly Ash Bricks", "₹5.50/Piece"],
  ["Sai Buildcast Blocks MFG Co.", "Navi Mumbai", "Fly Ash Brick, 9 in x 4 in x 4 in", "₹6/Piece"],
  ["BrickMen", "Indore", "Fly Ash Concrete Bricks", "₹5.20/Piece"],
  ["M/S Mahamaya Concrete Udhyog", "Orchha", "Fly Ash Brick, Size: 230x110x70mm", "₹3.50/Piece"],
  ["Man Eco Products Private Limited", "Kolkata", "Fly Ash Cement Bricks, Size: 9 x 4 x 3 Inch", "₹8/Piece"],
  ["S. S. Bricks Industry", "Jaipur", "Fly Ash Bricks Concrete Products Near Me, Size: 24 in x 10 in x 12 in", "₹5.30/Piece"],
  ["Go Green Costruction Solutions Private Limited", "Nashik", "230x110x75 mm Fly Ash Brick", "₹60/Piece"],
  ["Unique Creations", "Bengaluru", "230x110x70 mm Lightweight Fly Ash Bricks", "₹45/Piece"],
  ["Shree Hari Export House", "Morbi", "AAC Block, 24\"x8\"x3-9\"", "₹3,500/Cubic Meter"],
  ["Labh Projects Private Limited", "Ahmedabad", "AAC Concrete Blocks - Precast Blocks, 600mm x 200mm x 75 mm", "₹50/Piece"],
  ["Coneq Infra", "Bengaluru", "ConEq AAC Block, 600mm x 200mm x 150 mm", "₹89/Piece"],
  ["M/S A.B Green Enterprises", "Kanpur", "Green Build Autoclaved Aerated Concrete AAC Wall Block, Size: 625 X 240", "₹2,900/Cubic Meter"],
  ["K. D. Infra", "Guwahati", "Rectangular 600x200x100 Mm AAC Block", "₹4,600/Cubic Meter"],
  ["Bhandari Stone Cutting And Polishing", "Nanded", "9 Inch AAC Block, 600x200x225mm (9\")", "₹3,900/Cubic Meter"],
  ["RR Building Products", "Secunderabad", "BirlaNu AAC Blocks, 600x200x100mm (4\")", "₹45/Piece"],
  ["Modern Marketing Associates", "Hyderabad", "Intra Aac Blocks, 24x8x4 in", "₹38/Piece"],
  ["Superlite Aac Blocks Industry", "Guwahati", "SUPERLITE AAC BLOCKS ( KSL BRAND)", "₹4,100/Cubic Meter"],
  ["Krrish White Bricks LLP", "Patna", "Autoclaved Aerated Concrete Block, 600x200x225mm (9\")", "₹120/Piece"],
  ["Aaral Marketing", "Secunderabad", "Birla Aerocon AAC Blocks (600x200x100mm)", "₹42/Piece"],
  ["Sneh Precast & Constosolutions Private Limited", "Pune", "600x200x100mm AAC Block", "₹3,800/Cubic Meter"],
  ["Trygve Engineering Private Limited", "Lucknow", "Magicrete AAC Blocks 625x200x100mm (4\")", "₹3,650/Cubic Meter"],
  ["8X Building Solutions", "Chennai", "Aac Block 600x200x150 - 6 Inch", "₹62.50/Piece"],
  ["Aditi Enterprises", "Thane", "Aac Blocks Per Piece", "₹3,000/Cubic Meter"],
  ["K P M STEELS AND TRADING CO.", "Palakkad", "Autoclaved Aerated Concrete Block, 16x8x6inch", "₹68/Piece"],
  ["Marda Industries Pvt. Ltd.", "Nongpoh", "3inch Power Light AAC Block, 10L x 5W x 3H Inch", "₹42/Piece"],
  ["Value Pack India Private Limited", "Hyderabad", "Autoclaved Aerated Concrete VBOND - AAC Blocks", "₹45/Piece"],
  ["Unicrete Building Solutions (India) Private Limited", "Sonipat", "Concrete Lightweight Aac Block, 12 in x 4 in x 2 in", "₹3,000/Cubic Meter"],
  ["Shubham Bricks Industries", "Beawar", "75mm Rectangular AAC Blocks, 24 X 8 Inch (Lxw)", "₹2,500/Piece"],
  ["Magicrete Building Solutions Private Limited", "Surat", "Magicrete Lightweight Concrete Block", "₹4,500/Cubic Meter"],
  ["Joyous Blocks & Panels Private Limited", "Kolkata", "600X200X75mm Joyous AAC Block", "₹29.75/Piece"],
  ["Shree Bajrang Techno Engineers Private Limited", "Raigarh", "Aac Cement Blocks,600x200x75mm, 600mm x 200mm x 75 mm", "₹3,150/Cubic Meter"],
  ["Godrej & Boyce Mfg. Co. Limited", "Mumbai", "Godrej Tuff Autoclaved Aerated Concrete Blocks", "₹4,400/Cubic Meter"],
  ["N. J. Eco-build Pvt. Ltd.", "Ahmedabad", "Aac Block ., 24 in x 8 in x 8 in", "₹3,299/Cubic Meter"],
  ["Ambassador Building Solutions Pvt. Ltd.", "Paonta Sahib", "Lightweight Aac Block, 625mm x200 mm x100", "₹3,000/Cubic Meter"],
  ["Aswani Industries Private Limited", "Surat", "Ascolite Aac Block, 600mm x 200mm x 150 mm", "₹4,100/Cubic Meter"],
  ["Bondada Ecobuild Private Limited", "Hyderabad", "SmartBrix AAC Blocks FlyAsh Brix Cement brix 4-Inch, Size: 600*200*100", "₹42/Piece"],
  ["Shanmukha Aac Block Industries", "Hyderabad", "Autoclaved Aerated Concrete Block", "₹40/Piece"],
  ["Arnavi Green Building Materials Private Limited", "Hapur", "Autoclaved Aerated Concrete 75 mm AAC Block", "₹2,750/Cubic Meter"],
  ["Hem Care Corporation", "Rajkot", "Portion Concrete Blocks, 600 x 200 x 200 mm", "₹100/Piece"],
  ["Maa Kaila Devi Tiles", "Noida", "Santo Jali Breeze Block, 200x200MM, Grade: M15", "₹47/Piece"],
  ["Rajtech Engineering", "Belagavi", "Precast Cement Blocks", "₹500/sq ft"],
  ["KJS Concrete Private Limited", "Ghaziabad", "Rectangular Solid Concrete Block, 9 in x 4 in x 3 in", "₹80/Piece"],
  ["K2M Industries", "Chennai", "6 Inch Concrete Block, Grade: M5, 400x200x150mm", "₹47/Piece"],
  ["Padmavati Engineering", "Kalol", "100mm U Shaped Coping Block, Grade: M20, 400x100x100 mm", "₹50/Piece"],
  ["Shree Polymers", "Tiruvallur", "Concrete Breeze Block - SPCBB-05", "₹75/Piece"],
  ["Jogniya Bricks Udhyog", "Bhilwara", "Breeze Block", "₹80/Piece"],
  ["Ensons Gages & Tools Pvt. Ltd.", "Mumbai", "Rectangular Concrete Block, 5 in x 3 in x 2 in", "₹1,200/Piece"],
  ["Decoressa", "Bengaluru", "6 Inch Concrete Solid Blocks, 9 in x 4 in x 3 in", "₹45/Piece"],
  ["Balaji Gypsum Private Limited", "Navi Mumbai", "Rectangular Concrete Blocks, 400x200x200mm", "₹20/Piece"],
  ["Camp Enterprises", "Navi Mumbai", "Rectangular 4inch Concrete Block", "₹36/Piece"],
  ["Guhan Traders", "Walajabad", "Solid Concrete Block M10 (5 N/mm2) - 400x200x100mm", "₹23/Piece"],
  ["Radhe Pavers", "Kalol", "Solid Concrete Block, Grade: M15, 400x200x200mm", "₹60/sq ft"],
  ["Nathan Hollow Blocks", "Walajabad", "Concrete Solid Blocks, Grade: M10, 400x200x200mm", "₹38/Unit"],
  ["Kumar Structural Consultancy", "Bengaluru", "400x200x100mm Solid Concrete Block, Grade: M15", "₹33/Piece"],
  ["Jyoti Cement Udhyog", "Agra", "Concrete Blocks In Agra", "₹250/Piece"],
  ["UHR Pre-Cast Private Limited", "Ahmedabad", "4 Inch Solid Concrete Block", "₹30/Piece"],
  ["Sri Sai Venkateswara Build Tech Private Limited", "Hyderabad", "400x200x100mm Solid Concrete Blocks", "₹75/Piece"],
  ["I C L Concrete Industries", "Hyderabad", "Concrete Solid Block", "₹65/Piece"],
  ["AVS Tech Building Solutions India Private Limited", "Hyderabad", "Concrete Solid Blocks", "₹46/Piece"],
  ["Sadguru Krupa Production", "Pune", "Solid Concrete Block.", "₹42/Piece"],
  ["H.N. Enterprises", "Chennai", "Cement Broken Blocks", "₹30/Piece"],
  ["Mukta Enterprises", "Ahmedabad", "Cement Concrete Block", "₹32/Piece"],
  ["Magic Zone International Private Limited", "Mumbai", "Solid Concrete Block", "₹45/Piece"],
  ["Agarwal Trading Corporation", "Indore", "16x8x4 Inch Concrete Solid Block", "₹39.50/Piece"],
];

const TILES: Listing[] = [
  ["Ceramex Overseas LLP", "Morbi", "Digital Polished Glazed Vitrified Tiles", "₹268/Box"],
  ["Grow Ceramic", "Morbi", "Grow Vitrified Tiles, 600x600 mm", "₹28/sq ft"],
  ["Grepl International", "Rajkot", "Glossy Finish 2x4 Feet Porcelain Polished Ceramic Floor Tiles", "₹28/sq ft"],
  ["Shree Hari Export House", "Morbi", "600x1200 Glazed Vitrified Tiles", "₹21/sq ft"],
  ["Majestic Ceramic", "Morbi", "Vitrified Golden series Verified Tiles, Size: 2 X 2 Feet", "₹26/sq ft"],
  ["L World Tiles", "Morbi", "600x1200 Vitrified Tiles, Finish: Glossy", "₹35/sq ft"],
  ["Kitco Ceramic", "Morbi", "Polished Glazed Glossy Satuario Vitrified Tiles", "₹26/Sq ft"],
  ["Creatas International LLP", "Morbi", "300x600mm Vitrified Carving Tiles, Finish: Satin", "₹85/sq ft"],
  ["Hi-Bid International", "Rajkot", "1200mm Glazed Vitrified Bathroom Tiles", "₹38/sq ft"],
  ["Kanopus International", "Morbi", "Knopus Matt Vitrified tiles 600 x 1200mm", "₹24/sq ft"],
  ["Skyrun Ceramic", "Morbi", "Double Charged Vitrified Tiles 80 X80 Cm, Finish: Glossy", "₹32/Square Feet"],
  ["Larken Group LLP", "Morbi", "Agl Vitrified Tiles, Size: 2x2 Feet", "₹27/sq ft"],
  ["UDC International LLP", "Morbi", "600X1200 Black High Gloss Vitrified Tiles", "₹30/sq ft"],
  ["Zeric Ceramica", "Morbi", "Zeric Porcelain Full Body Vitrified Tiles", "₹350/Box"],
  ["Shri Balaji Exports", "Surat", "Vitrified Tiles, 4x4 ft (1200x1200 mm)", "₹30/sq ft"],
  ["Atlas International Exim", "Morbi", "1 x 2 ft vitrified tiles : wooden tiles", "₹25/sq ft"],
  ["Alonza International", "Morbi", "Vitrified Tiles Flooring, 1200 x 600 mm", "₹26/Square Feet"],
  ["Linum Ceramic", "Morbi", "Gloss White Vitrified Tiles", "₹24/Square Feet"],
  ["Ottawa Vitrified LLP", "Morbi", "Pgvt Vitrified Tiles", "₹25/Square Feet"],
  ["Backbone Ceramic", "Morbi", "300 X 600 Mm Vitrified Tiles", "₹250/sq ft"],
  ["Benison Ceramic", "Morbi", "1200x600 Full Body (15MM) Vitrified Tiles", "₹80/sq ft"],
  ["Tile House", "Chennai", "Steps Vitrified Tile", "₹36/sq ft"],
  ["Marvel And Co.", "Morbi", "Black Vitrified Tiles, Thickness: 10 - 12 Mm", "₹520/Box"],
  ["Shree Ram Ceramic", "Morbi", "Glossy Marble Vitrified Tiles", "₹32/sq ft"],
  ["Bansal Sanitary Store", "Chandigarh", "Vitrified Glossy Qutone Tiles", "₹80/Square Feet"],
  ["Shivanto Global", "Morbi", "2 X 4 Vitrified Tiles", "₹23/sq ft"],
  ["Tile Pro Solutions", "Morbi", "Multicolor 1200 X 2400 Mm Vitrified Slab Tiles", "₹85/sq ft"],
  ["S G Metals", "Jaipur", "RAK Vitrified Floor Tile 600x600 mm", "₹60/sq ft"],
  ["Tiles Centre", "Morbi", "600x1200 mm Pearl Everest Marble Vitrified Floor Tiles", "₹30/sq ft"],
  ["Tap N' Tile", "Morbi", "SIMPOLO DOWTH CREAM VERTIFIED TILES 4'x 9'", "₹332/sq ft"],
  ["Laxmi Ceramic", "Morbi", "600X1200 Rainbow Vitrified Tiles", "₹28/sq ft"],
  ["Coastal Overseas", "Rajkot", "Ceramic 800x1600mm High Glossy Large Floor Tiles", "₹38/sq ft"],
  ["Neora Tiles Private Limited", "Rajkot", "Matte Model 7004 & 7005 Ceramic Parking Tiles", "₹230/Box"],
  ["Vishwas Ceramica", "Morbi", "Vishwas Ceramica 2042 VE Matt Series Floor Tiles", "₹30/sq ft"],
  ["Labh Projects Private Limited", "Ahmedabad", "Ceramic Wall Floor Tiles - Home Kitchen Bathroom", "₹50/sq ft"],
  ["Shree Nilkanth Impex", "Surat", "Digital Printing Wooden Floor Tiles", "₹60/sq ft"],
  ["Lexomo World Wide", "Morbi", "LEXOMO 60 * 60 cm Brown Rustic Tile", "₹25/sq ft"],
  ["Pelican Ceramic Industries Pvt. Ltd.", "Bhiwadi", "Grey Coving Ceramic Tile", "₹150/sq ft"],
];

const RMC_PAVER_BLOCKS: Listing[] = [
  ["Nuvoco Vistas Corporation Limited", "North 24 Parganas", "Nuvoco Xlite Concrete", "₹6,900/Cubic Meter"],
  ["N.K.Sales India", "Noida", "M25 Ready Mix Concrete", "₹5,000/Cubic Meter"],
  ["Modern Marketing Associates", "Hyderabad", "Gray Rmc Ready Mix Concrete, in Hyderabad, For Construction", "₹4,200/Cubic Meter"],
  ["Krishna Enterprises", "Ludhiana", "Grey RMC Ready Mix Concrete", "₹4,900/Cubic Meter"],
  ["Aditya Enterprises", "Siliguri", "Ready Mix Concrete", "₹5,500/Cubic Meter"],
  ["KJS Concrete Private Limited", "Ghaziabad", "Ready Mix Concrete Manufacturer In Noida", "₹5,900/Cubic Meter"],
  ["Aditi Enterprises", "Thane", "ACC Bagcrete Ready Mix Concrete", "₹1,000/Cubic Meter"],
  ["Parshwa Cement", "Banswara", "Ready Mix Concrete", "₹5,000/Cubic Meter"],
  ["Hindustan Infrastructure Solution LLP", "Ahmedabad", "Gray Flowing Column Ready Mixed Concrete", "₹7,000/Cubic Meter"],
  ["Care Concrete Private Limited", "Lucknow", "M-20 Grade Ready Mixed Concrete", "₹5,000/Cubic Meter"],
  ["Gaurav Cement", "Chennai", "Ultratech Aquaseal Rmc M35 Grade (WHOLESALE DISTRIBUTOR)", "₹5,250/Cubic Meter"],
  ["Hindustan Nirman", "Gurugram", "Rmc Ready Mix Concrete", "₹4,500/Cubic Meter"],
  ["Doctor Concrete Solution", "Chandigarh", "Gray Ready Mixed Concrete, For Construction", "₹4,500/Cubic Meter"],
  ["Hella Infra Market Retail Private Limited", "Thane", "Ready Mix Concrete", "₹4,500/Cubic Meter"],
  ["Swastik Corporation", "Mumbai", "Rmc Ready Mix Concrete M10", "₹5,000/Cubic Meter"],
  ["Soham Infra", "Bengaluru", "Gray Ready Mix Concrete Rmc, in Bangalore", "₹4,800/Cubic Meter"],
  ["Kumar Structural Consultancy", "Bengaluru", "Rmc Concrete", "₹4,400/Cubic Meter"],
  ["Shaswat Construction", "Mumbai", "M10 Ready Mix Concrete", "₹6,150/Cubic Meter"],
  ["Shree Guru Raghavendra Constructions And Electricals", "Bengaluru", "Ready Mix Concrete", "₹3,800/Cubic Meter"],
  ["Nakoda Impex", "Mumbai", "Ready Mix Concrete", "₹1,551/Cubic Meter"],
  ["Rodi Dust Marketing & Distributions Private Limited", "Gurugram", "Gray M 25 Ready Mix Concrete, For Construction", "₹4,500/Cubic Meter"],
  ["Sree Balaji Enterprises", "Chennai", "M60 Ready Mix Concrete", "₹5,800/Cubic Meter"],
  ["ASK Associates", "Coimbatore", "Ready Mix Concrete", "₹4,900/Cubic Meter"],
  ["Bhagwat Kalyan Resources", "Jaipur", "M20 Ready Mix Concrete", "₹4,300/Cubic Meter"],
  ["Global Green Enterprises", "Chennai", "M45 Ready Mixed Concrete", "₹6,500/Cubic Meter"],
  ["Dream Metal Industries", "Bengaluru", "Ready Mix Concrete (RMC) Supplier M20 M25 M30 M35 M40", "₹6,500/Cubic Meter"],
  ["Hitex Buildmart India Private Limited", "Jaipur", "Cement Gray Ready Mix Concrete, Grade Standard: M10", "₹600/Cubic Meter"],
  ["Sanvix Concrete Private Limited", "Jajpur", "M30 Grade Ready Mixed Concrete", "₹4,550/Cubic Meter"],
  ["KLG Ecolite", "Kolkata", "Concrete Round Dumble Paver Block, For Home,Industrial, Thickness: 60 Mm", "₹38/Sq Ft"],
  ["G. B. Asbestos Pipes", "Jaipur", "Zigzag Concrete Block Paving, Strength: M30, 60 mm", "₹32/sq ft"],
  ["Maa Rani Sati Sales", "Teghra", "I Shape Interlocking Concrete Paver Blocks, Strength: M40, 2 Inch", "₹15/Piece"],
  ["Sneh Precast & Constosolutions Private Limited", "Pune", "60mm Stone Finish Concrete Paver Block, Strength: M30", "₹45/sq ft"],
  ["Snepra Buildconn", "Pune", "Concrete Paver Block", "₹87/sq ft"],
  ["Vijaya Industries", "Gairkata", "I Shape Paver Block, Material: Concrete", "₹11/Piece"],
  ["Faith Bricks Industries", "Rewa", "Concrete Zig Zag Paver Block, 65 mm", "₹29.50/Sq Ft"],
  ["Kumar Tile Industries", "Dera Bassi", "Cement Rectangular Concrete Interlocking Paver Blocks, Thickness: 60 mm", "₹20/Piece"],
  ["United Ceramics SWG Pipes", "Tandur", "Concrete Paver Block, 60 mm", "₹40/Piece"],
  ["K2M Industries", "Chennai", "Zigzag I Shape Concrete Paver Block, Strength: M30, 60 mm", "₹58/sq ft"],
  ["Tuba Tiles", "Lucknow", "Multicolor 60mm RCC Cement Paver Block", "₹17/Piece"],
  ["New Derivative Chemicals Private Limited", "Alwar", "Brown Outdoor Hexagon Concrete Interlocking Paver Block", "₹8/Piece"],
  ["Mathi Agency", "Chennai", "Zig-Zag 15mm Concrete Red V Paver Block, Strength: M30", "₹20/sq ft"],
  ["Sri Guru Enterprises", "Chennai", "I Shape Concrete Paver Block, Material: Cement", "₹47/Sq Ft"],
  ["Qatar Industries", "Faridabad", "Grey Cobblestone Concrete Paver Block (60mm, M40 Strength)", "₹35/sq ft"],
  ["CNR Marbles", "Hyderabad", "Sand Blasting 60Mm I Shape Concrete Paver Block, Strength: M40", "₹70/sq ft"],
  ["Accurate Buildcon", "Faridabad", "Concrete Paver Block", "₹370/Sq ft"],
  ["SSB Jagtap Enterprises", "Pune", "own Concrete Paver Block, Thickness: Various", "₹55/Sq ft"],
  ["VK Enterprises", "Tiruvallur", "60mm Grey Concrete Diamond Paver Block, Strength: M30", "₹48/Piece"],
  ["Balaji Hardware And Electricales", "Pithampur", "60 mm Concrete Paver Block", "₹40/sq ft"],
  ["Stylish Precast Private Limited", "Kolkata", "Cosmic Paver Block, 60 mm, Grade / Strength: M35", "₹60/sq ft"],
  ["AR Precast (A Brand Of A. R. Builders)", "Gurugram", "Concrete Paver Block Manufacturer in Gurugram, 60 mm", "₹7/Piece"],
  ["S K Enterprises", "Navi Mumbai", "SK Square Split Rock Concrete Paver Block", "₹39/Sq Ft"],
  ["Moulik Enterprises", "Indore", "Concrete Paver Blocks, 5 in x 3 in x 2 in", "₹10/Piece"],
  ["Mayur Bricks", "Howrah", "Square 60 mm Concrete Paver Block", "₹65/sq ft"],
  ["Aayushi Industries", "Indore", "Cement Rectangular Concrete Paver Block", "₹34/Sq ft"],
  ["Nirman Concrete Products", "New Delhi", "I Yellow Concrete Paver Block, Strength: M30", "₹14/Piece"],
  ["Brav0s Exports", "Chennai", "Grey KERB Stone, Usage/Application: Landscaping", "₹225/sq ft"],
  ["Maa Kripa Enterprises", "Udaipur", "Kerb Stone, Thickness: 100 mm, Material: Concrete", "₹80/Piece"],
  ["Dhareshwar Cement Products", "Pune", "Rcc Kerb Stone", "₹80/Piece"],
  ["Vijayata Construction Material", "Thane", "Outdoor Gray Kerb Stones, For Landscaping", "₹140/Number"],
  ["M/S Amit Hatwal Sanitary & Building Material Trading Co.", "Noida", "Kerb Stone", "₹90/Piece"],
  ["Bloster Infra Projects And Products", "Pune", "Gray 1 meter kerb stone, Material: Concrete", "₹395/Piece"],
  ["Nazar Precast Industries Private Limited", "Lucknow", "Pre Cast Kerb Stone", "₹120/Piece"],
  ["Cameo", "Ernakulam", "White Flamed Curb Stone Natural, Material: Granite", "₹190/Piece"],
  ["Pranya Goyal Red Sand Stone", "New Delhi", "Red Sand Stone Kerb Stone, Thickness: 75 mm", "₹60/Piece"],
  ["Super Concrete", "Pune", "Gray RCC Kerb Stone, Thickness: 100 mm", "₹450/Piece"],
  ["Hind Cement Articles", "Lucknow", "Curbstone, Material: Concrete", "₹100/Piece"],
  ["Real India Build Pro", "Chennai", "Concrete Radius Semi Circle Kerb Stone (750mm L x 200mm W x 300mm H)", "₹180/Piece"],
  ["MB Cement Products", "Hoskote", "Gray Rcc Kerb Stone Mb Cement Products in Bangalore", "₹120/Piece"],
  ["Eclat Pavers", "Mumbai", "Rubber Mould Kerb Stone, Thickness: 60mm", "₹45/Square Feet"],
  ["Sree Sai Sastha Corporation", "Coimbatore", "60mm Precast Curbing Stone, Material: Concrete", "₹135/Square Feet"],
  ["Abdullah Enterprises", "Lucknow", "450 mm RCC KERB Stone", "₹90/Piece"],
  ["Trilok Precast", "Kanpur", "Gray 150mm Concrete Kerb Stone, For Garden Edging", "₹72/Piece"],
  ["Deepraj Engineers", "Pune", "Pre Cast Kerb Stone", "₹110/Piece"],
  ["Omi Enterprises", "Guwahati", "300 X 300 X 100mm Chamfered Kerb Stone", "₹95/Piece"],
  ["The Paver Company", "Bengaluru", "Half Batter Kerb Stone", "₹270/Piece"],
  ["Rushi Anand Marbles", "Pune", "Pre Cast Kerb Stone", "₹90/Piece"],
  ["R.V. Tiles Company", "Bengaluru", "Precast Kerb Stones, Material: Concrete", "₹160/Piece"],
  ["S M Traders", "Bengaluru", "Grey Kerb Stones (Dotted), Material: Concrete", "₹180/Piece"],
  ["Technic Pavers", "Bengaluru", "Button Kerb Stone 600x300x100mmm", "₹200/Piece"],
  ["Hindustan Cement Products Company", "Kanpur", "RCC KERB Stone for Park, Garden", "₹60/Piece"],
  ["VSR Bricks", "Maheshwaram", "Grey Kerb Stone Block, Thickness: 110mm", "₹120/Piece"],
  ["Vinayak Technocast Industries", "Ahmedabad", "Road Kerb Stone", "₹28/Piece"],
];

const WASH_BASINS: Listing[] = [
  ["Shree Hari Export House", "Morbi", "Ceramic Undermount Ovel Basin", "₹900/Piece"],
  ["Zeric Ceramica", "Morbi", "Ceramic ZERIC -RIO HALF PEDESTAL WASH BASIN SET", "₹950/Piece"],
  ["Kanopus International", "Morbi", "Ceramic One Piece Basin", "₹4,000/Piece"],
  ["Grepl International", "Rajkot", "White Ceramic Pedestal Wash Basin", "₹600/Set"],
  ["Larken Group LLP", "Morbi", "9002 Hail Ceramic Half One Piece Wash Basin", "₹1,500/Piece"],
  ["Opec Ceramic", "Thangadh", "Ceramic Table Top White Wash Basin", "₹1,200/Piece"],
  ["Grow Ceramic", "Morbi", "Ceramic RANI WASH BASIN 18X13", "₹240/Piece"],
  ["Techno World Corporation", "Rajkot", "Ceramic 18x13 Round Wash Basin", "₹125/Piece"],
  ["Royal International", "Jalandhar", "Stainless Steel Large Basin", "₹230/Piece"],
  ["Hi-Bid International", "Rajkot", "Bathroom Sink Wash Basin", "₹450/Piece"],
  ["Indian Home Crafts", "Rampur", "Single Bowl 16x16 Inch Round Rose Gold Copper Antique Wash Basin", "₹4,600/Piece"],
  ["Linum Ceramic", "Morbi", "One Piece Basin", "₹1,700/Piece"],
  ["Ottawa Vitrified LLP", "Morbi", "Ceramic Bathroom Wash Basins", "₹1,100/Piece"],
  ["Backbone Ceramic", "Morbi", "Ceramic Wash Basin 18x12, White, Wall Mounted", "₹160/Piece"],
  ["Wellvit (A Brand Of Cozy Sanitaryware LLP)", "Morbi", "Ceramic Wellvit 201 Cube Mini Wash Basin Bathroom Sanitary ware", "₹1,050/Piece"],
  ["Apple Thermo Sanitation Pvt. Ltd.", "Mumbai", "Wash Basin", "₹2,250/Piece"],
  ["Blue Bird Minerals", "Udaipur", "Golden Calicanto Brass Metal Washbasin", "₹16,000/Piece"],
  ["Inter National Sales Corporation", "Haridwar", "BRASS Basin Full Set", "₹1,650/Piece"],
  ["Prosafe Living", "New Delhi", "Manual Aluminium Pressalit Height Adjustable Wash Basin System", "₹55,900/Piece"],
  ["Shree Nilkanth Impex", "Surat", "Brass Wash Basin, Roca, Table Top", "₹7,500/Piece"],
  ["Toyo Sanitary Wares Private Limited", "Noida", "TOYO Ceramic Wall Hung Wash Basin, for Bathroom, Model Name/Number: 24029", "₹960/Piece"],
  ["Oswal Hitech Private Limited", "Bengaluru", "Wash Basin Suits", "₹1,200/Piece"],
  ["Decoressa", "Bengaluru", "Senator Fiola Undercounter Basin, Size: 585x430 mm (23x17\")", "₹6,990/Piece"],
  ["Big Matrix Private Limited", "Vasai", "Cementitious Wash Basin", "₹15,500/Piece"],
  ["Bansal Sanitary Store", "Chandigarh", "Kohler Reve 1000Mm Vanity Lavatory Basin , Single Hole", "₹41,400/Piece"],
  ["Blue Star Polymer", "Muzaffarnagar", "Counter Wash Basin", "₹1,200/Piece"],
  ["Touseef International Crafts", "Agra", "Touseefinternationalcrafts Wash Basin Stylish, Size: 400x400 mm (16x16\"), Table Top", "₹45,000/Piece"],
  ["N.M. Handicrafts", "Agra", "Stone PRO395 Lapis Lazuli Wash Basin", "₹5,000/Piece"],
  ["Shree Hari Export House", "Morbi", "Ceramic Wash Basin 14x11", "₹140/Piece"],
  ["Opec Ceramic", "Thangadh", "Ceramic Floor Wash Basin", "₹600/Piece"],
  ["Wellvit (A Brand Of Cozy Sanitaryware LLP)", "Morbi", "Ceramic Wellvit 270 Ruby Corner Wash Basin Bathroom Sanitary ware", "₹1,050/Piece"],
  ["Inter National Sales Corporation", "Haridwar", "Brass Basin Full Set", "₹1,550/Piece"],
  ["Oswal Hitech Private Limited", "Bengaluru", "Hospital Wash Basin", "₹1,200/Piece"],
  ["Rainbow Ceramic", "Thangadh", "Ceramic Wash Basin 18x12", "₹180/Piece"],
  ["Blue Star Polymer", "Muzaffarnagar", "Stainless Steel Foot Operated Wash Basin", "₹11,000/Piece"],
  ["Tile Pro Solutions", "Morbi", "corner wash basin", "₹300/Piece"],
  ["Jay Refractories", "Thangadh", "White Ceramic WB Repose With Pedestal, Shape: Oval", "₹999/Piece"],
  ["Premium Marble Art", "Makrana", "Free Standing Wash Basin", "₹42,000/Piece"],
  ["A.G. Art & Craft", "Makrana", "Black Round Wash Basin", "₹5,999/Piece"],
  ["Marbella Crafts", "Makrana", "Marble vanity washbasin", "₹30,000/Piece"],
  ["Loso Homes", "Makrana", "16 x 16 x 5 Inch Statuario Marble Counter Top Washbasin", "₹14,990/Piece"],
  ["Gravity Bath Private Limited", "Ghaziabad", "Gravity riva21/16 Under counter basin, Size: 520mm x 400mm", "₹3,350/Piece"],
  ["Taj Marble Enterprises", "Makrana", "Cera Round Shape Digital Wash Basin, Wall Hung, Size: 560x405 mm", "₹25,000/Piece"],
  ["Holo Sanitaryware Private Limited", "Morbi", "Ceramic 3103- VITALI Half Wash Basin", "₹2,939/Piece"],
  ["Stones Woods Metals", "Jaipur", "Stones Woods Metals Semi Pedestal Stone Sinks, for Home", "₹17,000/Piece"],
  ["Pharma Technik", "Mumbai", "Pharma Technik Baby Wash Sink - Neo Natal, Wall Hung", "₹12,500/Piece"],
  ["M.R. Marbles", "Makrana", "Wash Basin", "₹6,000/Piece"],
  ["Twinkle Star Enterprises", "Bengaluru", "Stainless Steel Wash Basin Sink", "₹28,000/Piece"],
  ["Jabon Bagno Limited", "Jamnagar", "Ceramic JABON JCI12422 Table Top Wash Basin", "₹3,000/Piece"],
];

const WATER_CLOSETS: Listing[] = [
  ["Majestic Ceramic", "Morbi", "One Piece Water Closet", "₹9,200/Piece"],
  ["Shree Hari Export House", "Morbi", "Irani Two Piece water closet", "₹700/Piece"],
  ["Neora Tiles Private Limited", "Rajkot", "Marco-Op 9001 One Piece Closet", "₹5,400/Piece"],
  ["Opec Ceramic", "Thangadh", "Floor Mounted European Water Closet", "₹6,999/Piece"],
  ["Grow Ceramic", "Morbi", "Designer EWC Water Closet", "₹705/Piece"],
  ["Zeric Ceramica", "Morbi", "Ceramic Zeric Aqua Two piece Water Closet", "₹1,799/Piece"],
  ["Kanopus International", "Morbi", "White Wall Hung Toilet", "₹2,000/Piece"],
  ["Atlas International Exim", "Morbi", "Designer One-Piece Water Closet (Red Brown)", "₹5,000/Piece"],
  ["Ceramex Overseas LLP", "Morbi", "Pastel Colors Western Toilet", "₹4,300/Piece"],
  ["Techno World Corporation", "Rajkot", "European Water Closet", "₹350/Piece"],
  ["Grepl International", "Rajkot", "Round Western One Piece Toilet Set", "₹3,000/Piece"],
  ["Larken Group LLP", "Morbi", "1002 Alice Ceramic Wash Down Closet", "₹2,999/Piece"],
  ["Hi-Bid International", "Rajkot", "Floor Mounted Water Closet", "₹2,500/Piece"],
  ["Skyrun Ceramic", "Morbi", "One Piece Water Closet", "₹2,200/PIECE"],
  ["UDC International LLP", "Morbi", "European EWC Water Closet", "₹350/Piece"],
  ["Fibrecrafts India", "Pune", "Plastic Floor Mounted Portable Western Commode Toilet Cabin", "₹27,000/Piece"],
  ["Labh Projects Private Limited", "Ahmedabad", "Ceramic Water Closet for Toilet - Labh Group", "₹15,000/Piece"],
  ["Wellvit (A Brand Of Cozy Sanitaryware LLP)", "Morbi", "Wellvit 170 Prime Water Closet Bathroom Sanitary ware", "₹4,750/Piece"],
  ["Linum Ceramic", "Morbi", "Ceramic One Piece Toilet Seat", "₹2,650/Piece"],
  ["Backbone Ceramic", "Morbi", "White Italian two piece closet, Floor Mounted", "₹1,200/Piece"],
  ["Ottawa Vitrified LLP", "Morbi", "Italian Toilet Seat", "₹3,850/Piece"],
  ["Sikander Overseas", "Thangadh", "Tarryware White Ceramic Floor Mounted Western Commode Seat", "₹2,800/Piece"],
  ["Apple Thermo Sanitation Pvt. Ltd.", "Mumbai", "Western Toilet Seat", "₹1,000/Piece"],
  ["Aarti Sales", "Panchkula", "European Water Closet", "₹2,500/Piece"],
  ["Florence International", "Mumbai", "Florence Ceramic White Floor Mounted S Trap Water Closet", "₹3,500/Piece"],
  ["Shivanto Global", "Morbi", "Water Closets", "₹1,400/Piece"],
  ["Oswal Hitech Private Limited", "Bengaluru", "Western Commode Toilet Seat", "₹13,500/Piece"],
  ["Benison Ceramic", "Morbi", "Western Toilet Seat", null],
];

const BATHROOM_FAUCETS: Listing[] = [
  ["Pureflow Solutions Private Limited", "Rajkot", "Pureflow White PTMT Health Faucet, For Bathroom", "₹370/Piece"],
  ["Passion (A brand of Ashok Kumar & Sons)", "Ghaziabad", "Passion Pillar Cock Faucet 3/4", "₹570/Piece"],
  ["Shree Hari Export House", "Morbi", "OSIS PLUS Silver Bathroom Faucets Set", "₹1,000/Piece"],
  ["Shreyans Metal Industry", "Ghaziabad", "MOCA Stainless Steel Bib Cock 2 Way Faucet", "₹540/Piece"],
  ["Umiya Plastic Industries", "Ahmedabad", "5 STAR Bathroom Faucets", "₹770/Piece"],
  ["Wellvit (A Brand Of Cozy Sanitaryware LLP)", "Morbi", "Brass Wellvit FL-1903 Pillar Cock bathroom Faucet", "₹1,520/Piece"],
  ["S V Industries", "New Delhi", "pp Parryware Health Faucet, Packaging Type: loose", "₹80/Piece"],
  ["Fortune Sanitation", "New Delhi", "Bathroom Health Faucet", "₹1,000/Piece"],
  ["Tapcon Bathware", "Rajkot", "FLOTUS ABS 1721 Neo Health Faucet With Shower Tube And Hook, 2 Pcs in 1 Box", "₹300/Piece"],
  ["Aura Industries", "Rajkot", "Premium Washroom Faucet", "₹238/Piece"],
  ["R.R.Sanitations", "New Delhi", "imported Jaquar Type Health Faucet Gun, PVC", "₹60/Piece"],
  ["K. M. Udyog", "New Delhi", "ISLA Modern WALL MIXER ALIVE WITH BEND FLORENTINE, For Bathroom Fitting, Size: 15 MM", "₹1,197/Piece"],
  ["Techno Craft", "New Delhi", "Stainless Steel Silver Sink Cock AZARO Blissaro, For Home", "₹1,035/Piece"],
  ["Technolink Plastic", "Rajkot", "Lexa Swan Neck Cock", "₹80/Piece"],
  ["Toyo Sanitary Wares Private Limited", "Noida", "TOYO ABS Health Faucets", "₹1,600/Piece"],
  ["Krishna Cock Industries", "Rajkot", "KCI Cruze Single Lever Wall Mounted Faucet", "₹6,275/Piece"],
  ["Shree Ganesh Traders", "New Delhi", "Brass Round Bathroom Faucet", "₹660/Piece"],
  ["Sagar Technocast", "Rajkot", "Bathroom Faucet", "₹460/Piece"],
  ["Tisha Sanitation", "New Delhi", "Qblu Ess Angle Cock", "₹308/Piece"],
  ["Pearl Global Trading Company", "Pune", "County Health Faucet", "₹90/Piece"],
  ["Inter National Sales Corporation", "Haridwar", "LO064G LOOP TIP ON SPOUT", "₹1,750/Piece"],
  ["Aim Tech", "Jalandhar", "ABS Jadore Health Faucet, For Bathroom", "₹990/Piece"],
  ["Jainone Hub", "New Delhi", "Silver Brass Degree Faucet Extender 720, For Bathroom, Round", "₹38/Piece"],
  ["A & A Corporation", "Secunderabad", "Single control Faucets - Kohler", "₹5,000/Piece"],
  ["Hussaini Sales Corporation", "Chennai", "CHROME Brass Badsha Grohe Pvc Health Faucet Set With Blister Packing", "₹250/Piece"],
  ["Bharmal Enterprises", "Mumbai", "Bathroom Faucet Flange", "₹150/Piece"],
  ["Quick Bond Chemical", "Ahmedabad", "Health Faucet Gun", "₹120/Piece"],
  ["Uni Plast", "Ahmedabad", "PTMT Bathroom Faucet", "₹125/Piece"],
];

const UPVC_PIPES: Listing[] = [
  ["Asian Poly Plast", "Rajkot", "Upvc Pipe (13,000/pc size)", "₹13,000/Piece"],
  ["Kankai Pipes & Fittings Pvt. Ltd.", "Paddhari", "KANKAI Upvc Pipes And Fittings", "₹98/Piece"],
  ["Fitwell Polytechnik Private Limited", "Rajkot", "Fitwell 2 inch UPVC Pipe, 6 m", "₹585/Piece"],
  ["M S Plastic", "Gondal", "UPVC Connection Pipe, 3/4 inch", "₹75/Piece"],
  ["Captain Polyplast Limited", "Rajkot", "CAPTAIN 1/2 inch Upvc Plumbing Pipes", "₹50/Piece"],
  ["Kamdhenu Poly Plast", "Rajkot", "Kamdhenu Upvc Plumbing Pipes", "₹72/Kg"],
  ["Aroplast Enterprise", "Ahmedabad", "40mm UPVC Pipe", "₹220/Piece"],
  ["Dolphin Poly Plast Pvt. Ltd.", "Rajkot", "Upvc Pipe", "₹15/Meter"],
  ["Sagar Polytechnik Ltd.", "Rajkot", "Sagar 12 inch UPVC Ring Fit Pressure Pipe", "₹375/Meter"],
  ["Rajarana Impex Private Limited", "Rajkot", "White UPVC Round Pipe", "₹350/Piece"],
  ["Jekmin Industries", "Ahmedabad", "UPVC Pipe", "₹25/Piece"],
  ["Larken Group LLP", "Morbi", "Upvc Pipe", "₹300/Piece"],
  ["Fairbizps", "New Delhi", "UPVC Pipe, 6 m", "₹690/Piece"],
  ["Shivom Polyplast (India) Private Limited", "Rajkot", "3/4 Inch 6m 80-SCH UPVC Pipe", "₹200/Piece"],
  ["R.N. Industries", "Jaipur", "1 inch MODI UPVC Pipes, 3m", "₹100/Piece"],
  ["Fine Flow Plastic Industries", "Mumbai", "Ashirvad 4 Inch UPVC Pipe, 3 m", "₹340/Piece"],
  ["Savoir Faire Manufacturing Co. Private Limited", "Haridwar", "SFMC 4 inch UPVC Pipes, 6m", "₹3,486/Piece"],
  ["Reva Polyplast", "Rajkot", "White & Red Rio 1/2 inch UPVC Plumbing Pipes", "₹115/Meter"],
  ["Joton Industries", "Rajkot", "JOTON white UPVC PIPE 80 SCH", "₹480/Piece"],
  ["Anecul Sales", "Agra", "Upvc Column Pipes", "₹100/Piece"],
  ["Vigor Plast India Limited", "Jamnagar", "Vigor UPVC Plumbing Pipe SCH-80 3 mtr", "₹126/Piece"],
  ["Krishi Polymers Private Limited", "Bengaluru", "UPVC Plastic Pipe", "₹87.54/Meter"],
  ["R. K. Irrigation Systems Limited", "Paddhari", "Jeelflow Upvc Pipe SCH 80 1\" 3 meter", "₹594/Piece"],
  ["Apollo Pipes Limited", "New Delhi", "Apollo SCH-80 UPVC Pipe for Plumbing", "₹109/Meter"],
  ["Dinesh Irrigation Private Limited", "Jaipur", "2 inch Selfit PVC U Pipes, 6 m", "₹75/Piece"],
  ["Austro Plastic Industries LLP", "Hyderabad", "110 mm UPVC SN-4 Pipe", "₹470/Piece"],
  ["Shreeram Polytech", "Gondal", "UPVC Pipe", "₹75/Kg"],
  ["Prashant Polymers", "Rajkot", "White UPVC Pipe, 6 m", "₹200/Meter"],
  ["Aroplast Enterprise", "Ahmedabad", "25mm UPVC Pipe", "₹80/Piece"],
  ["Captain Polyplast Limited", "Rajkot", "CAPTAIN UPVC Agriculture Irrigation Pipe", "₹200/Piece"],
  ["Kankai Pipes And Fittings Pvt. Ltd.", "Paddhari", "KANKAI UPVC PIPES", "₹170/Piece"],
  ["Prashant Polymers", "Rajkot", "Upvc Pipe (15mm)", "₹48/Piece"],
  ["R.N. Industries", "Jaipur", "MODI UPVC Pipes, 4 inches", "₹200/Piece"],
  ["Florex Green (India) Private Limited", "Rajkot", "2 inch Upvc Pipe, 3 m", "₹50/Piece"],
  ["Apollo Pipes Limited", "New Delhi", "Apollo Sch 40 UPVC Pipe", "₹88/Meter"],
  ["Expert Pipe & Fittings", "Rajkot", "Expert UPVC Pipe", "₹150/Kg"],
  ["Keshav Industries", "Patna", "Keshav Industries White Industrial UPVC Pipe", "₹100/Kilogram"],
  ["G.K. Plastics", "Coimbatore", "Industrial Upvc Pipes", "₹500/Piece"],
  ["Utkarsh India Limited", "Kolkata", "Utkarsh UPVC Pipe, 6 m", "₹85/Kg"],
  ["Bansal Pipe Industries", "Maksi", "Bansal 63mm to 160mm UPVC SWR Pipe", "₹200/Piece"],
  ["Aquachem Industries Private Limited", "Ahmedabad", "Aquachem 1/2 inch Upvc Plumbing Pipes Sch 40", "₹55/Piece"],
];

const UPVC_FITTINGS: Listing[] = [
  ["Kankai Pipes And Fittings Pvt. Ltd.", "Paddhari", "UPVC Fittings", "₹47/Piece"],
  ["Perfect Engineering Corporation", "New Delhi", "Supreme UPVC Pipe Fittings", "₹25/Piece"],
  ["Jekmin Industries", "Ahmedabad", "White Upvc Pipe Fittings", "₹3.25/Piece"],
  ["Fitwell Polytechnik Private Limited", "Rajkot", "UPVC Pipe Fittings", "₹59/Piece"],
  ["Kamdhenu Poly Plast", "Rajkot", "UPVC STEP OVER BAND", "₹36/Piece"],
  ["M S Plastic", "Gondal", "Upvc Pipes And Fittings", "₹8/Piece"],
  ["Agromark Polymer", "Ahmedabad", "Astral UPVC Pipe Fittings, Size/Diameter: 3/4 inch", "₹130/Kg"],
  ["Asian Poly Plast", "Rajkot", "2 Inch UPVC Pipes And Fittings", "₹10/Piece"],
  ["Kanan Plast", "Ahmedabad", "Kanan Plast UPVC Pipe Fittings", "₹31/Piece"],
  ["Dhananjay Polymers", "Rajkot", "Upvc Pipe Fittings", "₹3.50/Piece"],
  ["Sagar Polytechnik Ltd.", "Rajkot", "UPVC Fitting Coupler", "₹4.33/Piece"],
  ["Dolphin Poly Plast Pvt. Ltd.", "Rajkot", "White UPVC Pipe Fittings", "₹100/Kg"],
  ["Nirmit Polymer Private Limited", "Ahmedabad", "JK UPVC Pipe Fittings", "₹8/Piece"],
  ["Captain Polyplast Limited", "Rajkot", "Upvc Step Over Bend Pipe Fitting", "₹75.25/Piece"],
  ["Labh Projects Private Limited", "Ahmedabad", "Plastic Pipe Fittings - PVC CPVC UPVC - Labh Group", "₹30/Piece"],
  ["Tradewell Ferromet Private Limited", "Mumbai", "Upvc Pipe Fittings", "₹200/Piece"],
  ["Falcon Pipes Private Limited", "Gondal", "UPVC Cross Pipe Fitting, Size: 15 mm", "₹16.46/Piece"],
  ["Prashant Polymers", "Rajkot", "1 inch UPVC Reducer Fittings, Plumbing", "₹9.50/Piece"],
  ["Shivom Polyplast (India) Private Limited", "Rajkot", "1 Inch UPVC Plain Tee", "₹14/Piece"],
  ["Shree Ram Plastic", "Rajkot", "WINMAX White Upvc Pipe Fittings, 3m", "₹81/Piece"],
  ["Thangam Polymers (Madras)", "Chennai", "Truplast 1 inch Upvc Pipe Fittings, 6 m", "₹80/Kg"],
  ["S V Industries", "New Delhi", "1 Inch UPVC FTA", "₹11/Piece"],
  ["Mahalaxmi Traders", "Kolkata", "Supreme Upvc Pipes And Fittings, Size/Diameter: 1 inch", "₹32/piece"],
  ["R.N. Industries", "Jaipur", "MODI UPVC Reducer Elbow", "₹15/Piece"],
  ["Florex Green (India) Private Limited", "Rajkot", "Upvc Pipe Fittings, Diameter: 3 Inch", "₹6/Piece"],
  ["Shreeram Polytech", "Gondal", "upvc MTA & FTA", "₹5/Piece"],
  ["Utkarsh India Limited", "Kolkata", "UPVC Pipe Fittings", "₹50/Piece"],
  ["Reva Polyplast", "Rajkot", "Upvc Pipes And Fittings", "₹95/Piece"],
];

const CPVC_PIPE: Listing[] = [
  ["Hari Om Polyplast", "Rajkot", "1 inch Worldflow Cpvc Pipe Isi With Cml Sdr 13.5", "₹132/Piece"],
  ["Sagar Polytechnik Ltd.", "Rajkot", "1 inch Sagar CPVC SDR 13.5 Pipe, 3 m", "₹122/Piece"],
  ["Asian Poly Plast", "Rajkot", "2 Inch CPVC Pipe, Pressure Class: Sdr 13.5", "₹100/Meter"],
  ["Kankai Pipes And Fittings Pvt. Ltd.", "Paddhari", "CPVC Plastic Plumbing Pipes KANKAI", "₹130/Meter"],
  ["Captain Polyplast Limited", "Rajkot", "2 1/2 Inches Chlorinated Polyvinyl Chloride Cpvc Pipes", "₹1,000/Meter"],
  ["Fitwell Polytechnik Private Limited", "Rajkot", "Fitwell 0.5 inch CPVC Elbow", "₹60/Piece"],
  ["Kamdhenu Poly Plast", "Rajkot", "Cpvc Pipe, Pressure class: SDR 11, 3/4 inch", "₹125/Kg"],
  ["Jekmin Industries", "Ahmedabad", "Aarya 1/2 inch CPVC Pipe, 6 m", "₹65/Kg"],
  ["Flowton Pipe Private Limited", "Ahmedabad", "1 Inch Cpvc Pipe", "₹367/Piece"],
  ["Monalisa Global Ventures", "Raipur", "Cpvc Pipe And Fitting, Pressure Class: Sdr 13.5, 1 inch", "₹150/Meter"],
  ["Dolphin Poly Plast Pvt. Ltd.", "Rajkot", "CPVC Pipe - SDR 13.5, For Plumbing", "₹36/Meter"],
  ["Accent International", "Rajkot", "SDR 13.5 CPVC Pipes for Plumbing 1.5 inch", "₹342/Piece"],
  ["Labh Projects Private Limited", "Ahmedabad", "UPVC 6 inches Plastic CPVC Pipes - Labh Group", "₹70/Meter"],
  ["Shivom Polyplast (India) Private Limited", "Rajkot", "2 Inch 3m CPVC SDR11 Pipe", "₹402/Piece"],
  ["Prashant Polymers", "Rajkot", "3m CPVC Pipe", "₹220/Kg"],
  ["Shree Ram Plastic", "Rajkot", "WINMAX 3/4\" Cpvc Pipe, 3 m", "₹150/Piece"],
  ["Mahalaxmi Traders", "Kolkata", "CPVC Water Pipes, Pressure class: PN 16", "₹90/Piece"],
  ["Savoir Faire Manufacturing Company Private Limited", "New Delhi", "1 Inch CPVC Pipe, Pressure class: SDR 11", "₹221/Piece"],
  ["R.N. Industries", "Jaipur", "Modi CPVC Pipes, 3 M", "₹100/Piece"],
  ["Sangir Plastics Private Limited", "Mumbai", "CPVC Pipe", "₹100/Piece"],
  ["Utkarsh India Limited", "Kolkata", "0.75 Inch Utkarsh CPVC Pipe", "₹65/Piece"],
  ["Reva Polyplast", "Rajkot", "Cpvc Plumbing Pipe, 1 inch, Pressure class: SDR 11", "₹320/Piece"],
  ["Industrial Engineering Syndicate", "New Delhi", "1/2 inch Ashirvad CPVC Pipe, 3 m", "₹30/Piece"],
  ["M K Polymers", "Rajkot", "Hardtube Yellow CPVC Pipes", "₹127/Kilogram"],
  ["Durga Traders", "New Delhi", "3/4 inch Ajay Cpvc Pipe, 3 m", "₹205/Piece"],
  ["Aquachem Industries Private Limited", "Ahmedabad", "3 m Cpvc Pipes Sdr 13.5, 0.5 Inch", "₹63/Piece"],
  ["Giriraj Pipes & Fittings", "Gondal", "Cpvc Plumbing Solution", "₹24/Piece"],
  ["Austro Plastic Industries LLP", "Hyderabad", "Austro 3 inch CPVC Pipe, 3 m", "₹1,637/Piece"],
];

const UPVC_WINDOWS: Listing[] = [
  ["SV Eco Industries", "Hyderabad", "Upvc Glass Window", "₹160/sq ft"],
  ["AMD Overseas Impex India Private Limited", "Tiruppur", "Upvc Corner Window", "₹950/sq ft"],
  ["PRF Udyog", "Singtam", "UPVC Corner Window", "₹450/Square Feet"],
  ["Artica Windows & Doors", "Coimbatore", "ARTICA Upvc Openable Windows", "₹435/Square Feet"],
  ["SBM Pipe Industries Private Limited", "Siliguri", "SBM GOLD Villa Upvc Windows", "₹500/sq ft"],
  ["Dec Industries Private Limited", "Hyderabad", "White Affordable UPVC Windows", "₹450/sq ft"],
  ["Raimata Impex Private Limited", "Kolkata", "POLYSASH Sound Proof UPVC Windows", "₹499/Square Feet"],
  ["Rajshri Plastiwood Division", "Indore", "Openable Upvc Windows, Casement Window", "₹300/sq ft"],
  ["Megha Industries", "Coimbatore", "UPVC Bedroom Window", "₹320/Square Feet"],
  ["Stay Bright Windows", "New Delhi", "Upvc Exterior Window", "₹600/sq ft"],
  ["Bharuka Industries", "Varanasi", "UPVC Windows, Sliding Window", "₹446/sq ft"],
  ["Oberoi Fenestrations Private Limited", "Kanpur", "White UPVC Double Hung Window", "₹55/Square Feet"],
  ["Flair International", "Jalandhar", "UPVC Windows, Fixed Window", "₹700/Unit"],
  ["Timbe Windows Private Limited", "Chennai", "upvc doors and windows", "₹550/sq ft"],
  ["Super Win Technologies", "Ahmedabad", "Casement UPVC VILLA WINDOW", "₹550/sq ft"],
  ["North Bengal Metal And Allied Industries", "Siliguri", "Veka Upvc Window Color", "₹1,050/Square Feet"],
  ["Ambicka Enterprises", "Chennai", "LG Hausys UPVC Mesh Window", "₹450/Square Feet"],
  ["Dhabriya Polywood Limited", "Jaipur", "Upvc Sliding Window", "₹550/Square Feet"],
  ["Mahindra Steels And Infrastructure", "Rajahmundry", "Green tech White Upvc Windows", "₹430/sq ft"],
  ["P S Corporation", "Chennai", "Wooden Modern Upvc Windows And Doors", "₹350/Square Feet"],
  ["Simta Clear Coats Private Limited", "Chennai", "Upvc Windows In Coimbatore", "₹550/sq ft"],
  ["Rancare Industries Ltd.", "Khammam", "Fenesta Upvc Windows", "₹350/sq ft"],
  ["NU Look Door And Windows", "Ajmer", "Fab UPVC Windows", "₹550/Square Feet"],
  ["Arccon Trading Private Limited", "Noida", "Arccon Upvc Sliding Window", "₹750/Sq ft"],
  ["J. K. International", "Jalandhar", "Upvc Sliding Window", "₹825/sq ft"],
  ["Fancy Frame Glass Stores", "Nagpur", "Saint Gobain Upvc Sliding Window", "₹1,000/Sq ft"],
  ["Lari Interior", "Kanpur", "Ferytech UPVC Swing Type Window", "₹350/sq ft"],
  ["Star CNC Job Works", "Lucknow", "Upvc Doors Windows, Combination Window", "₹500/sq ft"],
  ["Desara Design Private Limited", "Bengaluru", "Upvc Windows", "₹485/sq ft"],
  ["Shri Ram Buildtech", "Greater Noida", "Lesso Upvc Bathroom Windows", "₹550/Piece"],
  ["Sarvraj Buildtech Private Limited", "Greater Noida", "Modular Upvc Window", "₹500/sq ft"],
  ["The Windowmart LLP", "Jaipur", "Prominance Residential UPVC Sliding Window", "₹650/sq ft"],
  ["Mukund Windows & Glaze Systems Private Limited", "Jamshedpur", "Upvc Windows, Sliding Window", "₹420/sq ft"],
  ["Hindustan Enterprises", "Prayagraj", "YASHPOLY UPVC Windows", "₹500/Piece"],
  ["Fortune Enterprises", "Chennai", "Fortune Enterprises 10 mm UPVC Awning Glass Window", "₹330/sq ft"],
  ["B A UPVC Window Interior Designer", "Ghaziabad", "L Shape UPVC Corner Window", "₹550/sq ft"],
  ["Chiru Fenestration Private Limited", "Bengaluru", "Upvc Casement Windows", "₹650/sq ft"],
  ["Shani Corporation Ltd.", "Sikandrabad", "5mm UPVC Windows", "₹750/sq ft"],
];

const FLUSH_DOORS: Listing[] = [
  ["VK Clean Rooms", "Vadodara", "Galvanized Iron Flush Door (2400mm x 1200mm x 40mm)", "₹55,000/Piece"],
  ["Paan Door And Company", "Gondal", "Laminated Designer Sunmica Flush Door, 30 mm", "₹120/sq ft"],
  ["Duroply Industries Limited", "New Delhi", "Duro Flush Door 32mm", "₹241/sq ft"],
  ["Sri Vinayaga Timber And Wood Works", "Chennai", "40mm Flush Door", "₹235/sq ft"],
  ["Cubicle India", "Vasai Virar", "Flush Door, For Office", "₹10,000/Piece"],
  ["Gold Wood Industries", "Yamuna Nagar", "Decorative Laminated Flush Door, For Industry", "₹75/sq ft"],
  ["Angel Digital Print", "Ahmedabad", "Pine Wood Flush Door", "₹70/sq ft"],
  ["DS Door (India) Limited", "Faridabad", "Modern Flush Doors", "₹582/sq ft"],
  ["Unex Profiles", "Valsad", "7 Feet Flush Door", "₹70/sq ft"],
  ["A K Lumbers Ltd.", "New Delhi", "Brown Laminated 35mm Supa Flush Doors", "₹125/sq ft"],
  ["Ehsan Agro Wood Products Private Limited", "Gorakhpur", "Splice 5 Star Calibrated Flush Door", "₹188/sq ft"],
  ["Tambi Timbers LLP", "Jaipur", "Standard Century Flush Door", "₹166/sq ft"],
  ["Dec Industries Private Limited", "Hyderabad", "Flush Doors", "₹140/sq ft"],
  ["LN Timbers And Ply LLP", "Surat", "Wooden Flush Doors, Height: 96 Inch", "₹105/sq ft"],
  ["Bharuka Industries", "Varanasi", "Plywood Flush Door, 2100 mm (7 ft), 35 mm", "₹159/sq ft"],
  ["Tufwud Doors And Accessories Private Limited", "Kolkata", "Interior Teak Flush Door, For Home", "₹210/sq ft"],
  ["Tajpuria Industries Pvt. Ltd.", "Lucknow", "Tajpuria Club Gold 30mm Flush Door", "₹180/sq ft"],
  ["Right Choice", "Jodhpur", "Flush Door Manufacturers, For Home", "₹320/sq ft"],
  ["Kenya Furniture", "Ludhiana", "Exterior Wooden Flush Doors, For Home, Height: 80 Inch", "₹300/sq ft"],
  ["Windoors International Limited", "Mumbai", "Steel Metal Flush Door", "₹3,800/Piece"],
  ["Atul Udyog", "Manesar", "Metal Stainless Steel MS Flush Doors", "₹150/sq ft"],
  ["Balaji Timber And Plywood Private Limited", "Zirakpur", "Flush Door", "₹92/sq ft"],
  ["Dadi Gouri Plywood", "Patna", "Plywood And Flush Doors, 2100 mm (7 ft), 35 mm", "₹150/sq ft"],
  ["Panchal Timber And Door House", "Gurugram", "Flush Doors manufacturer", "₹190/sq ft"],
  ["Jai Mata Traders", "Gurugram", "30MM FLUSH DOOR DARKBULL", "₹120/sq ft"],
  ["Jyothi Interiors", "Rangareddy", "Flush Door, 30 mm, 2100 mm (7 ft)", "₹95/sq ft"],
  ["Shyamala Interior", "Bengaluru", "Flush Doors, 30 mm", "₹85/sq ft"],
  ["Dikshant Enterprises", "Agra", "30 Mm Brown Wooden Membrane Door", "₹170/sq ft"],
];

const ALUMINIUM_WINDOWS: Listing[] = [
  ["Aashish Enterprises", "Mumbai", "Euro Series Glass Aluminium Window, Number of Tracks: 3 Track, Sliding", "₹500/sq ft"],
  ["Camroopine International", "Surat", "Powder Coated Sliding Aluminium Window with 2 Tracks (5mm Toughened Glass)", "₹350/sq ft"],
  ["Labh Projects Private Limited", "Ahmedabad", "Aluminium Doors and Windows - Labh Group", "₹2,500/Piece"],
  ["Euro Architrade Private Limited", "Chennai", "System Aluminium Windows", "₹900/sq ft"],
  ["AMD Overseas Impex India Private Limited", "Tiruppur", "Slim Series Aluminium Window", "₹650/sq ft"],
  ["Bharuka Industries", "Varanasi", "Domal Silver Aluminium Window, Number of Tracks: 2 Track, Casement", "₹325/sq ft"],
  ["Kohli Aluminium & Hardware", "New Delhi", "Aluminium Window", "₹1,400/sq ft"],
  ["Bansal Sanitary Store", "Chandigarh", "Rectangular Aluminium Doors And Windows, For Window Frames", "₹2,000/sqft"],
  ["K.D. Trading Company", "Ahmedabad", "Transparent Aluminium Glass Window, For Office", "₹350/sq ft"],
  ["Om Aluminium Udyog", "New Delhi", "Standard Aluminium Euro Series", "₹90/Sq ft"],
  ["Simta Clear Coats Private Limited", "Chennai", "Aluminium Front Elevation", "₹1,200/sq ft"],
  ["Royal Glass And Aluminium", "Mumbai", "27mm Series Domal Aluminium Window", "₹395/Square Feet"],
  ["Motherland Marketing & Services", "Ahmedabad", "Standard Sliding Aluminium Window", "₹440/sq ft"],
  ["Omalco Extrusion Private Limited", "New Delhi", "Gray Aluminium Doors And Windows, For Home", "₹310/sq ft"],
  ["J. B. N. Glass & Aluminium", "Gurgaon", "Euro Series Aluminium Window, Casement, Number of Tracks: 3 Track", "₹180/Square Feet"],
  ["Nibedita Enterprise", "Kolkata", "Swing Aluminium Openable Window", "₹230/sq ft"],
  ["Nine Bearings (India) Private Limited", "Dombivli", "Aluminium Powder Coating Vertical Windows", "₹3,000/sq ft"],
  ["Karna Timbers", "Madurai", "Weatherseal System Aluminium Windows and Doors by Asian Paints", "₹900/sq ft"],
  ["Sai Associates", "Vijayawada", "3 Track Aluminium Sliding Windows", "₹700/sq ft"],
  ["Mukund Windows & Glaze Systems Private Limited", "Jamshedpur", "Silver Powder Coated Aluminium Window, Sliding", "₹350/sq ft"],
  ["Samruddhi Aluminium And Glass", "Pune", "Euro Series Aluminium Sliding Window, Number of Tracks: 3 Track", "₹250/sq ft"],
  ["Sunmax", "Bhopal", "Ivory Aluminium System Window", "₹1,200/sq ft"],
  ["Rising Industries", "Pune", "Powder Coated Aluminium Bathroom Windows, For Home, Modern", "₹260/Square Feet"],
  ["Satya Associates", "Vadodara", "Coated Aluminium Openable Window, For Home, Modern", "₹480/Sq ft"],
  ["Window Master India Private Limited", "New Delhi", "Aluminium Window", "₹850/sq ft"],
  ["Super Win Technologies", "Ahmedabad", "Coated Aluminium Window, For Home, Modern", "₹650/sq ft"],
  ["Viraat Aluminium Works", "Hyderabad", "White Aluminum Openable Window, For Office", "₹450/Square Feet"],
  ["Vishwakarma Enterprises", "Badlapur", "White Aluminium Curved Window", "₹1,200/sq ft"],
];

const WATERPROOFING_CHEMICALS: Listing[] = [
  ["Sakshi Chem Sciences Private Limited", "Butibori", "Waterproofing Chemicals For Construction", "₹55/Kg"],
  ["Redwop Chemicals Pvt. Ltd.", "Rajkot", "REDWOP _ SUPERKOT _ Waterproofing Chemicals", "₹500/Kg"],
  ["Kalyan Industries", "Sihor", "Plaster Waterproofing Chemicals", "₹72/Litre"],
  ["Techno Trade Associates", "Jaipur", "MC-Bauchemie Zentrifix Elastic Chemical", "₹95/Kg"],
  ["Tjikko Private Limited", "Vadodara", "Analytical Grade Shaliplast LW Waterproofing Chemical", "₹76/Kg"],
  ["Adrija Scientific Instrument Company", "Kolkata", "Transparent Zydex Zycrete 2X, 99", "₹2,500/Kg"],
  ["Patel Export Industries", "Surat", "SBCHEM Waterproofing Chemical", "₹150/Kg"],
  ["Mahad Infrastructure Private Limited", "Mumbai", "6 kg Sikadur 31 C", "₹475/Kg"],
  ["Milestone Infra", "Navi Mumbai", "Waterproofing Coating Dr Fixit Flexi Pu 270 I", "₹250/Kg"],
  ["Dubond Products India Private Limited", "Ahmedabad", "Roof Shield Water Proofing Chemical", "₹1,350/Kg"],
  ["Gubbi Enterprises", "Thane", "Sunanda Chemicals", "₹245/Kg"],
  ["Shreeji Chemical Industries", "Surat", "Cement Waterproofing Chemical", "₹160/Kg"],
  ["Waltar Enterprises", "Bhiwandi", "Water Repellent WR", "₹400/Kg"],
  ["Nova Polychem", "New Delhi", "Concrete Finishes White INFICRYL I 76", "₹85/Kg"],
  ["S.R.Chemical", "Kalol", "Waterproofing Chemical", "₹350/Kg"],
  ["A K Bitumen Products", "Faridabad", "Ak Bitumen Products Waterproofing Chemical", "₹150/Kg"],
  ["Yashas Enterprises", "Chennai", "Mapecoat DW 25 /B bottles 1 kg", "₹2,400/Kg"],
  ["Chandigarh Trade Link", "Zirakpur", "Chemical Grade Sikalastic 450 I Waterproofing Chemicals", "₹350/Litre"],
  ["Devata Associates", "Chennai", "Sika Integral Waterproofing Compound Liquid Membrane", "₹149/Litre"],
  ["Antique Designer Tiles", "Morbi", "20 L Cem-Bond AW+111 Waterproofing Chemical", "₹1,850/Litre"],
  ["Antony Water Proofing", "Chennai", "BOSTIK BOSOCRETE (1LTR)", "₹295/Litre"],
  ["ADT Industries", "Navi Mumbai", "Conplast WL Integral Waterproofing Liquid", "₹80/Kg"],
  ["Adhere Bonds Coats Pvt. Ltd.", "Chennai", "Adhere Bonds Waterproofing Chemical", "₹166/Kg"],
  ["Siddhi Vinayak Construction Chemical Private Limited", "Satna", "SUPER SEAL, Packaging Size: 20 LTR", "₹305/Litre"],
  ["Vivid India", "New Delhi", "Analytical Grade good quality Waterproofing Chemicals", "₹915/Kg"],
  ["Bils Innovations India Private Limited", "New Delhi", "MC-Bauchemie Roofex 2000", "₹250/Kg"],
  ["Pexi Chem Private Limited", "Sarigam", "pexi chem Additives Water Proofing Chemical", "₹95/Kg"],
  ["Monarch Coating Pvt. Ltd.", "Mumbai", "Glo-protek Con-solution-100 (cs-100) Waterproofing Solution", "₹270/Litre"],
  ["Jemkon Private Limited", "Pune", "1 Kg Industrial Waterproofing Chemical", "₹30/Kg"],
  ["M.K. Petro Products India Private Limited", "Faridabad", "Industrial Grade Waterproofing Chemical For Terrace", "₹125/Kg"],
  ["Antique Designer Tiles", "Morbi", "5 L Cem-Bond AW+111 Waterproofing Chemical", "₹590/Litre"],
  ["Hawks Paints & Coatings Private Limited", "Mumbai", "Waterproofing Chemical", "₹1,700/Pack"],
  ["Guard Speciality Products Limited", "Vasai", "ImperGuard Waterproofing Chemical", "₹694/Litre"],
  ["Stanrose Envirotech India Private Limited", "Boisar", "Stanrose 20L Waterproofing Chemicals", "₹390/Kg"],
  ["Unicrete Building Solutions (India) Private Limited", "Sonipat", "102 IWC Power + ", "₹289/Kg"],
  ["Dr. S. Bond Construction Chemicals", "Hyderabad", "Brushbond Waterproofing Chemicals", "₹300/Litre"],
  ["Semitrone Conchem Limited", "Ahmedabad", "Semitrone Maxproof IWC Waterproofing Chemicals", "₹815/Kg"],
  ["Polymat Corporation", "Surat", "Industrial Grade Waterproofing Chemical Sheta", "₹420/Kg"],
  ["Chitra Insultec Private Limited", "Ahmedabad", "weather tuff Sunken Area Waterproofing Chemical", "₹280/Kg"],
  ["Sindhu Construction Products And Services", "Navi Mumbai", "Weldrite AWL Waterproofing Chemical", "₹315/Litre"],
  ["Akshar Enterprise", "Rajkot", "Tiles Additive Waterproofing Chemical", "₹50/Kg"],
  ["Trimurti Wall Care Products Private Limited", "Bikaner", "Trimurti 20 Ltr Hydroproof Waterproofing Solution", "₹3,200/Litre"],
  ["Dhvani Industries Private Limited", "Ahmedabad", "waterproofing chemical", "₹265/Kg"],
  ["Saif Chemicals Private Limited", "Mumbai", "Water Proofing Compounds Industrial Grade", "₹100/Kilogram"],
  ["Reliance Products", "Jalandhar", "Religuard Tapecrete Rp-150 Waterproofing Chemicals", "₹230/Kg"],
  ["Preciseaxis Private Limited", "Bengaluru", "10L Mataseal-Wl Water Proofing Liquid", "₹45/Litre"],
];

const TILE_ADHESIVES: Listing[] = [
  ["Redwop Chemicals Pvt. Ltd.", "Rajkot", "Redwop Teratile Prolix Extra - Extra Strength Tile Adhesive", "₹2,200/Bag"],
  ["Shree Hari Export House", "Morbi", "Tile Adhesives", "₹250/Bag"],
  ["Swift Imports", "Anand", "Tile Adhesive BS GOLD 201", "₹800/Bag"],
  ["Neora Tiles Private Limited", "Rajkot", "High-Strength Tile Adhesive for Wall & Floor GRADE TYPE 1 GREY", "₹450/Bag"],
  ["Ethios Enviro Solutions Private Limited", "Ahmedabad", "Best Tile Adhesive Bronco Dura Flex, 20 KG, Grey", "₹780/Bag"],
  ["Larken Group LLP", "Morbi", "Tile Adhesive, 20 kg", "₹150/Bag"],
  ["Jemkon Private Limited", "Pune", "25 Kg Tile Adhesive, Bucket", "₹468/Bag"],
  ["Atlas International Exim", "Morbi", "Tile Adhesives, Grey, 20 kg", "₹170/Bag"],
  ["Sakshi Chem Sciences Private Limited", "Butibori", "White Tile Adhesives", "₹500/Bag"],
  ["Techno Trade Associates", "Jaipur", "BuildSmart BS Tileasy Adhesive, Bag", "₹1,029/Bag"],
  ["Virsun Industries", "Alwar", "Virsun Sun Fix Tile Adhesive And Tile Grout, 20 Kg, Bag", "₹380/Bag"],
  ["Dubond Products India Private Limited", "Ahmedabad", "Glass Mosaic Adhesive, 20 k.g, Bag", "₹1,010/Bag"],
  ["JR Bond Conchem LLP", "Morbi", "JR Bond Gold Tile Adhesive, 20 kg, Grey", "₹500/Bag"],
  ["Mahad Infrastructure Private Limited", "Mumbai", "Sika Ceram 288 H Tile Adhesive (White), 25 Kg, Bag", "₹1,450/Bag"],
  ["Milestone Infra", "Navi Mumbai", "ULTRATECH TILEFIXO - VT WHITE 20 KG, Bag", "₹250/Bag"],
  ["Patel Export Industries", "Surat", "TILE AD SCA TYPE 1, 25 kg, Grey", "₹180/Bag"],
  ["Majestic Ceramic", "Morbi", "Majestic Tile Adhesive", "₹500/Bag"],
  ["Chemi Protect Engineers", "Ahmedabad", "Cementitious Epoxy Tile Adhesive", "₹250/Bag"],
  ["Alonza International", "Morbi", "20 kg Alonza Adhesive, Bag", "₹470/Bag"],
  ["Awis Cera LLP", "Morbi", "Tile Adhesives(4 star silver -C2T)", "₹650/Bag"],
  ["Linum Ceramic", "Morbi", "Roff Tile Adhesives", "₹500/Bag"],
  ["Yashas Enterprises", "Chennai", "Kerakoll Biotile Adhesive, 20 kg, Bag", "₹607/Bag"],
  ["NCK Associates Private Limited", "New Delhi", "Stylfix Tile adhesive TA 1, Bag", "₹360/Bag"],
  ["Mod Innovation LLP", "Ahmedabad", "Tile Adhesive, Bag", "₹350/Bag"],
  ["KLG Ecolite", "Kolkata", "Dunlop Wall Tiles Adhesive", "₹700/BAG"],
  ["Renaatus Procon Private Limited", "Erode", "25 Kg Renafix Tile Adhesive", "₹385/Bag"],
  ["ADT Industries", "Navi Mumbai", "Dr. Fixit Roff Cementitious Tile Adhesive Bonder - 300g", "₹160/Bag"],
  ["Tile Pro Solutions", "Morbi", "Tile Fix Adhesive", "₹799/Bag"],
];

const CONCRETE_ADMIXTURES: Listing[] = [
  ["Redwop Chemicals Pvt. Ltd.", "Rajkot", "Liquid BLOCKFAST AC200 - Accelerator admixture", "₹44/Kg"],
  ["Mahad Infrastructure Private Limited", "Mumbai", "Admixture Sikament 5203 NS, For Construction", "₹66/Kg"],
  ["Milestone Infra", "Navi Mumbai", "Sika Pc Based Admixture Sikaplast-4206 Ns for Workability", "₹60/Kilogram"],
  ["Techno Trade Associates", "Jaipur", "Concrete Admixture Chemical, For Construction", "₹125/Kg"],
  ["Guru Corporation", "Ahmedabad", "95% G-Chem Micro Silica Powder", "₹34/Kg"],
  ["Sakshi Chem Sciences Private Limited", "Butibori", "Concrete Admixture Plasticizer", "₹140/Kg"],
  ["Clean Coats Private Limited", "Mumbai", "Conproof Pc 100 - High Range Water Reducing Concrete Admixture", "₹250/Kg"],
  ["Dubond Products India Private Limited", "Ahmedabad", "Dubond Duco No-3 Concrete Admixture", "₹255/KG"],
  ["Ethios Enviro Solutions Private Limited", "Ahmedabad", "BRONCO Crystalline Admixtures", "₹245/Kg"],
  ["Labh Projects Private Limited", "Ahmedabad", "Concrete Construction Admixtures - Labh Group", "₹55/Kg"],
  ["Shree Building Solutions", "Panaji", "PENETRON ADMIX Lifetime crystalline Concrete Admixture", "₹290/Kg"],
  ["Agrosyn Impex", "Vapi", "Superplasticizer Admixture Chemical", "₹75/Kg"],
  ["Mahek Metals", "Raipur", "Sikament Concrete Admixture", "₹12,375/Unit"],
  ["Waltar Enterprises", "Bhiwandi", "Concrete Fiber Admixtures", "₹175/Kg"],
  ["Astrra Chemicals LLP", "Chennai", "Fosroc Conplast Sp430 Concrete Admixture", "₹98/Kg"],
  ["Chemtech Marketing", "New Delhi", "Concrete Admixture Chemical", "₹150/Kg"],
  ["Supreme Silicones India Private Limited", "Aurangabad", "Water Reducing Concrete Admixture", "₹140/Kg"],
  ["Dalton Mines And Minerals Private Limited", "New Delhi", "Admixture..", "₹80/Litre"],
  ["B And B Specialties India Private Limited", "Vijayawada", "HI-FORZA 970", "₹56/Kg"],
  ["Trygve Engineering Private Limited", "Lucknow", "MasterGlenium ACE 8447, For Industrial", "₹300/Litre"],
  ["ADT Industries", "Navi Mumbai", "Conplast SP430IJM Superplasticising Slump Retaining Admixture", "₹55/Kg"],
  ["Siddhi Vinayak Construction Chemical Private Limited", "Satna", "SVCC Light brownish powder Solid Block Admixture", "₹1,534/25 kg"],
  ["Blue Star Tiles Chemical Products", "New Delhi", "White Super Bond Fast Set Admixture", "₹40/Kg"],
  ["Engitech Speciality Chemicals", "Ahmedabad", "Engi Prime Concrete Admixture Slurry", "₹100/Pack"],
  ["Bils Innovations India Private Limited", "New Delhi", "Master Builder MasterEmaco 131", "₹220/Kg"],
  ["Colourant Industries", "Vapi", "AAC Block Hardener Admixture", "₹40/Kg"],
  ["Vivid India", "New Delhi", "Concrete Admixture, C-MAX", "₹900/Litre"],
  ["Vimalnath Enterprise", "Vadodara", "White Fosroc Conplast WL Concrete Admixture", "₹125/Kg"],
];

const SANITARYWARE: Listing[] = [...WASH_BASINS, ...WATER_CLOSETS, ...BATHROOM_FAUCETS];
const PVC_PIPES: Listing[] = [...UPVC_PIPES, ...UPVC_FITTINGS, ...CPVC_PIPE];
const DOORS_WINDOWS: Listing[] = [...UPVC_WINDOWS, ...FLUSH_DOORS, ...ALUMINIUM_WINDOWS];
const WATERPROOFING: Listing[] = [...WATERPROOFING_CHEMICALS, ...TILE_ADHESIVES, ...CONCRETE_ADMIXTURES];

const ALL_SUBCATEGORIES: { key: keyof typeof SOURCES; entries: Listing[] }[] = [
  { key: "cement", entries: CEMENT },
  { key: "bricksBlocks", entries: BRICKS_BLOCKS },
  { key: "tiles", entries: TILES },
  { key: "rmcPaverBlocks", entries: RMC_PAVER_BLOCKS },
  { key: "sanitaryware", entries: SANITARYWARE },
  { key: "pvcPipes", entries: PVC_PIPES },
  { key: "doorsWindows", entries: DOORS_WINDOWS },
  { key: "waterproofing", entries: WATERPROOFING },
];

function mergeTwo(primary: Supplier, secondary: Supplier): Supplier {
  const sources = [...primary.intelligence.sources, ...secondary.intelligence.sources];
  const categories = Array.from(
    new Set([...primary.capabilities.categories, ...secondary.capabilities.categories])
  );
  const products = Array.from(
    new Set([...primary.capabilities.products, ...secondary.capabilities.products])
  );
  const manufacturingCapabilities = Array.from(
    new Set([
      ...primary.capabilities.manufacturingCapabilities,
      ...secondary.capabilities.manufacturingCapabilities,
    ])
  );
  const citiesServed = Array.from(
    new Set([...primary.identity.citiesServed, ...secondary.identity.citiesServed])
  );
  const manufacturingStatus =
    primary.capabilities.manufacturingStatus !== "unknown"
      ? primary.capabilities.manufacturingStatus
      : secondary.capabilities.manufacturingStatus;

  return {
    ...primary,
    identity: {
      ...primary.identity,
      citiesServed,
    },
    capabilities: {
      ...primary.capabilities,
      categories,
      products,
      manufacturingCapabilities,
      manufacturingStatus,
      productDescription:
        primary.capabilities.productDescription || secondary.capabilities.productDescription,
    },
    commercial: {
      ...primary.commercial,
      priceRange: primary.commercial.priceRange ?? secondary.commercial.priceRange,
    },
    intelligence: {
      ...primary.intelligence,
      sources,
      dataConfidence: computeMergedConfidence(sources, categories, products, manufacturingCapabilities),
    },
    mergedFrom: [...primary.mergedFrom, secondary.id],
  };
}

function computeMergedConfidence(
  sources: Supplier["intelligence"]["sources"],
  categories: string[],
  products: string[],
  manufacturingCapabilities: string[]
): Supplier["intelligence"]["dataConfidence"] {
  const coveredFields = new Set<string>();
  for (const s of sources) {
    for (const f of s.fields) coveredFields.add(f);
  }
  if (categories.length > 0) coveredFields.add("capabilities.categories");
  if (products.length > 0) coveredFields.add("capabilities.products");
  if (manufacturingCapabilities.length > 0) coveredFields.add("capabilities.manufacturingCapabilities");

  if (sources.length >= 2 && coveredFields.size >= 8) return "high";
  if (coveredFields.size >= 4) return "medium";
  return "low";
}

function mergeSameCompanyAcrossSubcategories(suppliers: Supplier[]): {
  merged: Supplier[];
  mergeCount: number;
} {
  const groups = new Map<string, Supplier[]>();
  for (const supplier of suppliers) {
    const key = normalizeCompanyName(supplier.identity.companyName);
    const group = groups.get(key) ?? [];
    group.push(supplier);
    groups.set(key, group);
  }

  const merged: Supplier[] = [];
  let mergeCount = 0;

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    const [first, ...rest] = group.sort((a, b) => a.id - b.id);
    let combined = first;
    for (const other of rest) {
      combined = mergeTwo(combined, other);
      mergeCount += 1;
    }
    merged.push(combined);
  }

  return { merged: merged.sort((a, b) => a.id - b.id), mergeCount };
}

async function main() {
  let existingIds: number[] = [10999]; // seed just below the 11000-11999 block (see lib/supplier-store.ts)
  const rawNormalized: Supplier[] = [];
  let totalRawListings = 0;

  for (const { key, entries } of ALL_SUBCATEGORIES) {
    totalRawListings += entries.length;
    for (const raw of rawRecordsForSubcategory(key, entries)) {
      const supplier = normalizeSupplierRecord(raw, existingIds);
      existingIds = [...existingIds, supplier.id];
      rawNormalized.push(supplier);
    }
  }

  const { merged: suppliers, mergeCount } = mergeSameCompanyAcrossSubcategories(rawNormalized);
  const candidates = findPotentialDuplicates(suppliers);

  const withWebsite = suppliers.filter((s) => s.identity.website).length;
  const withProduct = suppliers.filter((s) => s.capabilities.products.length > 0).length;
  const withSpecs = suppliers.filter((s) => s.capabilities.manufacturingCapabilities.length > 0).length;
  const withPricing = suppliers.filter((s) => s.commercial.priceRange).length;
  const withMoq = suppliers.filter((s) => s.commercial.moq).length;
  const withLeadTime = suppliers.filter((s) => s.commercial.leadTime).length;
  const withCerts = suppliers.filter((s) => s.compliance.certifications.length > 0).length;
  const withBizType = suppliers.filter((s) => s.capabilities.manufacturingStatus !== "unknown").length;

  const byConfidence: Record<string, number> = { high: 0, medium: 0, low: 0 };
  for (const s of suppliers) byConfidence[s.intelligence.dataConfidence]++;

  const byState = new Map<string, number>();
  const byCity = new Map<string, number>();
  for (const s of suppliers) {
    const loc = s.identity.location;
    if (!loc) {
      byCity.set("(not stated)", (byCity.get("(not stated)") ?? 0) + 1);
      byState.set("(not stated)", (byState.get("(not stated)") ?? 0) + 1);
      continue;
    }
    const parts = loc.split(",").map((p) => p.trim());
    const city = parts[0];
    const state = parts[1] ?? loc;
    byCity.set(city, (byCity.get(city) ?? 0) + 1);
    byState.set(state, (byState.get(state) ?? 0) + 1);
  }

  const bySubcategory = new Map<string, number>();
  for (const s of suppliers) {
    for (const c of s.capabilities.categories) {
      if (c === "Construction Materials") continue;
      bySubcategory.set(c, (bySubcategory.get(c) ?? 0) + 1);
    }
  }

  console.log(`Total raw listings across ${ALL_SUBCATEGORIES.length} IndiaMART subcategory groups: ${totalRawListings}`);
  console.log(`Normalized (pre-merge) records: ${rawNormalized.length}`);
  console.log(`Same-company merges across subcategories: ${mergeCount}`);
  console.log(`Final unique suppliers: ${suppliers.length}`);
  console.log(`findPotentialDuplicates() flagged ${candidates.length} candidate pair(s) for human review:`);
  for (const c of candidates) {
    console.log(
      `  "${c.a.identity.companyName}" (${c.a.identity.location}) <-> "${c.b.identity.companyName}" (${c.b.identity.location}) — reason: ${c.reason}`
    );
  }

  console.log("\n--- Batch summary ---");
  console.log(`Total suppliers: ${suppliers.length}`);
  console.log(`Confidence: high=${byConfidence.high} medium=${byConfidence.medium} low=${byConfidence.low}`);
  console.log(`With website: ${withWebsite}`);
  console.log(`With product evidence: ${withProduct}`);
  console.log(`With technical specs: ${withSpecs}`);
  console.log(`With pricing data: ${withPricing}`);
  console.log(`With MOQ: ${withMoq}`);
  console.log(`With lead time: ${withLeadTime}`);
  console.log(`With certifications: ${withCerts}`);
  console.log(`With literal manufacturer/distributor/trader status stated: ${withBizType}`);
  console.log("State distribution:");
  for (const [state, count] of [...byState.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${state}: ${count}`);
  }
  console.log("City distribution (top 20):");
  for (const [city, count] of [...byCity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${city}: ${count}`);
  }
  console.log("Subcategory distribution (a supplier can count in more than one):");
  for (const [cat, count] of [...bySubcategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  const dataFile = path.join(process.cwd(), "data", "suppliers", "construction-materials.json");
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ suppliers }, null, 2), "utf-8");
  console.log(`\nWrote ${suppliers.length} suppliers to ${dataFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
