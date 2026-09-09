// Ingestion run: Raw Materials supplier batch (India-wide) — Batch 11 of the
// master plan, tenth per-category dataset added to the existing multi-file
// supplier repository (see lib/supplier-store.ts's id-block scheme). Same
// architecture as every prior batch: normalizeSupplierRecord /
// computeDataConfidence / computeDedupeKey / findPotentialDuplicates from
// the existing lib/ingestion + lib/dedup modules — nothing new invented.
//
// SCOPE NOTE (important): a prior "Chemicals/Materials" batch (Batch 6)
// already covers industrial chemicals, industrial solvents, speciality
// chemicals, resins, industrial adhesives, plastic polymers, rubber raw
// material, FRP products, non-ferrous metals, sheet metals, stainless
// steel, metal products, industrial paints, and industrial coatings. To
// avoid this batch becoming a meaningless duplicate/generic bucket (per the
// master plan's explicit warning), "Raw Materials" here is scoped strictly
// to six PRIMARY/UNPROCESSED industrial inputs that batch does NOT cover:
//   1. Ferrous metals / raw steel forms (MS billets, steel ingots, sponge
//      iron, TMT bars, pig iron) — raw ferrous inputs, not the non-ferrous/
//      finished sheet/stainless forms already covered elsewhere.
//   2. Paper & pulp raw materials (kraft paper rolls, waste paper for
//      recycling, wood pulp, paper pulp) — not finished paper products.
//   3. Timber / wood raw material (timber logs, wood logs, sawn timber) —
//      not finished furniture (already covered in a separate batch).
//   4. Textile fibers & yarns (raw cotton, cotton/jute/polyester/viscose
//      yarn) — a domain untouched by any prior batch.
//   5. Minerals & ores (iron ore, bauxite, china clay, limestone, gypsum,
//      silica sand) — untouched by any prior batch.
//   6. Leather raw material (raw leather/hides, wet blue leather, cattle
//      hides) — raw/semi-processed material only, not finished leather
//      goods (bags/shoes/belts).
//
// HONEST COVERAGE GAP: within "Minerals & Ores", mica, dolomite, and quartz
// were not fetched this round (breadth was prioritized across the six
// minerals actually covered) — they are absent from this dataset. This is
// disclosed rather than papered over, consistent with the project's
// zero-fabrication policy; a follow-up pass could add them later.
//
// SOURCES: 21 pan-India IndiaMART "impcat"/dir.indiamart category pages
// across the six subcategory groups above. Raw listing data was gathered
// via two parallel research passes, each using WebSearch first to verify
// the correct current impcat slug (never guessed), then WebFetching each
// page's base URL plus its "?pg=2" variant or, where pg=2 was unavailable
// and collapsed to the same page, the site's own "?biz=NN" business-type
// filtered view (Manufacturers/Exporters) as the pagination-equivalent
// second page — the established technique from every prior batch. Every
// listing was transcribed verbatim; obvious exact-duplicate rows produced
// by fetching two overlapping views of the same page (not fuzzy name
// matching — literal same company + same page) were mechanically merged by
// the research pass and are noted per subcategory below.
//
// INCLUSION RULE applied while curating the raw listings below:
//   - EXCLUDED: foreign companies not based in India.
//   - EXCLUDED: listings that are purely a reseller of ONE specific named
//     foreign brand via an otherwise-unrelated trading company with no
//     independent evidence of dealing in the raw material itself.
//   - EXCLUDED: spare-parts/machinery-only listings (equipment that
//     PROCESSES the raw material, not the raw material itself), and
//     service-only/EPC-engineering listings (e.g. an EPC solutions company
//     offering "Pulp & Paper" engineering services, not a pulp seller).
//   - EXCLUDED: finished/converted products masquerading on a raw-material
//     category page — laminated/reinforced kraft paper TAPE products,
//     molded-pulp packaging components, gift-wrap paper, woven cotton
//     fabric (vs. raw fiber/yarn), finished leather goods (bags/shoes/
//     belts), finished furniture (vs. raw timber).
//   - EXCLUDED: tiny/hobby/decorative/consumer-only items unrelated to
//     industrial/commercial B2B raw-material supply (macrame craft yarn,
//     DIY craft wood logs, fairy-garden decorative logs, school-craft
//     scrap paper).
//   - EXCLUDED: keyword-coincidence unrelated businesses (a cow-shelter
//     organization's dung-fuel "wood log", a wearable-tech "LECHAL"
//     footwear product surfaced on a leather-category page, a trade/
//     government promotion council listed as if it were a seller).
//   - EXCLUDED: off-scope use — firewood/fuel-wood logs (not a
//     construction/manufacturing raw material), finished agricultural
//     fertilizer product on a gypsum mineral page.
//   - A company name alone was NOT used to exclude a listing whose title
//     carried genuine raw-material evidence — same rule as every prior
//     batch (e.g. "Noor Car Care Center" selling literal "Acacia Wood
//     Pulp" was kept, flagged for awareness given the unusual name/product
//     pairing).
//
// MANUFACTURER/DISTRIBUTOR/TRADER STATUS: the ManufacturingStatus type in
// lib/supplier-types.ts only accepts "manufacturer" | "distributor" |
// "trader" | "unknown" — it does NOT include "exporter". IndiaMART's
// "Verified Exporter" / "TrustSEAL" badges, though extremely common across
// this batch's raw data, are therefore never mapped to any status value
// (mapping "Exporter" to "manufacturer"/"distributor"/"trader" would be
// fabrication — none of those words is what the badge says). Only the
// literal word "Manufacturer" is mapped, which appears on several Jute
// Yarn listings pulled from IndiaMART's own Manufacturers-filtered view
// (?biz=10). Every other listing in this batch is left "unknown".
//
// TECHNICAL SPECS: extracted only when literally present in the title via
// parseRawMaterialsSpecs() — weight (kg/tonne), size (mm/sq ft/cubic feet),
// paper grammage (GSM), mineral particle size (mesh), yarn ply count, and
// literal "Count: N" yarn count. Nothing is inferred beyond the title text.
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
  ferrousMetals: {
    subcategory: "MS billets, steel ingots, sponge iron, TMT bars & pig iron",
    group: "Ferrous Metals & Raw Steel Forms",
    url: "https://m.indiamart.com/impcat/m-s-billets.html",
    sourceName:
      "IndiaMART — MS Billets / Steel Ingots / Sponge Iron / TMT Bars / Pig Iron directories",
  },
  paperPulp: {
    subcategory: "Kraft paper rolls, waste paper, wood pulp & paper pulp",
    group: "Paper & Pulp Raw Materials",
    url: "https://m.indiamart.com/impcat/kraft-paper-roll.html",
    sourceName:
      "IndiaMART — Kraft Paper Roll / Waste Paper / Wood Pulp / Paper Pulp directories",
  },
  timberWood: {
    subcategory: "Timber logs, wood logs & sawn timber",
    group: "Timber & Wood Raw Material",
    url: "https://m.indiamart.com/impcat/timber-logs.html",
    sourceName: "IndiaMART — Timber Logs / Wood Log / Sawn Timber directories",
  },
  textileFibers: {
    subcategory: "Raw cotton, cotton/jute/polyester/viscose yarn",
    group: "Textile Fibers & Yarns",
    url: "https://m.indiamart.com/impcat/raw-cotton.html",
    sourceName:
      "IndiaMART — Raw Cotton / Cotton Yarn / Jute Yarn / Polyester Yarn / Viscose Yarn directories",
  },
  mineralsOres: {
    subcategory: "Iron ore, bauxite, china clay, limestone, gypsum & silica sand",
    group: "Minerals & Ores",
    url: "https://m.indiamart.com/impcat/iron-ore.html",
    sourceName:
      "IndiaMART — Iron Ore / Bauxite / China Clay / Limestone Lumps / Gypsum / Silica Sand directories",
  },
  leatherRawMaterial: {
    subcategory: "Raw leather, wet blue leather & cattle hides",
    group: "Leather Raw Material",
    url: "https://m.indiamart.com/impcat/raw-leather.html",
    sourceName:
      "IndiaMART — Raw Leather / Wet Blue Leather / Cattle Hides directories",
  },
} satisfies Record<string, SubcategorySource>;

const STATE_BY_CITY: Record<string, string> = {
  // Maharashtra
  Mumbai: "Maharashtra",
  Pune: "Maharashtra",
  Nagpur: "Maharashtra",
  "Pimpri Chinchwad": "Maharashtra",
  Thane: "Maharashtra",
  "Navi Mumbai": "Maharashtra",
  "Vasai Virar": "Maharashtra",
  Lonand: "Maharashtra",
  Kolhapur: "Maharashtra",
  Nashik: "Maharashtra",
  Aurangabad: "Maharashtra",
  Bhiwandi: "Maharashtra",
  Wardha: "Maharashtra",
  Hinganghat: "Maharashtra",
  Sindhudurg: "Maharashtra",
  "Dahanu Road": "Maharashtra",
  Ichalkaranji: "Maharashtra",
  Panvel: "Maharashtra",
  Ulhasnagar: "Maharashtra",
  Kalyan: "Maharashtra",
  Raigad: "Maharashtra",
  // Punjab
  "Mandi Gobindgarh": "Punjab",
  Ludhiana: "Punjab",
  Khanna: "Punjab",
  Jalandhar: "Punjab",
  Amritsar: "Punjab",
  "Kot Kapura": "Punjab",
  Malerkotla: "Punjab",
  Pathankot: "Punjab",
  // Delhi
  "New Delhi": "Delhi",
  Delhi: "Delhi",
  // Chhattisgarh
  Raipur: "Chhattisgarh",
  Bhilai: "Chhattisgarh",
  Simga: "Chhattisgarh",
  // Uttar Pradesh
  Ghaziabad: "Uttar Pradesh",
  Kanpur: "Uttar Pradesh",
  Fatehpur: "Uttar Pradesh",
  Gorakhpur: "Uttar Pradesh",
  Meerut: "Uttar Pradesh",
  Noida: "Uttar Pradesh",
  Deoria: "Uttar Pradesh",
  Durllabhganj: "Uttar Pradesh",
  Loni: "Uttar Pradesh",
  "Rae Bareli": "Uttar Pradesh",
  "Karari Chandpur": "Uttar Pradesh",
  Bareilly: "Uttar Pradesh",
  Agra: "Uttar Pradesh",
  Lucknow: "Uttar Pradesh",
  // Jharkhand
  Chaibasa: "Jharkhand",
  Bokaro: "Jharkhand",
  Dhanbad: "Jharkhand",
  Ranchi: "Jharkhand",
  Jamshedpur: "Jharkhand",
  Ramgarh: "Jharkhand",
  Lohardaga: "Jharkhand",
  "Bokaro Steel City": "Jharkhand",
  Giridih: "Jharkhand",
  // Telangana
  Hyderabad: "Telangana",
  Secunderabad: "Telangana",
  Madhira: "Telangana",
  // Karnataka
  Bengaluru: "Karnataka",
  Hospet: "Karnataka",
  Puttur: "Karnataka",
  Dandeli: "Karnataka",
  Belgaum: "Karnataka",
  // Andhra Pradesh
  "East Godavari": "Andhra Pradesh",
  Narasannapeta: "Andhra Pradesh",
  Visakhapatnam: "Andhra Pradesh",
  Guntur: "Andhra Pradesh",
  Vaddeswaram: "Andhra Pradesh",
  Kakinada: "Andhra Pradesh",
  Anantapur: "Andhra Pradesh",
  Bhimavaram: "Andhra Pradesh",
  Piduguralla: "Andhra Pradesh",
  Vinukonda: "Andhra Pradesh",
  Rajahmundry: "Andhra Pradesh",
  // Rajasthan
  Jaipur: "Rajasthan",
  Kherli: "Rajasthan",
  Baran: "Rajasthan",
  Alwar: "Rajasthan",
  Sriganganagar: "Rajasthan",
  Bikaner: "Rajasthan",
  Taranagar: "Rajasthan",
  Jodhpur: "Rajasthan",
  Raisinghnagar: "Rajasthan",
  Kuchaman: "Rajasthan",
  Udaipur: "Rajasthan",
  Bhiwadi: "Rajasthan",
  // Gujarat
  Ahmedabad: "Gujarat",
  Surat: "Gujarat",
  Gandhinagar: "Gujarat",
  Wankaner: "Gujarat",
  Gandhidham: "Gujarat",
  Morbi: "Gujarat",
  Paddhari: "Gujarat",
  Anjar: "Gujarat",
  Banaskantha: "Gujarat",
  Mandvi: "Gujarat",
  Junagadh: "Gujarat",
  Khambhaliya: "Gujarat",
  Porbandar: "Gujarat",
  Ankleshwar: "Gujarat",
  Bhuj: "Gujarat",
  Mundra: "Gujarat",
  Surendranagar: "Gujarat",
  Virpur: "Gujarat",
  Borsad: "Gujarat",
  Kutch: "Gujarat",
  Vadodara: "Gujarat",
  Rajkot: "Gujarat",
  Chhatral: "Gujarat",
  // Odisha
  Bhubaneswar: "Odisha",
  "Kalinga Nagar Industrial Area": "Odisha",
  Rourkela: "Odisha",
  Bhubaneshwar: "Odisha",
  // West Bengal
  Kolkata: "West Bengal",
  Domjur: "West Bengal",
  Howrah: "West Bengal",
  "Bidhan Nagar": "West Bengal",
  "North 24 Parganas": "West Bengal",
  Raghunathpur: "West Bengal",
  Dankuni: "West Bengal",
  Murshidabad: "West Bengal",
  "South 24 Parganas": "West Bengal",
  Bankra: "West Bengal",
  Naiti: "West Bengal",
  "24 Parganas": "West Bengal",
  // Puducherry
  Pondicherry: "Puducherry",
  // Madhya Pradesh
  Ratlam: "Madhya Pradesh",
  Indore: "Madhya Pradesh",
  Jabalpur: "Madhya Pradesh",
  Ujjain: "Madhya Pradesh",
  Sagar: "Madhya Pradesh",
  Gwalior: "Madhya Pradesh",
  Katni: "Madhya Pradesh",
  Jaitwara: "Madhya Pradesh",
  Satna: "Madhya Pradesh",
  Dewas: "Madhya Pradesh",
  Bhopal: "Madhya Pradesh",
  // Kerala
  Irinjalakuda: "Kerala",
  Ernakulam: "Kerala",
  Kollam: "Kerala",
  Kannur: "Kerala",
  Kozhikode: "Kerala",
  Alappuzha: "Kerala",
  Thrissur: "Kerala",
  // Tamil Nadu
  Chennai: "Tamil Nadu",
  Coimbatore: "Tamil Nadu",
  Sivakasi: "Tamil Nadu",
  Pollachi: "Tamil Nadu",
  Salem: "Tamil Nadu",
  Bodinayakanur: "Tamil Nadu",
  Rajapalayam: "Tamil Nadu",
  Chennimalai: "Tamil Nadu",
  Tiruppur: "Tamil Nadu",
  Erode: "Tamil Nadu",
  Tiruchirappalli: "Tamil Nadu",
  Thanjavur: "Tamil Nadu",
  Dindigul: "Tamil Nadu",
  Namakkal: "Tamil Nadu",
  Mettur: "Tamil Nadu",
  Vellore: "Tamil Nadu",
  Ambur: "Tamil Nadu",
  Arcot: "Tamil Nadu",
  Kanyakumari: "Tamil Nadu",
  Vaniyambadi: "Tamil Nadu",
  Pernambut: "Tamil Nadu",
  // Haryana
  Panchkula: "Haryana",
  Hisar: "Haryana",
  Gurugram: "Haryana",
  Gurgaon: "Haryana",
  Dharuhera: "Haryana",
  Bhiwani: "Haryana",
  Panipat: "Haryana",
  Karnal: "Haryana",
  Ambala: "Haryana",
  Faridabad: "Haryana",
  Palwal: "Haryana",
  // Jammu and Kashmir
  Jammu: "Jammu and Kashmir",
  Srinagar: "Jammu and Kashmir",
  Sopore: "Jammu and Kashmir",
  Kathua: "Jammu and Kashmir",
  // Bihar
  Patna: "Bihar",
  Begusarai: "Bihar",
  Motihari: "Bihar",
  Samastipur: "Bihar",
  // Uttarakhand
  Herbertpur: "Uttarakhand",
  // Goa
  Mapusa: "Goa",
  Goa: "Goa",
  Panaji: "Goa",
  // Assam
  Kamrup: "Assam",
  "North Lakhimpur": "Assam",
  // Manipur
  Imphal: "Manipur",
  // Dadra and Nagar Haveli
  Silvassa: "Dadra and Nagar Haveli",
  // Chandigarh
  Chandigarh: "Chandigarh",
  // Additional cities discovered via state-distribution review (round 2)
  "Yamuna Nagar": "Haryana",
  Jagadhri: "Haryana",
  Kaithal: "Haryana",
  Sonipat: "Haryana",
  Handwara: "Jammu and Kashmir",
  Thoothukudi: "Tamil Nadu",
  Palladam: "Tamil Nadu",
  Jamnagar: "Gujarat",
  Gondal: "Gujarat",
  Prantij: "Gujarat",
  Mehsana: "Gujarat",
  Vapi: "Gujarat",
  Mandapeta: "Andhra Pradesh",
  Kurnool: "Andhra Pradesh",
  Hardoi: "Uttar Pradesh",
  Malappuram: "Kerala",
  Ullal: "Karnataka",
  Satara: "Maharashtra",
  Jaora: "Madhya Pradesh",
  Raniganj: "West Bengal",
  Barrackpore: "West Bengal",
};

function locationFor(city: string): string {
  const cleanCity = city.split(",")[0].trim();
  if (!cleanCity) return "";
  const state = STATE_BY_CITY[cleanCity];
  return state ? `${cleanCity}, ${state}` : cleanCity;
}

// Literal-evidence-only technical spec extraction — same discipline as
// every prior batch's spec parser.
function parseRawMaterialsSpecs(title: string): string[] {
  const specs: string[] = [];
  const push = (label: string) => {
    if (!specs.includes(label)) specs.push(label);
  };

  const gsmMatch = title.match(/(\d+(?:\.\d+)?)\s*GSM/i);
  if (gsmMatch) push(`${gsmMatch[1]} GSM`);

  const mmMatch = title.match(/(\d+(?:\.\d+)?)\s*mm\b/i);
  if (mmMatch) push(`${mmMatch[1]}mm`);

  const kgMatch = title.match(/(\d+(?:\.\d+)?)\s*[Kk]g\b/);
  if (kgMatch) push(`${kgMatch[1]} kg`);

  const tonMatch = title.match(/(\d+(?:\.\d+)?)\s*[Tt]on(?:ne)?(?:s)?\b/);
  if (tonMatch) push(`${tonMatch[1]} ton`);

  const sqFtMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:sq\s*\.?\s*ft|square\s*feet)/i);
  if (sqFtMatch) push(`${sqFtMatch[1]} sq ft`);

  const cubicFtMatch = title.match(/(\d+(?:\.\d+)?)\s*[Cc]ubic\s*[Ff]eet/);
  if (cubicFtMatch) push(`${cubicFtMatch[1]} cubic feet`);

  const meshMatch = title.match(/(\d+(?:\.\d+)?)\s*[Mm]esh/);
  if (meshMatch) push(`${meshMatch[1]} mesh`);

  const plyMatch = title.match(/(\d+)\s*[Pp]ly/);
  if (plyMatch) push(`${plyMatch[1]} ply`);

  const countMatch = title.match(/Count:\s*(\d+)/i);
  if (countMatch) push(`Count ${countMatch[1]}`);

  return specs;
}

function rawRecordsForSubcategory(
  key: keyof typeof SOURCES,
  entries: Listing[]
): RawSupplierRecord[] {
  const { subcategory, group, url, sourceName } = SOURCES[key];
  const categories = Array.from(new Set(["Raw Materials", group, subcategory]));

  return entries.map(([companyName, city, title, price, bizType]) => {
    const specs = parseRawMaterialsSpecs(title);
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

const MS_BILLETS: Listing[] = [
  ["Sanghvi Metal Corporation", "Mumbai", "Mild Steel MS Billets, For Oil & Gas Industry, Thickness: 5 mm", "₹160/Tonne"],
  ["Bhagwati Corporation", "Ratlam", "Mild Steel Billet", "₹40,935/Tonne"],
  ["Metro Line Industries", "Chennai", "Ms Steel Billets", "₹30/Kg"],
  ["Ferromet Steels", "Pune", "MS - Mild Steel Billets For Automobile Industry, Size: 25 To 200 mm", "₹50/Kg"],
  ["Param Steels", "Pune", "MS & EN8D Steel Billet", "₹60/kg"],
  ["Tirupati International", "Kolkata", "Mild Steel Billet", "₹41/Kg"],
  ["P. B. International", "Mumbai", "Mild Steel Billet, For Oil & Gas Industry", "₹50/Kilogram"],
  ["Mahalaxmi Trading Corporation", "Nagpur", "Mild Steel Ms Billets And Blooms", "₹45/Kg"],
  ["R.J International", "Kolkata", "Mild Steel Billet", "₹49,500/Tonne"],
  ["Ashok Steel Industries", "Mandi Gobindgarh", "Mild Steel Billets", "₹49,500/Tonne"],
  ["Parva Bright Steels", "Pimpri Chinchwad", "Ms Steel Billets, For Automobile Industry, Thickness: 10 mm", "₹55/Kg"],
  ["Jagdamba Steel Co.", "New Delhi", "Mild Steel Billet", "₹55/Kg"],
  ["K. L. Concast", "Mandi Gobindgarh", "Mild Steel Billets, For Construction", "₹52/Kg"],
  ["RK TMT Mart", "Chennai", "Sri Durga Mild Steel Billet", "₹47/Kg"],
  ["Shree Shyam Steels", "Ludhiana", "Mild Steel Billets", "₹47,500/Tonne"],
  ["Sri Sakthi Steels", "Coimbatore", "MS A105 Billets 65,75,90", "₹65/Kg"],
  ["AN Ispat", "Raipur", "Mild Steel Billet, Thickness: 20 mm, For Construction Industry", "₹36/Kg"],
  ["Haryana Agro Ispat", "Ghaziabad", "20mm Mild Steel Square Billet", "₹40/Kg"],
  ["East India Holdings Private Limited", "Kolkata", "Mild Steel Billets", "₹70/Kg"],
  ["Shah Alloys Impex", "Mumbai", "Ms Steel Billets", "₹77/Tonne"],
  ["Mivaan Steels Limited", "New Delhi", "Mild Steel Billets", "₹42,200/Tonne"],
  ["Angus India", "Kolkata", "Mild Steel Billet, Thickness: 20 mm, For Construction", "₹70/Tonne"],
  ["Maheswary Industriez", "Rourkela", "Mild Steel Billets, For Construction", "₹41,500/Tonne"],
  ["Shivjyot Industries Private Limited", "Ahmedabad", "Mild Steel Billet", "₹45/Kg"],
  ["Rajindra Agro Sales", "Kanpur", "Mild Steel Billet", "₹32/Kg"],
  ["Rungta Mines Limited", "Chaibasa", "Ms Billets", "₹41,500/Ton"],
  ["Samana Concast", "Mandi Gobindgarh", "Mild Steel Billet IS 2830 (Medium Carbon) - 6m Length, 100mm Section Size for Re-rolling", "₹50/Kg"],
  ["Indian Infra Steel", "Raipur", "Mild Steel Square Billet", "₹40,000/Tonne"],
  ["Priya Traders", "Bhilai", "Mild Steel Billet, For Industrial", "₹48/Kg"],
];

const STEEL_INGOTS: Listing[] = [
  ["Thakur Ji Machine And Tools", "Vasai Virar", "HIGH SPEED STEEL INGOT", "₹300/Kg"],
  ["Sanghvi Metal Corporation", "Mumbai", "Carbon Steel Ingots", "₹280/Kg"],
  ["Anita Steel And Metals", "Mumbai", "A182 F11 / F12 Cl 2 Ingots & Blooms", "₹151/Kg"],
  ["Mahadev Metal", "New Delhi", "Carbon 20Kg Metal Ingot", "₹3,070/Kg"],
  ["Shivam Steel Corporation", "Raipur", "Steel Ingots", "₹50/Kg"],
  ["EDM Tools Industries", "Hyderabad", "HIGH SPEED STEEL INGOT", "₹300/Kg"],
  ["Auremax International LLP", "Indore", "Carbon Steel Ingots", null],
  ["Alloy Spectrum Private Limited", "Bengaluru", "Steel Ingots", null],
  ["Tanishk International Trade", "Chennai", "Steel Ingot, For Construction", null],
  ["Balaji Steel Center", "Lonand", "Steel Ingots", "₹100/Kg"],
  ["Addi Alloys Pvt. Ltd.", "Ludhiana", "EN 353 Steel Ingot", "₹42,000/Ton"],
  ["Raj Iron And Steel Sales", "Mandi Gobindgarh", "Steel Ingots", "₹44/Kg"],
  ["Sattibabu Iron Works", "East Godavari", "Carbon Steel Ingots", "₹150/Kg"],
  ["Sri Padmavathi Enterprises", "Narasannapeta", "Carbon Steel Ingots", "₹5,000/Kg"],
  ["PK Trading Company", "Mandi Gobindgarh", "Steel Billets Ingots", "₹47,000/Ton"],
  ["Puri Trading Co.", "Mandi Gobindgarh", "Steel Ingots, Construction", "₹37,500/Ton"],
  ["Bhavani Electrical", "Madhira", "Steel Ingots", "₹200/Kg"],
  ["Mancchaa Steels", "Thane", "Ingots Iron Steel", "₹51.50/Kg"],
  ["Srinivasa Agencies", "Visakhapatnam", "Spring Steel Ingots", "₹1,500/Kg"],
  ["Ganesh Steel & Alloys Limited", "Kolkata", "Rolling Ingots", null],
  ["A Navinchandra Steels Pvt. Ltd.", "Mumbai", "Ingots And Billets", null],
  ["Rites Enterprises", "Khanna", "Steel Pencil Ingots", null],
  ["Kedaar Metaliks Private Limited", "New Delhi", "Steel Ingots", null],
  ["Maa Santoshi Promoter And Developer", "Bokaro", "Ingots", null],
  ["Lawrence Steel & Engineering Co.", "Mumbai", "Steel Ingots", null],
  ["Carbon Ispaat Limited", "Dhanbad", "Steel Ingots", null],
  ["Bansal Alloys And Metals Private Limited", "Mandi Gobindgarh", "Steel Ingots", null],
  ["Vimal Alloy Private Limited", "Mandi Gobindgarh", "Steel Ingots", null],
  ["Om Sai Industries", "Guntur", "Steel Ingots", "₹58/Kilogram"],
  ["Shree Krishna Steels Unit II", "Raipur", "Industrial Steel Ingots", null],
];

const SPONGE_IRON: Listing[] = [
  ["Shri Ram Minerals", "Jaipur", "Dry Sponge Iron, Iron Content: 95%", "₹13,000/Tonne"],
  ["ITO Global Trading Company", "Surat", "ITO Global Sponge Iron Powder", "₹5/kilogram"],
  ["Saakshi Udyog Private Limited", "Ranchi", "Sponge Iron Pellets", "₹15/Kg"],
  ["Kushal Chemicals", "Bhilai", "Hydrogen Reduced Sponge Iron Powder", "₹38/Kilogram"],
  ["Hindustan Carbons", "Bengaluru", "Sponge Iron", "₹34/Kilogram"],
  ["BR Communication", "Bhubaneswar", "sponge iron pellets", "₹25,300/Tonne"],
  ["Mivaan Steels Limited", "New Delhi", "Direct Reduced Iron", "₹22,000/Tonne"],
  ["Tatanagar Enterprises Private Limited", "Jamshedpur", "Loose Sponge Iron, Iron Content: 95%, Physical State: Granules", "₹26.50/Kg"],
  ["Maheswary Industriez", "Rourkela", "Sponge Iron", "₹31,000/Ton"],
  ["Rungta Mines Limited", "Chaibasa", "Sponge Iron", "₹28,900/Tonne"],
  ["Shree Bajrang Sales Pvt Ltd", "Nagpur", "Sponge Iron Pellet", null],
  ["Hindusthan Produce Company", "Kolkata", "Sponge Iron", null],
  ["Matarani Alloys", "Raipur", "Sponge Iron Pellets", null],
  ["Auremax International LLP", "Indore", "Sponge Iron Pellets", null],
  ["Sangeeta Enterprisers", "Kalinga Nagar Industrial Area", "Sponge iron, Iron Content: 95%, Physical State: Solid", null],
  ["J K Trading Company", "Hospet", "Sponge Iron", "₹28,000/Ton"],
  ["Yuvraj Trading Co.", "Domjur", "FEM 80+ Sponge Iron Pellet", "₹34,700/Tonne"],
  ["Kanaka International Private Limited", "Surat", "Sponge Iron Supplier in in dia, Iron Content: 75 to 80%", "₹28,950/Tonne"],
  ["Essem Enterprise", "Kolkata", "Sponge Iron", "₹15,000/Ton"],
  ["Shree Industrial Suppliers", "Rourkela", "Sponge Iron", "₹34,000/Ton"],
  ["Ambika Refractories Private Limited", "Wankaner", "Ambica Sponge Iron", "₹35,000/Tonne"],
  ["URT Exports", "Pondicherry", "Sponge Iron", null],
  ["Sazyah Enterprises", "Ranchi", "Sponge Iron", null],
  ["Gallantt Ispat Limited", "Gandhidham", "Sponge Iron", null],
  ["Arpee Metaliks Pvt. Ltd.", "Kolkata", "Sponge Iron", null],
  ["Maan Steel & Power Limited", "Kolkata", "Sponge Iron And Steel", null],
  ["Saraf Trexim Limited", "Kolkata", "Sponge Iron", null],
  ["Saluja Steel & Power Private Limited (Unit-Ii)", "Giridih", "Sponge Iron", null],
  ["Uma Export", "Kolkata", "Sponge Iron", null],
];

const TMT_BARS: Listing[] = [
  ["Fortran Steel Private Limited", "Navi Mumbai", "Steel Tmt Bars", "₹50/Kg"],
  ["Humaira Enterprises", "Jaipur", "Tmt BAR", "₹48/Kg"],
  ["Om D.P. Marketing", "Chennai", "New Tmt Bars/Sariya MAX TMT 5 mm", "₹68,475/Tonne"],
  ["Bhagwati Corporation", "Ratlam", "Rebars / Tmt Bars / Debars / Wire Rods", "₹47,195/Tonne"],
  ["KLG Ecolite", "Kolkata", "6 mm Crs Tmt Bar, Fe 500", "₹50,000/Tonne"],
  ["Shree Ji Steel Corporation", "Kolkata", "12 mm Shree Ji Steel Zeecon TMT", "₹41.30/Kg"],
  ["JSK Corporation Private Limited", "Nagpur", "Tmt Bars 12 Mm", "₹53/Kg"],
  ["Mahalaxmi Trading Corporation", "Nagpur", "Reinforcement Tmt Bar, Fe 550D", "₹45/Kg"],
  ["Ferrite Structural Steels Private Limited", "Mumbai", "TMT (Thermo Mechanically Treated) Bars", "₹50/Kg"],
  ["Sakthi Steel Industries Limited", "Chennai", "25mm Fe 550 SRI Durga TMT Bar", "₹54/Kg"],
  ["Paviter Metals Private Limited", "Ludhiana", "MS TMT Bars", "₹50,000/Tonne"],
  ["Giriraj Steels", "Jodhpur", "Tmt Bar", "₹54/Kg"],
  ["Aheva", "Secunderabad", "Tmt Bar, Fe 500", "₹40/Kg"],
  ["Aman Builditect By A. M. Group", "Indore", "Tmt Bar Saria", "₹52/Kilogram"],
  ["Jindal Steel And Wires Industries", "Ludhiana", "Aar kay tmt bar", "₹45,000/Tonne"],
  ["Nova Steels", "Mumbai", "12 mm Stainless Steel TMT Bar, Fe 500", "₹50,000/Tonne"],
  ["Sufi Structural Tubes Private Limited", "Pune", "Rajuri TMT Bar", "₹50/Kg"],
  ["Kapil Steels", "New Delhi", "Tmt Bars Sarira", "₹47/Kg"],
  ["Shree Krishna Rolling Mills (Jaipur) Ltd.", "Jaipur", "8 mm Krishna Tmt Bars", "₹60/Kg"],
  ["Divyan Infra Junction Pvt. Ltd.", "Lucknow", "Thermocon TMT BARS", "₹56/Kg"],
  ["Vijay Laxmi Sales Corporation", "Jaipur", "12 mm MSP PREMIUM FE550D TMT BAR", "₹51/Kg"],
  ["Saakshi Udyog Private Limited", "Ranchi", "Fe500,550 TMT, 10 mm, Rungta", "₹45/Kg"],
  ["RR Enterprises", "Chennai", "12 Mm JR TMT Bar", "₹85/Kg"],
  ["Durga Logistics", "Bengaluru", "Tmt Bars", "₹53/Kg"],
  ["Marsel India Private Limited", "Tiruchirappalli", "Gowri Fe550D TMT Bar", "₹67/Tonne"],
  ["Jeetmull Jaichandlall (Madras) Private Limited", "Chennai", "1-10 mm Fe 500 Thermo Mechanically Treated bars", "₹50/Kg"],
  ["Lata Trading Company", "Patna", "8mm Alaknanda Iron TMT Bars", "₹57/Kg"],
  ["Real Ispat And Power Limited", "Raipur", "CRS TMT Bar 8mm", "₹59,000/Tonne"],
];

const PIG_IRON: Listing[] = [
  ["Bharat Engineering Works", "Howrah", "Pig Iron Steel Grade", "₹37/Kg"],
  ["Hindusthan Produce Company", "Kolkata", "Pig Iron", "₹90,500/Tonne"],
  ["Fabcore Engineering Private Limited", "Irinjalakuda", "Foundry Pig Iron", "₹20,000/Tonne"],
  ["Shree Bajrang Sales Pvt Ltd", "Nagpur", "Pig Iron (Foundry Grade)", "₹32/Kilogram"],
  ["Tirupati International", "Kolkata", "Pig Iron Steel", "₹38/Kg"],
  ["Tridev Steels", "Ahmedabad", "Pig Iron in Ahmedabad, Grade: Foundry Grade", "₹65/Kg"],
  ["3 D Innovations", "Raipur", "Agricultural Machinery Foundry Grade Pig Iron", "₹33,000/Tonne"],
  ["Shri Balaji Enterprises", "Hyderabad", "Foundry Pig Iron", "₹37,500/Tonne"],
  ["Pinkey Zarkhandi Coal Depo", "Surat", "Pig Iron Steel, 7-15kg", "₹48,000/Ton"],
  ["King Metals & Alloys Ltd.", "Chennai", "Pig Iron", "₹44,200/Tonne"],
  ["Aditya Enterprises", "Bhilai", "Pig Iron Scrap", "₹90/Kg"],
  ["Refractories Trade Link", "Indore", "Pig Iron, Grade: Industrial Grade", "₹40/Kilogram"],
  ["Yadav Ferroalloys Private Limited", "Bhilai", "India Foundry Grade Pig Iron", "₹38,750/Tonne"],
  ["Maa Bhawani Industries", "Bhilai", "Pig Iron Scrap", "₹39/Kg"],
  ["Matarani Alloys", "Raipur", "Pig Iron Steel Grade", "₹38,900/Tonne"],
  ["Tatva Ventures", "Rourkela", "C. I. Lumps Sand Pig Iron", "₹36,000/Tonne"],
  ["Nikita Metallurgicals Private Limited", "Raipur", "Nikita Sand Pig Iron, Grade: Foundry Grade, 3 Kg", "₹31.20/Kg"],
  ["Paroliya Minerals & Ferro Alloys", "Jaipur", "Industrial Foundry Pig Iron", "₹45/Kg"],
  ["Esevaworld Services Private Limited", "Secunderabad", "Pig Iron, Grade: Industrial Grade", "₹35,000/Tonne"],
  ["Baba Baidya Nath Metallic Company", "Howrah", "Pig Iron Pot PCM for Foundry & Industrial Use", null],
  ["Auremax International LLP", "Indore", "Pig Iron Scrap", null],
  ["Metalskart Exim Private Limited", "Vinukonda", "Pig Iron Scrap", "₹47,000/tonne"],
  ["Vishnu Iron & Steel Co.", "Bidhan Nagar", "Nickel Pig Iron", "₹5,000/Ton"],
  ["Earth Stahl & Alloys Limited", "Simga", "High Silicon Pig Iron", "₹37,000/Tonne"],
  ["Uma Export", "Kolkata", "Grade II Pig Iron", null],
  ["Balaji Moulding Works", "Hyderabad", "Pig Iron", null],
  ["Sazyah Enterprises", "Ranchi", "Pig Iron", null],
  ["N R Wires Pvt. Ltd.", "Bhilai", "Pig Iron", null],
];

const FERROUS_METALS: Listing[] = [
  ...MS_BILLETS,
  ...STEEL_INGOTS,
  ...SPONGE_IRON,
  ...TMT_BARS,
  ...PIG_IRON,
];

const KRAFT_PAPER_ROLL: Listing[] = [
  ["K.P. Packaging Ltd.", "Silvassa", "Kraft Paper Roll, 80 GSM", "₹50/Kg"],
  ["Axon Packaging Paper Boards Private Limited", "Mumbai", "80 GSM Brown Kraft Paper, 20 BF", "₹45/Kg"],
  ["Zeric Ceramica", "Morbi", "Craft Recycle Packaging Kraft Paper Roll, 80 GSM", "₹30/Kg"],
  ["Gujarat Packaging Industries", "Rajkot", "Packaging Paper, 100 GSM", "₹33/Kg"],
  ["Shree Krishna Marketing", "New Delhi", "Packaging Kraft Paper, 18 BF, GSM: 100-180", "₹29/Kg"],
  ["Cronza Trimpex LLP", "Rajkot", "Brown Testliner Kraft Paper, Roll", "₹35/Kg"],
  ["PR Global Resources India Private Limited", "Nagpur", "Brown Kraft Paper Roll, GSM: 80 to 400 gsm", "₹37/Kg"],
  ["Ginni Gopal Boards Pvt. Ltd.", "Mumbai", "Kraft Paper Roll, 140 GSM", "₹30/Kg"],
  ["Anu Industries", "Chennai", "Brown Plain Corrugated Paper Roll, Packaging Type: Rolls", "₹60/Kilogram"],
  ["Ambey Papers LLP", "Gandhinagar", "Yellow Kraft Paper, 18 BF, GSM: 70 gsm", "₹150/Kg"],
  ["Matrix Exports", "Bengaluru", "Virgin Kraft Paper Roll In India, 40-200", "₹58/Kg"],
  ["Gemini Global", "Panchkula", "Brown Paper Roll, 48 GSM, 57 mm (2.25 Inch)", "₹40/Roll"],
  ["United Papers", "Sivakasi", "80 Gsm Kraft Paper Roll", "₹26/Kg"],
  ["PR Paper Industries India Private Limited", "Nagpur", "Black Kraft Paper Roll, 80 GSM", "₹78/Kg"],
  ["Galaxy Plastics", "Ahmedabad", "60 GSM Kraft Paper Roll", "₹65/Kg"],
  ["Quick Graphics", "Rajkot", "Kraft Paper Roll", "₹300/Roll"],
  ["Pioneer Enterprises", "Gorakhpur", "Kraft Paper Roll, 120 GSM", "₹31/Kg"],
  ["Oceanic Foil Pack", "Ahmedabad", "Plain Kraft Paper Roll For Packaging, GSM: 120", "₹110/Kg"],
  ["Maham Traders", "Pollachi", "2 Kg Light Green Kraft Paper Roll, 80 GSM", "₹40/Kg"],
  ["Srirajeshwari Papers And Stationerys", "Chennai", "Wood Pulp Brown Packaging Kraft Paper Roll, 250 Gsm", "₹45/Kg"],
  ["The Krishna Impex", "New Delhi", "Brown Virgin Imported Kraft Paper Roll, 120 GSM", "₹68/Kilogram"],
  ["Vikas Overseas Crafts", "Ghaziabad", "Imported Kraft Liner Board", "₹70/Kg"],
  ["Mario Industries", "Mumbai", "Kraft Paper Roll, GSM: 250, 28 BF", "₹30/Kg"],
  ["Bubble Pacage Private Limited", "Chennai", "Kraft Paper Roll", "₹334/Kg"],
  ["Javin Enterprises", "Pune", "Kraft Paper Roll, GSM: 120 gsm, 20 BF", "₹45/Kilogram"],
  ["Pravesh Paper Private Limited", "New Delhi", "Kraft Paper Roll, 270", "₹58/Kg"],
];

const WASTE_PAPER: Listing[] = [
  ["Ashirwad Sales", "Jalandhar", "Unused Waste Paper Scrap", "₹32.50/Kg"],
  ["Siddhivinayak Agro Plast", "Nashik", "Mix Paper cutting", "₹20/Tonne"],
  ["F Star Industries", "Rajkot", "Old Corrugated Carton Used Occ Waste Paper Paper Scraps 100 Cardboard", "₹32/Kg"],
  ["Jindal Traders", "Karnal", "Paper Old Book Scrap, For Recycled", "₹29.50/Kg"],
  ["Jay Ambe Traders", "Surat", "Plain White Paper Cutting Waste", "₹40/Kg"],
  ["GS India Multitech (OPC) Private Limited", "Chennai", "Plain Paper Scrap", "₹18/Kg"],
  ["Packbox.In", "Bengaluru", "White 1 Kg Waste Cutting Paper, For Industrial", "₹35/Kg"],
  ["Vijayan Brothers", "Chennai", "Used Waste Paper Scrap", "₹21/Kg"],
  ["AM Green Recycling", "Gurugram", "Used Waste Paper Scrap", "₹21/Kg"],
  ["Chaya Nandan Chemicals", "Hisar", "Used Old Corrugated Carton Waste Paper Scrap", "₹18/Kg"],
  ["Inaya Enterprises", "Noida", "Brown Waste Paper Scrap, For Recycle", "₹14/Kg"],
  ["Pandey Traders", "Jammu", "Mixed Paper Scrap", "₹12/Kg"],
  ["Krishna Trading", "Paddhari", "Old Corrugated Carton Used Plain Waste Paper", "₹23/Kg"],
  ["Neyaz Ahmed Rahi", "Kolkata", "Used Duplex Board Waste Paper Scrap", "₹16/kilogram"],
  ["Sri Goga G Enterprises", "Anjar", "Old Corrugated Carton Used Cardboard OCC Scrap", "₹19/Kg"],
  ["Samir Board World", "Kolkata", "Off Cut Paper", "₹25/Kg"],
  ["Singh Bhawani Paper Mills Private Limited", "Kolkata", "Mixed Record Waste Paper (Used) / Printed Magazine Waste Paper", "₹17/Kg"],
  ["Sawariya Enterprises", "Ujjain", "120 GSM Waste Paper Scrap", "₹19/Kg"],
  ["R K Waste Paper Supplier", "Surat", "White Cutting Waste Paper", "₹34/Kg"],
  ["Gupta Traders", "New Delhi", "Waste Paper Bales", "₹18/Kg"],
  ["Patani Scrap Traders", "Gondal", "Plain Waste Paper Scrap, Packaging Type: Loose", "₹20/Kg"],
  ["Sameer Enterprises", "Noida", "Used Old Newspaper Waste Paper Scrap", "₹26/Kg"],
  ["Anshika Papers Private Limited", "Patna", "Used Duplex Paper Waste Scrap", "₹18/Kg"],
  ["Sri Rajarajeswara Trading Company", "Secunderabad", "Book Paper Waste Scrap, For Used In Industries", "₹18/Kg"],
  ["Gautam Enterprises", "New Delhi", "Old Kraft Roll Used Brown Waste Paper", "₹40/Kg"],
  ["Srirajeshwari Papers And Stationerys", "Chennai", "Printed Waste Paper Scrap", null],
  ["Siva Waste Paper Mart", "Chennai", "White Record Paper Scrap", null],
  ["Uday Traders", "Nashik", "Old Book Scrap / Printed Old Book Scrap, For Pulping", "₹20/Kg"],
  ["FF Steel", "Bengaluru", "Used Old Corrugated Carton Waste Paper Scrap", "₹15/Kg"],
];

const WOOD_PULP: Listing[] = [
  ["JSR International (India) Private Limited", "Loni", "CELLULOSE FIBER SOFT WOOD PULP", "₹95/Kg"],
  ["M And M", "Ernakulam", "Wood Pulp", "₹25/Kg"],
  ["Kapoor Mouldchem Pvt. Ltd.", "Sonipat", "Wood Pulp Sheet", "₹65/Kg"],
  ["MSND Manufacturing", "New Delhi", "Airlaid Softwood Sheet", "₹240/Kg"],
  ["Gurdayal & Sons", "New Delhi", "Un Bleached Wood Pulp, For Paper Plate Making", "₹60/Kg"],
  ["PR Global Resources India Private Limited", "Nagpur", "Unbleached Hardwood Kraft Pulp", "₹65/Kg"],
  ["Sun Plast", "Kolkata", "Cellulose Wood Pulp (Domtar)", "₹30/Kg"],
  ["Moti Enterprises", "Ulhasnagar", "Wood Pulp", "₹60/Kilogram"],
  ["Vechem Organics Pvt. Ltd.", "New Delhi", "White Alpha Cellulose Wood Pulp, For Paper Plate Making", "₹75/Kg"],
  ["S A Enterprises", "Mumbai", "Plain Soft Wood Pulp and Hard Wood Pulp for Hygiene Industry", null],
  ["Sai-Trays Healthcare Private Limited", "Pune", "Birches White Napkin Wood Pulp, Packaging Type: Loose, 110 Gsm", "₹38/Kg"],
  ["AR Enterprises", "Dharuhera", "White Plain Cellulose Pulp 740 gsm for diaper & sanitary pad", "₹98/Kg"],
  ["Aarushi Enterprise", "Banaskantha", "Wood Pulp Sheet", "₹50/Kg"],
  ["Shree Krishna Industries", "Kherli", "Brown Round GY Paper Kraft Roll, 80 GSM", "₹55/Kg"],
  ["Avinash Enterprises", "Deoria", "White Plain Soft Wood Pulp Roll, For Paper Plate Making", "₹160/Kg"],
  ["Shrimannarayan Enterprises Private Limited", "Panvel", "Bleached Softwood Pulp", null],
  ["Cellpap India Private Limited", "Mumbai", "Wood Pulp", null],
  ["Noor Car Care Center", "Sagar", "Acacia Wood Pulp", null],
  ["R.G. Power Trader", "Salem", "Soft Wood Pulp", null],
  ["Rameshwar Dass Goel And Sons", "New Delhi", "Hardwood & Softwood Pulp", null],
  ["Delta Paper Mills Ltd.", "Bhimavaram", "Wood Pulp", null],
  ["Sharal Pulp And Boards", "Namakkal", "Custom Pulp Solutions", null],
  ["Hari Pulp Company", "Chennai", "Wooden Pulp", null],
  ["Kolar Paper Mills Ltd.", "Puttur", "Market Pulp / Wood Chips / Pulpwood Suppliers", null],
  ["Kalpataru Agroforest Enterprise Pvt. Ltd.", "Kolkata", "ECF Wood Pulp", null],
  ["Kalyan Paper Agency", "Kolkata", "Hard Wood Pulp", null],
  ["Karpakam Engineering", "Coimbatore", "Wood Pulp", "₹160/Kg"],
  ["Goodwill Enterprises", "Bhilai", "Wood Pulp", "₹200/Kg"],
];

const PAPER_PULP: Listing[] = [
  ["Shree Krishna Marketing", "New Delhi", "Pulp And Paper", "₹80/Kg"],
  ["JSR International (India) Private Limited", "Loni", "Cellulose Bleeched Paper Pulp", "₹90/Kg"],
  ["Kapoor Mouldchem Pvt. Ltd.", "Sonipat", "Plain Paper Dissolving Pulp", "₹60/Kg"],
  ["Raju Enterprises", "Raigad", "Paper Pulp Powder", "₹60/Kg"],
  ["Oic Meta Alloys", "Udaipur", "Paper Pulp, White", "₹65/Kg"],
  ["The Ekman Enterprises", "Ghaziabad", "Plain Bamboo Pulp Paper Roll", "₹52/Kg"],
  ["Diyan Papers LLP", "Wankaner", "sun prime White MIXED PULP PAPER SHEETS", "₹52/Kg"],
  ["Himmatramka Sales Company", "New Delhi", "Pulp for Paper Grade", null],
  ["Shobhnath Papers LLP", "Bhiwandi", "Waste Paper Pulping", null],
  ["Gem Pharma", "Mumbai", "Paper And Pulp, White", null],
  ["Himanshu Enterprises", "Ghaziabad", "Pulp Paper", "₹60/Kg"],
  ["Sree Venkateswara Enterprises", "Mandapeta", "White Paper Pulp", "₹60/Kg"],
  ["Katyan Enterprises", "Loni", "Paper Pulp", "₹45/Kg"],
  ["Vasundhara Biofibers Private Limited", "Hardoi", "kraft Plain Unbleached Agro Pulp", "₹60/Kg"],
  ["Universal Pulp And Paper", "New Delhi", "Bleached Cotton Linter Pulp", "₹65/Kg"],
  ["Fuma Labs Private Limited", "Gwalior", "Rice Straw Pulp", "₹60/Kg"],
  ["Shyam Packer Mover And Transport", "Ghaziabad", "Paper Pulp", "₹50/Kg"],
  ["Shree Aainath Traders", "Jodhpur", "White Plain Paper Pulp", "₹440/Kg"],
  ["Kalyan Trading Co.", "Ahmedabad", "Paper Pulp", "₹540/Kg"],
  ["Goodrich Ingredients & Chemicals Ltd.", "Chennai", "Rayon Grade Pulp - Carbonless Dissolving", "₹60/Kg"],
  ["Optimum Consultancy Services", "Jaipur", "paper pulp", "₹7/Kg"],
  ["Maroo Brothers", "Indore", "Dry Paper Pulp", "₹35/Kilogram"],
  ["Gayathri Enterprises", "Hyderabad", "PAPER PULP (WHITE)", "₹12/Kg"],
  ["Shrimannarayan Enterprises Private Limited", "Panvel", "Off Grade Pulp", null],
  ["Camy Imports", "Mumbai", "Airlaid Pulp Paper", null],
];

const PAPER_PULP_RAW: Listing[] = [
  ...KRAFT_PAPER_ROLL,
  ...WASTE_PAPER,
  ...WOOD_PULP,
  ...PAPER_PULP,
];

const TIMBER_LOGS: Listing[] = [
  ["Sri Vinayaga Timber And Wood Works", "Chennai", "Padauk Wood Log, For Furniture", "₹3,500/Cubic Feet"],
  ["M/s. Sun City Corporation", "Bengaluru", "Brown Wooden Log, Wood Species: Teak (Sagwan)", "₹1,500/per cft"],
  ["Atul Wood Products", "Nagpur", "Brown Round Timber Log", "₹1,200/Cubic Feet"],
  ["Khan Timber Traders", "Durllabhganj", "Round Indian Sal Log Timber", "₹800/Cubic Feet"],
  ["Satsangam Woods Private Limited", "Kutch", "Meranty Super Strength Logs", "₹1,101/Cubic Feet"],
  ["DS Door (India) Limited", "Faridabad", "Fine Timber Logs", "₹5,100/Cubic Feet"],
  ["Kantilal And Sons Woodworks Private Limited", "Mumbai", "East indian walnut Round Timber Wood Logs, For Furniture", "₹500/Piece"],
  ["Lalgarhia (A Brand Of K D Timber Llp)", "Jaipur", "Timber Wood Log, Wood Species: Meranti", "₹1,550/Cubic Feet"],
  ["Timber Trading Co.", "Secunderabad", "Hardwood 3 Feet Iroko Wood Timber, For Furniture", "₹3,400/Cubic Feet"],
  ["Trishul Enterprise", "Ahmedabad", "Timber Wood Log", "₹1,500/Cubic Feet"],
  ["Brixel Innovation LLP", "Malappuram", "Natural Hardwood Teak Timber Logs", "₹3,500/Cubic Feet"],
  ["Choudhary Trading Company", "Raisinghnagar", "Round 15 Feet Sheesham Wood Log, For Furniture", "₹2,400/Cubic Feet"],
  ["Woodangle", "New Delhi", "Timber Wood Log", "₹720/Cubic Feet"],
  ["Dobriyal Timbers", "Herbertpur", "10' Red Tun Wood Logs, For Furniture", "₹800/Cubic Feet"],
  ["Triputi Timber", "Gurgaon", "CP Timber Wood Logs", "₹1,500/Cubic Feet"],
  ["AKN Furnitures", "Kollam", "Forest Teak Wood Logs", "₹4,500/Cubic Feet"],
  ["Gori Shankar Timber Trader", "Yamuna Nagar", "Safeda Fatti, Wood Species: Eucalyptus", "₹850/Cubic Feet"],
  ["PMJ Wood Industries", "Kannur", "Kushya Wood log", "₹1,600/Cubic Feet"],
  ["Wood Specialities", "Coimbatore", "30% Teak Wood Preservative Timbers Logs", "₹500/Cubic Feet"],
  ["Shri Laxmi Timber Mart", "Vadodara", "Rubber wood 8' Brown Wooden Logs", "₹340/Cubic Feet"],
  ["Asian Landscape", "Bengaluru", "8 Feet Round Timber Log", "₹200/Piece"],
  ["Parbhat Wood Inds", "Yamuna Nagar", "8' Round Timber Wood Log", "₹750/Cubic Feet"],
  ["Riddhi Timbers", "Surat", "Babul Wood Timber Logs", "₹475/Cubic Feet"],
  ["S K Timber Traders", "Mumbai", "Round 8' Timber Wood Log", "₹100/Cubic Feet"],
  ["Sarthak Timber Traders", "Raipur", "10 ft Pine Round Timber Log", "₹600/Piece"],
  ["Khadari Lumber Co.", "Bengaluru", "Silver Wood Logs Timber Products", "₹650/Cubic Feet"],
  ["Shree Ram Industries", "Vadodara", "Sanjo Wood Log", "₹850/Cubic Feet"],
  ["Swastik Enterprise", "Ahmedabad", "Round Hardwood Timber Log, 15-25", "₹550/Cubic Feet"],
  ["Sri Balaji Trading Company", "Samastipur", "Round Red Sal Wood Log, For Window Frame", "₹1,900/Cubic Feet"],
  ["Shankar Timber", "Kolkata", "Wooden Timber Logs", "₹1,000/Cubic Feet"],
  ["Gupta Plywood House", "Gurugram", "Brown Rectangular Hardwood Timber Log, Teak wood", "₹350/Piece"],
  ["Shri Ram Glass & Plywood", "Panchkula", "Brown Rectangular Imported Timber Logs, For Furniture", "₹40,000/Cubic Feet"],
  ["Parmeshwar Timber Mart", "Mapusa", "Round Timber Wood Log", "₹2,400/Cubic Feet"],
];

const WOOD_LOG: Listing[] = [
  ["Sri Vinayaga Timber And Wood Works", "Chennai", "10 feet Round Oak Wood Log", "₹1,100/Cubic Feet"],
  ["Chola Art Galerie", "Thanjavur", "Hardwood Casuarina Woods Log, Eucalyptus", "₹1,600/Cubic Feet"],
  ["Ashok Timbers", "Dindigul", "Brown Round Kumul Wood, For Window Frames", "₹950/Cubic Feet"],
  ["Satsangam Woods Private Limited", "Kutch", "Round Timber Wood POPULAR WOOD LOGS, for Furniture", "₹400/Cubic Feet"],
  ["Kantilal And Sons Woodworks Private Limited", "Mumbai", "Red Rectangular Rose Wood Logs", "₹12,000/Piece"],
  ["Khan Timber Traders", "Durllabhganj", "Hardwood Akashmoni Wood Log, Sal", "₹800/Unit"],
  ["Bhagwati Corporation (india)", "Hansi", "Round Hardwood Kanju Wood", "₹400/Cubic Feet"],
  ["Amatya Group", "Kolkata", "Khair Wood Log", "₹60/Kg"],
  ["Sri Ram & Company", "Dindigul", "Malaysian Vengai Wood", "₹2,700/Cubic Feet"],
  ["Woodangle", "New Delhi", "raw Wood Log", "₹905/Kg"],
  ["H B Soparkar And Co.", "Kalyan", "Haldu Wood Log", "₹850/Cubic Feet"],
  ["AKN Furnitures", "Kollam", "Brown Anjili Wood Logs, For Furniture", "₹1,450/Cubic Feet"],
  ["PMJ Wood Industries", "Kannur", "20' Red Venga Wood, For Furniture", "₹2,000/Piece"],
  ["Century Wood Furnitures", "Dandeli", "10' Round Irulu wood logs", "₹700/Cubic Feet"],
  ["Shiva Timber Traders", "Kot Kapura", "3inch Sheesham Wood", "₹900/Cubic Feet"],
  ["Alok Ji Lakri Dukan", "Patna", "Sal Balla", "₹280/Piece"],
  ["Navin Timber Traders", "Borsad", "Hardwood Wood Log, Teak (Sagwan)", "₹700/Cubic Feet"],
  ["Trishul Enterprise", "Ahmedabad", "Valsadi Wood Log", "₹6,500/Cubic Feet"],
  ["Devku Nursery", "Prantij", "Hardwood Round Log Khair Wood Supplier", "₹30/Kg"],
  ["Choudhary Trading Company", "Raisinghnagar", "Babool Wood Log", "₹500/Cubic Feet"],
  ["Pinkey Zarkhandi Coal Depo", "Surat", "Brown Round Nilgiri wood logs, For Furniture", "₹8,000/Tonne"],
  ["SM Sawmill", "Coimbatore", "Manjium Wood Logs", "₹850/Cubic Feet"],
  ["Rehman Doors", "Bhopal", "Jungle Wood Log, Teak", "₹400/Cubic Feet"],
  ["Akshar Pursottam Saw Mill", "Surat", "Rectangular Wenge Wood Logs", "₹5,000/Cubic Feet"],
  ["Sri Balaji Trading Company", "Samastipur", "60 Round RED CHAH LOG WOOD, For HOME USES", "₹1,600/Kg"],
];

const SAWN_TIMBER: Listing[] = [
  ["Lalgarhia (Brand of K D Timber LLP)", "Jaipur", "Brown Rectangular Teak Sawn Timber, Thickness: 1-1.5", "₹1,212/Cubic Feet"],
  ["Sharma Timber Works", "Kolkata", "Pine 3.0M Sawn Timber", "₹800/Cubic Feet"],
  ["RDBL Enterprises Private Limited", "New Delhi", "8-15 feet Natural Hardwood Sawn Lumber, Thickness: 1 Inches", "₹1,275/Cubic Feet"],
  ["M A Wood Work", "Mumbai", "Brown Rectangular Pine Sawn Timber, Thickness: 19-150mm", "₹600/Cubic Feet"],
  ["Trinity Packaging Company Private Limited", "Mumbai", "Sawn Timber Of Spruce Pine", "₹850/Cubic Feet"],
  ["Khemka Trading Corporation", "Kolkata", "1.6 Inch Rosewood Timber Log", "₹8,501/Cubic Feet"],
  ["Aapt Distribution Private Limited", "Chennai", "KD PINE SAWN TIMBER 22x100x3000mm EUROPEAN KD PINE/SPRUCE SAWN TIMBERS", "₹850/Cubic Feet"],
  ["Knable Infrastructure Private Limited", "Kolkata", "Brown Altwood 32mm Rectangular Pinewood Sawn Timber", "₹700/Cubic Feet"],
  ["Kailash Wood Industries", "Pollachi", "white Sawn Timber", "₹2,600/Cubic Feet"],
  ["Ambey Enterprises", "Jagadhri", "Brown Rectangular Eucalyptus Sawn Timber", "₹360/Cubic Feet"],
  ["Shourya International Impex", "Anjar", "Australian Pine Wood Sawn Size timber", "₹641/Cubic Feet"],
  ["Om Wood Exim", "Anjar", "Pine 4.8M Sawn Timber Wood", "₹571/Cubic Feet"],
  ["Bombay Saw Mills", "Ullal", "Merbau Sawn Timber", "₹2,850/Cubic Feet"],
  ["Gupta Timber Trader Private Limited", "New Delhi", "10 ft Pine Sawn Timber", "₹551/Cubic Feet"],
  ["J.P.Timber & Co.", "Kolkata", "Brown Rectangular Kapur Sawn Timber, Teak wood", "₹2,200/Cubic Feet"],
  ["H B Soparkar And Co.", "Kalyan", "Teak Sawn Timber", "₹1,500/Cubic Feet"],
  ["Prachesta Enterprises", "North 24 Parganas", "Swan Wood Timber", "₹1,600/Cubic Feet"],
  ["National Furniture And Wood Suppliers", "Satara", "Brown Square Pinewood Sawn Timber", "₹1,200/Cubic Feet"],
  ["Ashok Kumar Mondal", "Durllabhganj", "Brown Rectangular Sawn sal Wood Timber, for Furniture", "₹900/Cubic Feet"],
  ["Greenstakes Packaging & Recycling Solutions LLP", "Hyderabad", "Mango Wood Sawn Timber", "₹925/Cubic Feet"],
  ["Brixel Innovation LLP", "Malappuram", "10 ft Rectangular Teak Forest Timber Log", "₹4,000/Cubic Feet"],
  ["Asia Timber Industries", "Kaithal", "Eucalyptus Sawn Timber, Thickness: 0.5 - 6 Inch", "₹900/Cubic Feet"],
  ["A.A. Trading Company", "New Delhi", "Brown Pine Wood Rectangular Sawn Timber, Thickness: 1 To 6\"", "₹671/Cubic Feet"],
  ["Rajanaa Wood", "Chennai", "Wooden Timber In Chennai, For Construction", "₹1,000/Cubic Feet"],
  ["Shankar Timber", "Kolkata", "Sawn Timber Wood", "₹2,000/Cubic Feet"],
  ["Maa Sharda Building Material", "Gwalior", "Pine 8 ft 25mm Sawn Timber", "₹531/Cubic Feet"],
  ["MM Timber Traders", "Durllabhganj", "8ft Sal Sawn Timber Wood", "₹1,300/Cubic Feet"],
  ["S M T Timber", "New Delhi", "8' Meranti Sawn Timber Wood", "₹601/Cubic Feet"],
];

const TIMBER_WOOD: Listing[] = [...TIMBER_LOGS, ...WOOD_LOG, ...SAWN_TIMBER];

const RAW_COTTON: Listing[] = [
  ["Annapoorna Cotspin", "Coimbatore", "MECH 1 Raw Cotton", "₹140/Kg"],
  ["Kothari Sales Corporation", "Ahmedabad", "Raw Material For Cotton Wick", "₹70/Kg"],
  ["Genpro Healthcare LLP", "Begusarai", "Plain Yellow Desi Cotton, For Surgical Use", "₹111/Kg"],
  ["Shree Hari Traders", "Rajkot", "Plain Off White Cotton Coil for Cotton Wick", "₹230/Kg"],
  ["Kapok India", "Bodinayakanur", "Printed Organic Raw Cotton, For Filling Material", "₹300/Kg"],
  ["Shree Balaji Products", "Jaora", "Plain Raw Cotton", "₹350/Kg"],
  ["Paras Trading Company", "Agra", "Pure White Cotton Sliver", "₹200/Kg"],
  ["B.K. Perfumery & Trading", "Indore", "Cotton Wick Raw Material", "₹130/Kg"],
  ["Saidhara Traders", "Indore", "Raw Cotton For Making Wick", "₹150/Kg"],
  ["Sanjay Soot Bhandar", "Indore", "Cotton Raw Material", "₹200/Kg"],
  ["Dev Trading Co.", "Surendranagar", "Plain Raw Cotton For Making Wick", "₹260/Kg"],
  ["Sangeeta Jot Creation", "Pathankot", "Pure White Cotton", "₹270/Kg"],
  ["Globall Eximm", "Ahmedabad", "Plain 2 To 2.5 Off White Raw Cotton Sliver For Wick", "₹195/Kg"],
  ["Shree Karni", "Baran", "White Raw Cotton Sliver", "₹250/Kg"],
  ["Bhavna Gruh Udhyog", "Rajkot", "COTTON WICKS RAW MATERIAL", "₹150/Kg"],
  ["Gold Smith Tools", "Indore", "Plain Fireproof Industrial Cotton", "₹100/Kilogram"],
  ["Om Grih Udyog", "Kanpur", "70 GSM Raw Cotton", "₹75/Kg"],
  ["Ekta Grah Udyog", "Jabalpur", "Long Cotton Wicks Raw Material", "₹180/Kg"],
  ["Maa Vindhyavasani Traders", "Kolhapur", "Raw Cotton", "₹100/Kg"],
  ["M J Cotton Private Limited", "Rajkot", "Off White Loose Cotton", "₹100/Kg"],
  ["Kuber Enterprises", "Nashik", "White Plain Raw Cotton Coil", "₹249/Kg"],
  ["Jyoti Industries", "New Delhi", "Raw Material For Cotton Wick", "₹300/Kg"],
  ["Dharati Enterprise", "Virpur", "White Raw Cotton Sliver", "₹210/Kg"],
  ["Golden Impex", "Jaipur", "Raw Cotton Roll", "₹235/Kg"],
  ["Shri Guru Creations", "New Delhi", "Cotton Wick Raw Material", "₹170/Kg"],
  ["Nikit Enterprises", "Faridabad", "Full white Raw Cotton", "₹350/Kg"],
  ["Mateshwari Enterprises", "Aurangabad", "White Raw Cotton Sliver 2.5G", "₹130/Kg"],
];

const COTTON_YARN: Listing[] = [
  ["Rewatex", "Bhiwandi", "Mercerised Knitting Yarn - Ne 80/2 Cgm Knitting Dyed", "₹750/Kg"],
  ["Conifer Handmades", "Mumbai", "Custom made Elegant Handmade Wavy Cotton Yarns Unique Textures", "₹1,200/Kg"],
  ["Aaj International (India)", "Hinganghat", "Cotton Fair Trade Spun Yarn", "₹195/Kg"],
  ["M.Jiju Silk Mills", "Bengaluru", "Flexi T-Shirt Yarn - Peacock green", "₹500/Kg"],
  ["Annapoorna Cotspin", "Coimbatore", "Ne160 White Cotton Yarn", "₹320/Kg"],
  ["Charvi Overseas", "Ludhiana", "1 Ply NE 24/1 COTTON COMBED DYED YARN", "₹370/Kg"],
  ["Sharda Group", "Nagpur", "2 Ply Plain 40S White Cotton Yarn", "₹210/Kg"],
  ["Rajasekar Textiles", "Rajapalayam", "2.5mm White Cotton Yarn", "₹250/Kg"],
  ["LE Merite Exports Limited", "Mumbai", "Twisted 2 Ply Slub Cotton Yarn", "₹320/Kg"],
  ["Marche International", "New Delhi", "100 Percent Cotton Yarn", "₹100/Kg"],
  ["Yash Shivani Agencies", "Thane", "Twisted 2 Ply Cotton TFO Yarn", "₹250/Kg"],
  ["Concept Textile Corporation", "Ahmedabad", "Cotton Yarns Supplier", "₹150/Kg"],
  ["Kapoor Trading Company", "Meerut", "2 Ply Dyed Cotton Yarn", "₹75/Kg"],
  ["L K Y Mills", "Ahmedabad", "2 24 Cotton Yarn", "₹250/Kg"],
  ["AMBERLY TEXTILES", "Coimbatore", "White Textiles Cotton Yarn", "₹199/Kg"],
  ["Sudhan Yarns", "Chennimalai", "Cotton Yarn Single Ply", "₹360/Kg"],
  ["Abhistron Packaging", "Vadodara", "Cotton Yarn 10 S Count White", "₹55/Kg"],
  ["Keppy Yarns", "Tiruppur", "Weaving Cotton Yarn, 1 ply", "₹185/Kg"],
  ["Hare Krishna Overseas", "Panipat", "20S Coffee Cotton Yarn", "₹95/Kg"],
  ["Gimatex Industries", "Hinganghat", "Raw White Polyester Cotton Combed Yarn", "₹175/Kg"],
  ["Varnita Textiles", "Surat", "Dull Compact Spun Cotton Yarn", "₹471/Kg"],
  ["Bhardwaj Industries", "Ludhiana", "2 Ply Light Blue Cotton Yarn", "₹300/Kg"],
  ["Shree Majisa Yarn Industries", "Surat", "White 1 ply Cotton Dyed Yarn", "₹200/Kg"],
  ["Rangoli House", "Panipat", "White Cotton Yarn", "₹120/Kg"],
  ["Shree Ram Textiles", "Panipat", "White Ring Spun 2 Count Double Ply Dyed Cotton", "₹90/Kg"],
  ["Sree Balaji Denim", "Coimbatore", "Bleached Cone Yarn", "₹600/Kg"],
  ["SK Impex", "Ahmedabad", "100% Cotton yarn", "₹399/Kg"],
  ["C M D International", "Amritsar", "Cotton Yarn", null],
  ["Samanta Commercial Corporation", "Vadodara", "Raw Cotton Yarn", "₹200/Kilogram"],
  ["JD And Company", "Ahmedabad", "100 Percent Cotton Yarn", null],
  ["Uma Textiles India", "Salem", "Cotton Yarn 10s", null],
  ["Hari Yarn", "Coimbatore", "Cotton Yarn", null],
  ["Matrics Export", "Bengaluru", "Cotton Yarn", null],
  ["G Raj Gurukul", "Mumbai", "Cotton Yarns", null],
  ["S. Synthetics", "Silvassa", "Cotton Yarn", null],
  ["Smart Sourcing Inc", "Chandigarh", "Cotton Yarn", null],
  ["Tirupati Exports", "Ahmedabad", "Cotton Yarn", null],
  ["GP Cotton", "Morbi", "With High Spinnability Fibre", null],
  ["S. P. M. D. Impex", "Chennai", "Coloured Cotton Yarn", null],
  ["Teretex Enterprises", "Kolkata", "Cotton Yarn", null],
  ["Deltaa Land P.F", "Tiruchirappalli", "Cotton Yarn", null],
  ["Pearly Gates International", "Rajkot", "Cotton Yarn", null],
  ["Prachi Textiles", "Bhiwandi", "Cotton Yarn", "₹50/Kg"],
  ["AAJ International (India)", "Wardha", "Cotton Yarn", null],
  ["Amin Export", "Ahmedabad", "Cotton Yarn", null],
  ["Asha Exim & Co", "Rajkot", "Cotton Yarn", null],
  ["Sanwariya Yarn", "Surat", "Cotton Yarn", null],
  ["R.M. International", "Gurgaon", "Cotton Yarn", null],
  ["Hetu Textile", "Nagpur", "Cotton Yarns", null],
  ["Ocean International", "Surat", "Cotton Yarn", null],
  ["Sri Karthikeya Spining & Weaving Mills", "Coimbatore", "Cotton Acrylic Blended Yarn", null],
  ["Paneer Selvam Textiles", "Tiruppur", "Cotton Yarn", null],
  ["Jupiter Exports", "Erode", "Cotton Yarns", "₹126/KG"],
  ["3sds", "Coimbatore", "Cotton Yarn", null],
];

const JUTE_YARN: Listing[] = [
  ["Suidhagga Fashions Private Limited", "Jaipur", "International Dyed Jute Yarn Colored, For Textile Industry, Count: 6 LBS", "₹450/Kg"],
  ["LMC Global Private Limited", "Kolkata", "Premium Quality Jute Yarn Roll", "₹25/Kg"],
  ["Sashibhusan Kar & Grandson", "Kolkata", "Plain Jute Yarn", "₹80/Kg"],
  ["Churiwal Technopack Private Limited", "24 Parganas", "Natural Jute Yarn", "₹83/Kg"],
  ["S.R.Jute Packagers Pvt. Ltd.", "Kolkata", "Dyed Brown Jute Yarn For Reaper Binder, For Textile Industry, Count: 20", "₹197/Kg"],
  ["Vinayak Wire Products Pvt. Ltd.", "Kolkata", "Jute Yarn Twine", "₹170/Kg"],
  ["Rishabh Jutex Private Limited", "Kolkata", "Various Multi Ply Jute Yarn, For Textile Industry", "₹96/Kg"],
  ["Green Jute Impex Private Limited", "Kolkata", "Brown Ring Spun Natural Jute Yarn", "₹82/Kg"],
  ["Ma Sarada Rope Works", "Howrah", "Jute Spun Yarn", "₹50/Kg", "manufacturer"],
  ["Nateshwar Impex", "Ahmedabad", "Ring Spun Dyed Aari Jute Yarn, For Textile Industry, Count: 20", "₹300/Kg"],
  ["Narang Sons", "New Delhi", "2 Ply Strand Jute Thread (Diameter 1 mm)", "₹220/Kg"],
  ["K.K.Trading", "Howrah", "Natural Jute Yarn", "₹125/Kg"],
  ["Motto Plast", "Surat", "Natural Brown Plain 1 Ply Jute Yarn, 50", "₹100/Kg"],
  ["Jutex Industries Private Limited", "Raghunathpur", "Natural Jute Yarn", "₹90/Kg"],
  ["Radha Krishna Jute Products Private Limited", "Kolkata", "Plain Brown Jute Yarn, For Weaving, Count: 40", "₹85/Kg"],
  ["Gopinath Enterprise", "Surat", "Jute Yarn", "₹200/Kg"],
  ["Bokul Rope Works", "Howrah", "3 Ply Jute Line", "₹85/Kg", "manufacturer"],
  ["Frontier Enterprise", "Dankuni", "1Ply Jute Yarn", "₹144/Kg", "manufacturer"],
  ["Pradeep Traders", "Kolkata", "Globix Natural Jute Yarn", "₹160/Kg", "manufacturer"],
  ["Bharat Rope Industries", "Howrah", "Jute Yarn 14 Lbs Spool (2 Ply)", "₹110/Kg", "manufacturer"],
  ["R. K. Packagers", "Kolkata", "Jute Yarn Thread", "₹118/Kg"],
  ["Sakambari Cordage Co. Pvt. Ltd.", "Howrah", "Jute Yarn", null, "manufacturer"],
  ["Ambica Threads", "New Delhi", "Yarn", null, "manufacturer"],
  ["CK & Sons Textile", "Meerut", "2mm, 3 Ply Jute Yarn Waxed/Polished", "₹300/Kg", "manufacturer"],
  ["A.M.R Jute Product", "Murshidabad", "Color Jute Yarn", "₹94/Kg", "manufacturer"],
  ["Disha Jute And Allied Products Pvt. Ltd.", "Bhiwani", "Jute Yarn Hanks 28 x 3 x 100\", For Textile Industry", "₹130/Kg", "manufacturer"],
  ["Peet Aamber Industries", "Kolkata", "Jute Hessian ,Jute Yarn, Jute Twine, Hessian Bags", null, "manufacturer"],
  ["Kamarhatty Company Ltd.", "Kolkata", "Jute Yarn (2 Ply, Count 20)", null, "manufacturer"],
];

const POLYESTER_YARN: Listing[] = [
  ["Aaj International (India)", "Hinganghat", "Polyester Linen Yarn, 10 - 40 Single & Double Ply", "₹198/Kg"],
  ["Annapoorna Cotspin", "Coimbatore", "75D Polyester Yarn", "₹120/Kg"],
  ["Jainson Woolcombers Pvt. Ltd.", "Ludhiana", "Polyester Flag Yarn, For Embroidery, Count: 40", "₹195/Kg"],
  ["LE Merite Exports Limited", "Mumbai", "Super Bright Ring Spun Polyester Viscose Blended Yarn, For Knitting", "₹185/Kilogram"],
  ["Sharda Group", "Nagpur", "Plain Bright Polyester Stitching Yarn, For Textile Industry, Count: 30", "₹109/Kg"],
  ["Z International", "Rajkot", "Multicolor High Tenacity Polyester Stitching Yarn", "₹150/Kg"],
  ["Regal Impex", "Jaipur", "REGAL IMPEX Semi-Dull POLYESTER YARN, For Knitting", "₹100/Kg"],
  ["Kalyani Polymers Pvt., Ltd.", "Bengaluru", "96mm Polyester Binder Yarn", "₹350/Kg"],
  ["Yash Shivani Agencies", "Thane", "Semi-Dull White Virgin FD Yarn, For Weaving, Count: 30", "₹110/Kg"],
  ["Kapoor Trading Company", "Meerut", "2 Ply Polyester Dyed Yarn for Textile Industries", "₹120/Kilogram"],
  ["Jainson Hosiery Industries (Regd.)", "Ludhiana", "0 Count Approx Cable Filler Yarn, For Home Furnishing", "₹128/Kg"],
  ["Chandak Expo International", "Thane", "Semi Dull Polyester Yarn", "₹250/Kg"],
  ["Mahalaxmi Overseas", "New Delhi", "Polyester White Polyster Hot Melt Yarn 150 D & 100 D, For Knitting", "₹190/Kg"],
  ["Monbros Tradex Private Limited", "Ludhiana", "White Polyester Polyster yarn, Count: 20, For Textile Industry", "₹188/Kg"],
  ["TGS Industries", "New Delhi", "Dyed Polyester Textured Yarn", "₹200/Kg"],
  ["Shree Majisa Yarn Industries", "Surat", "Multicolor Polyester Yarn, Count: 10", "₹120/Kg"],
  ["L K Y Mills", "Ahmedabad", "2/20 polyester yarn", "₹160/Kg"],
  ["Omeed Threadex LLP", "Surat", "Dyed 0.11mm Colored Polyester Yarn", "₹340/Kg"],
  ["Beauknitt India Private Limited", "Mumbai", "White 1 ply Polyester FDY Bright Yarn, For Textile Industry", "₹95/Kg"],
  ["AMBERLY TEXTILES", "Coimbatore", "Polyester Yarn ., For Knitting,Weaving", "₹130/Kg"],
  ["Asia Enterprises", "New Delhi", "Polyester Reflective Yarn", "₹4,500/Kg"],
  ["Barkaat Packaging", "Mumbai", "Plain white plan Polyester Yarn", "₹400/Kilogram"],
  ["JB Yarns", "Ludhiana", "Dyed plain 8 single polyester yarn, For Packaging", "₹136/Kg"],
  ["Meher International", "Surat", "White Polyester Nylon Bi Component DTY, For Weaving", "₹185/Kg"],
  ["Keppy Yarns", "Tiruppur", "Polyester Yarn, 10 - 100", "₹155/Kg"],
  ["Ram Co.", "Ludhiana", "Black Dyed 2 Ply Polyester Yarn", "₹190/Kg"],
  ["Unique Corporation", "Surat", "Golden Bright Polyester Fancy Yarn, For Textile Industry", "₹200/Kg"],
  ["Gimatex Industries Private Limited", "Hinganghat", "Raw White Polyester Cotton Yarn, For Weaving,Knitting Cloth", "₹150/Kg"],
];

const VISCOSE_YARN: Listing[] = [
  ["Charvi Overseas", "Ludhiana", "Raw White Viscose Yarn, For Knittin, 40", "₹280/Kg"],
  ["M.Jiju Silk Mills", "Bengaluru", "Silk Viscose 120/2 NM Yarn", "₹4,000/Kg"],
  ["Aaj International (India)", "Hinganghat", "Knitting Weaving Yarns, Count: 10s - 80s Single & Double Ply", "₹175/Kg"],
  ["Regal Impex", "Jaipur", "Raw White & Dyed 12 - 80 Cotton Viscose Yarn", "₹150/Kilogram"],
  ["Rewatex", "Bhiwandi", "Viscose Yarn", "₹410/Kg"],
  ["Yash Shivani Agencies", "Thane", "Raw White Plain Viscose TFO Yarn, For Weaving, Count: 20", "₹248/Kg"],
  ["Kapoor Trading Company", "Meerut", "Dyed Polyester Yarn, For Textile Industries, Count: 30", "₹72"],
  ["AMBERLY TEXTILES", "Coimbatore", "Gray Raw Grey Viscose Yarn, For Textile Industry", "₹250/kg"],
  ["L K Y Mills", "Ahmedabad", "staple viscose yarn", "₹175/Kg"],
  ["Keppy Yarns", "Tiruppur", "Bright Raw White Viscose Lenzing Yarn, For Textile Industry", "₹234/Kilogram"],
  ["Royal Gun Thread", "Surat", "Raw White 2 16 Staple Viscose Yarn, For Textile Industry", "₹245/Kg"],
  ["Gimatex Industries Private Limited", "Hinganghat", "Raw White Bright Viscose MVS Yarn, For Doubling, Count: 40", "₹225/Kilogram"],
  ["Meher International", "Surat", "White 58D/8F Eco Jilin BRT LG, For Textile Industry", "₹682/Kg"],
  ["Bhardwaj Industries", "Ludhiana", "Dyed 2 Ply Green Viscose Yarn, For Textile Industry", "₹300/Kg"],
  ["Lakshmi Clothing Company", "Tiruppur", "Dyed Dull 2 Ply White Embroidery Viscose Yarn, Count: 30, For Textile Industry", "₹180/Kg"],
  ["Recitek India", "Thane", "30'S Viscose Yarn", "₹215/Kg"],
  ["Imperial Indigo", "Palladam", "Ring Spun 2 Ply 2/40s viscose Gassed yarn", "₹550/Kg"],
  ["Concept Textile Corporation", "Ahmedabad", "Viscose Yarns Supplier", "₹225/Kg"],
  ["Dev Woollen Mills", "Ludhiana", "Viscose Combed Tops", "₹160/Kilogram"],
  ["A To Z Yarn Traders", "Meerut", "White Semi-Dull Sequence Viscose Polyester Yarn, For Textile Industry", "₹550/Kg"],
  ["RS Spinners", "Ludhiana", "Semi-Dull White Viscose Yarn, For Textile Industry, Count: 30", "₹180/Kg"],
  ["Bajaj & Sons", "Ludhiana", "Vislon yarn 2/28", "₹360/Kg"],
  ["Jay Laxmi Trading Co.", "Ahmedabad", "Viscose Yarn Count 30, 2 Ply", "₹250/Kg"],
  ["Hira Enterprise", "Surat", "Red 140D VISCOSE YARN", "₹635/Kg"],
  ["Om Tex", "Surat", "White Viscose Yarn", "₹535/Kg"],
  ["Hardik Textiles Private Limited", "Bengaluru", "Red,Green And Yellow Viscose Yarn, For Apparels, For Weaving", "₹550/Kilogram"],
  ["New Shatabdi Fashion", "New Delhi", "Viscose Raffia Yarn", "₹170/Kg"],
  ["Aum Sai Enterprise", "Surat", "Staple Yarn", "₹200/Kg"],
];

const TEXTILE_FIBERS: Listing[] = [
  ...RAW_COTTON,
  ...COTTON_YARN,
  ...JUTE_YARN,
  ...POLYESTER_YARN,
  ...VISCOSE_YARN,
];

const IRON_ORE: Listing[] = [
  ["Nilkanth Exports", "Gandhidham", "Grade 63 Iron Ore Fines, Physical State: Powder", "₹6,000/Tonne"],
  ["Florida International", "Mumbai", "Iron Ore Pellets, Particle Size: 20 mm, Physical State: Lump", "₹3,500/Tonne"],
  ["Gogga Minerals & Chemicals", "Hospet", "Solid Mineral Iron Ore, 2% Max", "₹25/Kg"],
  ["Muralidhar Agriculture Fruit And Plantation", "Fatehpur", "Iron Ore, Physical State: Lump", "₹7,500/Tonne"],
  ["Mahavir Trading Company", "Surat", "20-40 Iron Ore", "₹150/Kg"],
  ["J Trans Associates", "Thoothukudi", "Iron Ore, Physical State: Granules", "₹3,800/Tonne"],
  ["SPG Minerals And Alloys Private Limited", "Surat", "Nathural Iron Ore Powder", "₹13.30/Kg"],
  ["Ara Green", "Ahmedabad", "High Density Iron Ore", "₹3,800/Tonne"],
  ["Ecoweave Global", "Bankra", "Iron ore lumps", "₹4,000/Tonne"],
  ["BR Communication", "Bhubaneswar", "iron ore", "₹4,720/Tonne"],
  ["K C Processing Co.", "Jamshedpur", "Iron Ore 5 18 Mm", "₹6,400/Tonne"],
  ["Sunbuild International", "Mumbai", "Iron Ore, Physical State: Solid", "₹15,000/Tonne"],
  ["Thrayee Engineering & Infra Solutions", "Hyderabad", "Black Iron Ore Solid", "₹6,000/Tonne"],
  ["Ghag Minerals", "Sindhudurg", "Black Iron Ore, Physical State: Solid", "₹7,000/Tonne"],
  ["VKalp Exim", "Rajkot", "Iron Ore", null],
  ["Shree Bajrang Sales Pvt Ltd", "Nagpur", "Bhartia Titaniferrous Iron Ore, Packaging Size: Loose", null],
  ["Royalty Minerals", "Mumbai", "Iron Ore", null],
  ["Sree Lakshmi Enterprises", "Vaddeswaram", "Iron Ore", "₹6,500/Tonne"],
  ["Uma Export", "Kolkata", "Iron Ore", null],
  ["Metallic Ferro Alloys LLP", "New Delhi", "Iron Ore, Physical State: Lump", null],
  ["3ci Group", "Jaipur", "Iron Ore, Physical State: Solid", "₹25/Kg"],
  ["Dimitri Trade International", "Kakinada", "Red Crushed Iron Ore", "₹5,200/Tonne"],
  ["Kanado Industrial Manufacturing Solutions", "Jamshedpur", "Iron Ore Granules", "₹6,000/Tonne"],
  ["King Metals & Alloys Ltd.", "Chennai", "Ironore Mineral chennai", "₹7,000/Tonne"],
  ["Sandip Kumar & Co.", "Mandi Gobindgarh", "Iron Ore Lumps", "₹29,800/Tonne"],
  ["Shree Jai Jalaram Trading Co.", "Dahanu Road", "Iron Ore, Physical State: Solid", "₹6,000/Tonne"],
  ["Ravi Guru", "Alwar", "Iron Ore", "₹5,700/Tonne"],
  ["M. P. International", "Jamshedpur", "Sized Iron Ore", "₹5,600/Tonne"],
  ["Mahaveer Metals And Minerals", "Chennai", "Iron Ore (63.5)", null],
  ["K. K. Exports", "Hyderabad", "Iron Ore", null],
  ["TBS Impex", "Anantapur", "Iron Ore", null],
  ["M S Export & Import", "Hyderabad", "Iron Ore", null],
  ["Dominus Trading and Consultancy", "Bengaluru", "Iron Ore", null],
  ["Pentagon Overseas", "Bengaluru", "Iron Ore", null],
  ["Srijan Pyrolusite", "Bengaluru", "Crushed Iron Ore", null],
  ["Shroff Ferro Alloys", "Hyderabad", "Iron Ore", "₹25,000/Tonne"],
  ["Vr Minerals", "Hyderabad", "Dolamite And Iron Ore", null],
  ["Commodity Today", "Delhi", "Iron Ore", null],
  ["Hede Business Group", "Goa", "Mining Iron Ore", null],
  ["Virgos Mines & Minerals", "Jaipur", "Iron Ore", null],
  ["Narcinva Damodar Naik", "Goa", "Raw Iron Ore", null],
  ["Manek Group Of Companies", "Mehsana", "Iron Ore", null],
  ["Pinnacle Inc. India", "Mumbai", "Mining Ore", null],
  ["DRS Group", "Jabalpur", "Iron Ore", null],
  ["Trikut Minchems", "Hyderabad", "Low Grade Iron Ore Fines", null],
  ["Jigsan group of companies", "Bhubaneshwar", "Iron Ore", null],
  ["Killada Nagalatha Imports & Exports Of Metals & Minerals", "Hyderabad", "Raw Iron Ore", null],
  ["Hothur Grand", "Bengaluru", "Iron Ore", null],
  ["Amalagiris", "Panaji", "Iron Ore", null],
  ["Geo Minerals Maping", "Hyderabad", "Iron Ore", null],
  ["Advance Export Private Limited", "Junagadh", "Iron Ore", null],
  ["Diamond Agro Impex", "Mumbai", "Iron Ore", null],
  ["Boom Buying Private Limited", "New Delhi", "Iron Ore", null],
  ["Saini Metals & Minerals Private Limited", "Bhilai", "Iron Ore", null],
  ["S. K. Global Exports", "Thane", "Iron Ore", null],
  ["Naresh kedia", "Kolkata", "Iron Ore", null],
  ["Heya & Co.", "Mumbai", "Iron Ore", "₹4,900/Tonne"],
];

const BAUXITE: Listing[] = [
  ["Apce Constructive Engineering", "Gandhidham", "Bauxite", "₹3,500/Tonne"],
  ["Kalyani Systems", "Raniganj", "Raw Bauxite, Packaging Type: Loose", "₹3,000/Tonne"],
  ["VKalp Exim", "Rajkot", "White Bauxite, Grade: Industrial Grade", "₹3,000/Tonne"],
  ["Om Minerals Lab & Trading", "Junagadh", "Solid Calcined Bauxite", "₹31/Kg"],
  ["Intercity Enterprises", "Chennai", "Bauxite", "₹5,000/Tonne"],
  ["Impex Link", "Bengaluru", "Bauxite 40-48% Minerals, Packaging Type: Box, Grade: Refractory Grade", "₹3,200/Tonne"],
  ["Proadcat India Limited", "Kolhapur", "Activated Bauxite", "₹200/Kg"],
  ["3 S Trading", "Ramgarh", "Orange Cal Bauxite, Packaging Size: 25 kg, Grade: 74% to 75% Al203", "₹12,500/Tonne"],
  ["Regal Oil Factory LLP", "Lohardaga", "Raw Bauxite", "₹1,500/Tonne"],
  ["King Metals & Alloys Ltd.", "Chennai", "Bauxite", "₹11,000/Tonne"],
  ["Agate Decor Enterprise", "Agra", "Aluminium Bauxite Powder, Packaging Type: Bag, Packaging Size: 50 kg", "₹3,000/Tonne"],
  ["Gurukrupa Refractories LLP", "Mandvi", "High Grade Bauxite, Packaging Size: 50 kg", "₹25/Kg"],
  ["Vivek Minerals", "Jabalpur", "Raw Bauxite", null],
  ["Raisha Enterprise", "Gandhidham", "A Grade Activated Bauxite, Packaging Size: 50 kg", "₹2/Kg"],
  ["S G L India", "Bengaluru", "Bauxite", "₹3,850/Tonne"],
  ["Shyam Chemicals & Minerals", "Jaipur", "Bauxite, Packaging Type: Loose", null],
  ["Famak International", "Mumbai", "Bauxite", null],
  ["Emery India Private Limited", "Jamnagar", "Hard Heated Bauxite", null],
  ["Yashasvi Group And Infra", "Ichalkaranji", "Bauxite", "₹1,500/Tonne"],
  ["Siddha Associates", "Katni", "Grade: Refractory Raw Low Grade Bauxite Lumps", "₹1,200/Tonne"],
  ["Randal Enterprise", "Khambhaliya", "Calcine Bauxite VSK", "₹11,000/Tonne"],
  ["Narayani Minerals", "Satna", "Refractory Grade Bauxite", "₹5,000/Tonne"],
  ["Geeta Cements Corporation", "Bhilai", "Alum Grade Bauxite Stone for Cement", "₹4,500/Tonne"],
  ["Harsiddhi Industries", "Porbandar", "Calcine Bauxite Lump, Packaging Type: Loose, Packaging Size: 50 Kg", "₹9,000/Tonne"],
  ["STSPL", "Mumbai", "Bauxite Ore, Grade: 48% Rej 46%, Packaging Size: 10mt", "₹3,600/Tonne"],
  ["Om Enterprises", "Kolhapur", "Bauxite", "₹1,500/Tonne"],
  ["Arun Enterprises", "Bokaro Steel City", "Bauxite", "₹10,000/Tonne"],
  ["Shri Rani Sati Traders", "Jaitwara", "Refractory Grade Bauxite", "₹7,000/Tonne"],
];

const CHINA_CLAY: Listing[] = [
  ["Sukesh Industries Private Limited", "Jaipur", "White Clay Powder", "₹2,500/Tonne"],
  ["Kaomin Industries LLP", "Vadodara", "White China Clay", "₹10.25/Kg"],
  ["Kaolin Techniques Private Limited", "Vadodara", "China Clay For Paper Industry", "₹10,000/Tonne"],
  ["Durga Microns", "Bhuj", "Levigate China Clay, Granular (GAC), Packet", "₹10/Kg"],
  ["Marche International", "New Delhi", "China Clay Powder Lump", "₹17,000/Tonne"],
  ["Iris Impulse India Private Limited", "Gandhidham", "Kaolin Clay Powder", "₹6/Kg"],
  ["Asian Min Chem", "New Delhi", "China clay", "₹8/Kg"],
  ["Naveen Enterprise", "Kolkata", "China Clay", "₹9/Kg"],
  ["Astrra Chemicals LLP", "Chennai", "Micronized China Clay", "₹19/Kilogram"],
  ["Shri Krishna Industries", "Alwar", "China Clay", "₹3.20/Kg"],
  ["Uthaya Chemicals", "Chennai", "China Clay Lumps, Packaging Type: Bag, Packaging Size: 50 kg", "₹7,000/Tonne"],
  ["Mahaveer Surfactants Private Limited", "Chennai", "China Washed and Calcined Clay", "₹15,000/Tonne"],
  ["Om Minerals Lab & Trading", "Junagadh", "Solid White China Clay, Packaging Type: Bag", "₹5,000/Ton"],
  ["Acecone Mines & Minerals", "Bikaner", "China Clay Powder", "₹2,000/Tonne"],
  ["Kalpna Minerals Private Limited", "Mumbai", "China Clay Powder", "₹24/Kg"],
  ["M M Syndicate", "Kolkata", "China Clay", "₹4,000/Tonne"],
  ["Airotech Minerals", "Vadodara", "China Clay", "₹6.30/Kilogram"],
  ["Acme Rub Chem", "Mumbai", "China Clay", "₹7.55/KG"],
  ["Peekay Agencies Private Limited", "Kolkata", "China Clay, 10 kg, Packaging Type: Bag", "₹5/Kilogram"],
  ["Bosh Minchem Private Limited", "Mumbai", "China Clay", "₹4/Kg"],
  ["Shreeram Chemical Industries", "Kolkata", "China Clay", "₹6,000/Tonne"],
  ["Jagdamba Minerals", "Jaipur", "Levigated China Clay", "₹13/Kg"],
  ["Cutch Oil & Allied Industries (1949) Private Limited", "Mandvi", "Micronised China Clays", "₹10/Kg"],
  ["Rajasthan Super Fillers Private Limited", "Udaipur", "Yellow China clay for Rubber", "₹3,000/Ton"],
  ["Shree Kailash Khanij Udyog", "Udaipur", "Sepiolite China Clay, Packaging Type: Bag", "₹1,000/Tonne"],
  ["Kavish Minerals", "Alwar", "China Clay", "₹10/Kg"],
  ["Garg Brothers Plaster Industires", "Taranagar", "China Clay", "₹2,500/Tonne"],
  ["Ecosense Labs India Private Limited", "Mumbai", "B Grade China Clay", "₹25/Kilogram"],
];

const LIMESTONE_LUMPS: Listing[] = [
  ["Sukesh Industries Private Limited", "Jaipur", "Limestone For Boiler", "₹1,600/Tonne"],
  ["Bhagvati Minerals", "Banaskantha", "Natural Limestone Lump", "₹500/Tonne"],
  ["Ganesh Enterprise", "Ahmedabad", "Natural Limestone Lump, For Chemical Industry, Packaging Size: 50 kg", "₹1,000/Tonne"],
  ["Marche International", "New Delhi", "Limestone Lumps And Powder", "₹1,500/Tonne"],
  ["Paradise Minerals", "Mumbai", "Limestone Lumps", "₹5,000/Tonne"],
  ["Labh Projects Private Limited", "Ahmedabad", "Limestone Grits Lumps - Labh Group, Grade: Industrial Grade, Packaging Size: 1000 kg", "₹2,000/Tonne"],
  ["Ratani Global Private Limited", "Ahmedabad", "Limestone Lumps, For Flooring, Packaging Size: 25 kg", "₹1,200/Tonne"],
  ["Truefficient Chem Private Limited", "Ankleshwar", "White Limestone Lumps, Form: Slab, Packaging Size: 1000 kg", "₹2,000/Tonne"],
  ["Ameyaa Industries", "Ahmedabad", "White Limestone Lumps, Grade: Chemical Grade, Packaging Size: 1000 kg", "₹900/Tonne"],
  ["Tara Minerals And Chemicals Private Limited", "Jodhpur", "Limestone Lumps Manufacturer Supplier India", "₹1,250/Tonne"],
  ["Uthaya Chemicals", "Chennai", "Lime Stone Lumps, Grade: Analytical, Packaging Size: 40 kg,50 kg,1 MT", "₹2,500/Tonne"],
  ["Rajasthan Lime Udhyog", "Jodhpur", "Natural Limestone Lump, Industrial Grade", "₹3,000/Tonne"],
  ["VKalp Exim", "Rajkot", "White Limestone Lumps", "₹5,000/Tonne"],
  ["New Punjab Foundry Store", "Ludhiana", "Limestone, For Commmecial, Form: Cut-to-Size", "₹2,000/Tonne"],
  ["Drashti Chemicals", "Vadodara", "White Limestone Lumps (Industrial Grade) - 40 kg", "₹4/Kg"],
  ["Vinayak Gypsum And Interiors Pvt. Ltd.", "Mumbai", "IMPORTED LIMESTONE, lumps size", "₹3,400/Tonne"],
  ["Ashirwad Enterprise", "Ankleshwar", "White Limestone Lumps, Packaging Size: 50 Kg, Grade: Industrial Grade", "₹2,100/TON"],
  ["Garg Brothers Plaster Industires", "Taranagar", "Unpolished Raw Limestone Lumps, Grade: Industrial Grade, Packaging Size: 25 kg", "₹5,400/Tonne"],
  ["Pal Enterprises", "Barrackpore", "Limestone Lumps, For Industrial", "₹1,400/Tonne"],
  ["Mateshwari Lime Product", "Jodhpur", "Lime Stone", "₹900/Tonne"],
  ["Millennium Multi Trade Private Limited", "Porbandar", "Limestone Lumps .", "₹1,500/Tonne"],
  ["Sri Dakshina Moorthy Pulvarisers", "Kurnool", "Raw Limestone Lumps / Limestone Lumps", "₹750/Tonne"],
  ["SVN Bharat Minchem Private Limited", "Jaipur", "Limestone Lumps for Boiler", "₹1,100/Tonne"],
  ["Rajawat Lime Industries", "Jodhpur", "40 Kg Limestone Lumps", "₹600/Tonne"],
  ["Khwaja Lime Udhyog", "Jodhpur", "25Mm Limestone Lumps", "₹4,500/Tonne"],
  ["Raghav Industries Unit II", "Katni", "White Limestone Lumps", "₹6,000/Tonne"],
  ["Calchem Inc", "Jodhpur", "Grey Limestone Lumps", "₹750/Tonne"],
  ["Global Jain Chemical And Minerals", "Jodhpur", "95% White Limestone Lumps, Packaging Size: 40 kg", "₹50/Kg"],
];

const GYPSUM: Listing[] = [
  ["Jaipur Bio Fertilizers", "Jaipur", "Gypsum Granules, Packaging Size: 50 Kg Bag", "₹10,000/Tonne"],
  ["Triveni Chemicals", "Vapi", "Gypsum (13397-24-5) (CaH4O6S)", "₹2.20/Kg"],
  ["Nilkanth Exports", "Gandhidham", "Unwashed Marine Gypsum", "₹600/Tonne"],
  ["Millennium Multi Trade Private Limited", "Porbandar", "Mineral Gypsum", "₹2,200/Tonne"],
  ["Garg Brothers Plaster Industires", "Taranagar", "White 50 kg Gypsum Powder", "₹110/Bag"],
  ["Vinayak Gypsum And Interiors Pvt. Ltd.", "Mumbai", "Gypsum Crystal", "₹15,000/Tonne"],
  ["Neelkanth Sodaclays Pvt. Ltd.", "Jodhpur", "Gypsum", "₹18/Kg"],
  ["Nashik Trading Company", "Nashik", "Gypsum", "₹1,000/Tonne"],
  ["Kanha Bio Fuel & Minerals", "Jaipur", "Agricultural Gypsum Powder, Packaging Size: 25 Kg", "₹1,400/Tonne"],
  ["Logic Impex", "Kolkata", "White Gypsum Lumps, Packaging Type: Loose, Grade: A Grade", "₹13/Kg"],
  ["Mahboob Plaster Of Paris", "Mumbai", "Plaster Gypsum Powder, Packaging Size: 25 Kg", "₹200/Kg"],
  ["Jayherbs", "Hyderabad", "Gypsum Lumps Godanti Pathaar, Pharmaceutical, Packaging Size: 50 Kg", "₹150/Kg"],
  ["Onwallz", "Chennai", "Gyproc Gypsum", "₹280/Bag"],
  ["J Trans Associates", "Thoothukudi", "Ferro Gypsum", "₹1,500/Tonne"],
  ["Samriddhi Trading Co.", "New Delhi", "Godanti Pathar Selenite Gypsum", "₹50/Kg"],
  ["Sri Gayathri Minerals", "Piduguralla", "White Gypsum Plaster, 25 Kg", "₹210/Bag"],
  ["Bahuchar Minerals", "Morbi", "10mm Raw Gypsum Lump", "₹5/Kg"],
  ["Siya Mines", "Sriganganagar", "Cement grade gypsum in himachal pradesh, Packaging Size: Loose", "₹1,300/Ton"],
  ["Khaitan Phosphate And Pesticides Private Limited", "Ratlam", "50 Kg Santan Natural Gypsum, Agricultural", "₹320/Bag"],
  ["Jain Brothers And Company", "Bhopal", "Powder Gypsum (Calcium sulphur), Packaging Type: Bori, Packaging Size: 50kg", "₹190/Kg"],
  ["Hind Interiors", "Noida", "Gypsum", "₹500/Tonne"],
  ["Sri Maha Traders", "Thoothukudi", "Chemical Gypsum, Packaging Size: 100 Kg", "₹1,000/Tonne"],
  ["Raj Shree Minerals", "Jodhpur", "For Medical Industry Salenite (Medical Grade Gypsum), 90%, Loose", "₹4,500/Tonne"],
  ["Apce Constructive Engineering", "Gandhidham", "Pop Gypsum Powder, Industrial, Packaging Size: 25 Kg", null],
  ["Uttaraa Infratech", "Bengaluru", "2 inch gypsum", null],
  ["Gayathiri Enterprises", "Chennai", "Gypsum", "₹6,900/Tonne"],
  ["Shree Paraswanath Enterprises", "Bikaner", "White Gold Gypsum", "₹120/Bag"],
  ["R.K.Interiors P O P Decorators", "Nashik", "Raw Gypsum Lump", "₹210/Tonne"],
];

const SILICA_SAND: Listing[] = [
  ["Adore Multiline Products", "Ahmedabad", "Natural White Silica Sand, 50 kg", "₹5/Kg"],
  ["Shri Balaji Mines & Minerals", "Jaipur", "White Dry Silica Sand, 30-80 Mesh", "₹1,500/Tonne"],
  ["Alfa Engineering Solutions", "Panvel", "CEN Standard Sand", "₹180/Bag"],
  ["Indian Minerals & Metals Corporation", "Mumbai", "White Quartz Sand and Silica Sand, 30-80 Mesh", "₹20/Kg"],
  ["Virsun Industries", "Alwar", "Brown Silica Sand, 30-80 Mesh", "₹8/Kg"],
  ["U S B Chemicals", "Mundra", "White Silica Sand, Packaging Type: Hdpe Bag", "₹2,000/Ton"],
  ["Survi Ramming Mass Private Limited", "Jaipur", "White Silica Sand, 25 kg", "₹2,000/Tonne"],
  ["Akshar Minerals", "Bhuj", "Dry Washed Silica Sand", "₹200/Tonne"],
  ["Badaya Mineral Industries", "Jaipur", "Washed Silica Sand", "₹2,500/Tonne"],
  ["Pratap Corporation", "Ahmedabad", "Quartz Silica Sand", "₹4,000/Tonne"],
  ["Phenix Enterprise", "Ahmedabad", "Silica Sand Quartz for Glass and Construction", "₹750/Tonne"],
  ["Banfam Merchants", "Kolkata", "Silica Sand product, Packaging Type: Hdpe Bag", "₹7,800/Tonne"],
  ["Raghav Productivity Enhancers Limited", "Jaipur", "White Silica Sand", "₹1,200/Tonne"],
  ["Indus Minechem", "Bhuj", "Bhuj Silica Sand", "₹450/Tonne"],
  ["Kaolin Techniques Private Limited", "Vadodara", "White Silica Sand, 50-150 Mesh", "₹3,000/Tonne"],
  ["Pacific Minerals", "Bhuj", "50 Mesh Silica Sand", "₹800/Tonne"],
  ["Universal Abrasive Industries", "Jamnagar", "Natural Silica Sand", "₹1,750/Tonne"],
  ["Labh Projects Private Limited", "Ahmedabad", "Quartz Silica Sand Granules - Labh Group", "₹3,000/Tonne"],
  ["Acuro Organics Limited", "New Delhi", "Green Sand Granules", "₹42/Kg"],
  ["Neelgiri Chemicals Private Limited", "New Delhi", "1632 Silica Sand, For Industrial Abrasive", "₹6/Kg"],
  ["SRP Global Exports", "Mettur", "Off White Silica Sand For Football Turf", "₹5,900/Tonne"],
  ["Kairali Minerals", "Thrissur", "White Silica Filter Sand", "₹6,500/Tonne"],
  ["Virsun Industries", "Alwar", "Silica Sand Aar M 916 51", "₹1,700/Tonne"],
  ["Kalyani Systems", "Raniganj", "Silica Sand", "₹850/Tonne"],
  ["Astrra Chemicals LLP", "Chennai", "Silica Sand For Turf", "₹16.50/Kg"],
  ["Starke Aquacare Technologies", "New Delhi", "Silica Sand", "₹4,500/Tonne"],
  ["Asian Min Chem", "New Delhi", "Filter Media Sand, 50 Kg Bag", "₹2.50/Kg"],
  ["Naveen Enterprise", "Kolkata", "Quartz Silica Sand", "₹9.50/Kg"],
  ["Shiv Trading", "Ahmedabad", "Foundry Grade Silica Sand", "₹1,850/Tonne"],
  ["Gem Stone Industries", "Ahmedabad", "50Mesh Silica Sand Powder", "₹4,800/Tonne"],
  ["Adhipathi Minerals & Chemicals Private Limited", "Chennai", "Silica white Foundry Sand", "₹4,000/Tonne"],
  ["Murlidhar Whiteclay", "Bikaner", "100 Mesh Silica Sand", "₹500/Tonne"],
  ["Lion Minerals", "Bhuj", "Foundry Grade Silica Sand", "₹1,000/Tonne"],
  ["M/s Maa Kalyaneshwari Enterprises", "Kolkata", "Washed Silica Sand", "₹5,000/Tonne"],
  ["Maa Bhagwati Minerals", "Jaipur", "20X60 Mesh Bio Tech Grade Silica Sand Granule", "₹1,800/Tonne"],
];

const MINERALS_ORES: Listing[] = [
  ...IRON_ORE,
  ...BAUXITE,
  ...CHINA_CLAY,
  ...LIMESTONE_LUMPS,
  ...GYPSUM,
  ...SILICA_SAND,
];

const RAW_LEATHER: Listing[] = [
  ["Conifer Handmades", "Mumbai", "custom colored natural leather oil pull up hides for bag designers,journals makers and belt stores", "₹80/sq ft"],
  ["Shruti Fastners Private Limited", "New Delhi", "Raw Leather Skin", null],
  ["Nisa Trading Org", "Chennai", "Brown Raw Leather", null],
  ["Natural Leather Exporters", "Chennai", "Full Chrome Crust Leather", "₹60/Square Feet"],
  ["Naaz International", "Kolkata", "Oily Plain 13mm White Raw Leather", "₹70/Sq ft"],
  ["MNS Enterprise", "Kolkata", "Natural 2 mm Raw Processed Leather", "₹150/sq ft"],
  ["Lulu Leather", "Kozhikode", "Full grains Hairy Wet Salted Hides", "₹510/Piece"],
  ["A B Global", "Howrah", "Glossy Raw Leather", "₹100/sq ft"],
  ["G S Enterprises", "Kanpur", "raw buffalo split hide", "₹26/Kilogram"],
  ["Jalal-Ud-Din & Sons", "Srinagar", "Natural Blue Skins Sheep", null],
  ["Javeed Ahmed & Co.", "Vaniyambadi", "Raw Leather", null],
  ["Mohd Nizam & Co.", "Agra", "Premium Tan Brown Genuine Leather Hide", null],
  ["Riad Impex", "Nashik", "Raw Leather", null],
  ["Ravi Tanneries Pvt. Ltd.", "Jalandhar", "Raw Leather", null],
  ["Fair Deal Leather", "New Delhi", "Natural Plain Raw Sheep Skin Hides", "₹155/Piece"],
  ["C.M. Mohammed Siddique & Co.", "Pernambut", "Raw Hides", "₹25/kg"],
  ["Nishat Exims", "Kanpur", "Raw Leather Hides", null],
  ["MRM Enterprises", "New Delhi", "SHEEP RAW & SALTED HIDE", null],
  ["Md Chand Hide And Skin", "Kamrup", "Raw Salted Hide", "₹450/Piece"],
  ["Mondial Media Private Limited", "Kolkata", "raw leather", null],
  ["Devi Enterprises", "Chennai", "Raw Leathers", "₹345/sq ft"],
  ["Gar Leathers Private Limited", "Chennai", "Raw Leather", null],
  ["Swarup Sales & Services", "Kolhapur", "TANNING OR WORKING HIDES", "₹200/sq ft"],
  ["Blue Star Leather Industries", "Chennai", "Raw Leather Skin", null],
  ["St. Joseph Traders", "Alappuzha", "Raw Leather Hides", "₹1,200/Piece"],
  ["AL Rahman Export", "Kanpur", "CRUST HIDES", "₹300/Sq ft"],
  ["Saraswathi Leather Exports", "Chennai", "Tumbled Raw Leather", null],
  ["Bhole Baba International", "Agra", "Leather Hide", "₹500/PIECE"],
  ["Vishvalakshmi Creation", "Chennai", "Raw Leather", null],
  ["Insha Enterprises", "Kanpur", "Raw Split Leather", null],
  ["D. J. Trader", "Chennai", "Raw Leather", null],
  ["Fazlux Impex Originates", "Chennai", "Leather Hides", null],
  ["Malda Leather", "Karari Chandpur", "Raw Leather", "₹35/sq ft"],
  ["Zuby Jewels", "Jaipur", "Raw Hides", null],
  ["B.A Import", "Jodhpur", "Leather Hides", null],
  ["APM Impact", "Mumbai", "Raw Leather", null],
  ["Sky Exports", "Erode", "Raw Skin", null],
  ["Mn Khan Interprises", "Mumbai", "Raw Leather", null],
  ["Expo Enterprises", "Chennai", "Raw Leather", null],
  ["Danish Ayub Lone", "Sopore", "Raw Leather", null],
  ["Maruth Exports", "Chennai", "Raw Leathers Chemicals", null],
  ["Akbari Exports", "Kolkata", "raw leather", null],
  ["Parsec Exporters", "Ludhiana", "Raw Leather", null],
  ["M H Leather", "Chennai", "Leather Hides", null],
];

const WET_BLUE_LEATHER: Listing[] = [
  ["Narangi Leather", "New Delhi", "Sheep Wet Blue Leather", "₹175/sq ft"],
  ["Akbar Creations", "Chennai", "Wet Blue Leather", "₹45/sq ft"],
  ["Hadi International", "Kolkata", "Wet Blue Leather Sheet", "₹60/sq ft"],
  ["Subhan Exports", "Kanpur", "Buffalo Wet Blue Leather", "₹32/sq ft"],
  ["Pranshi Global Exim", "Pune", "Wet Blue Leather", null],
  ["Nisa Trading Org", "Chennai", "Wet Blue Leather", null],
  ["A P Leather Co. Private Limited", "New Delhi", "Split Leather Wet Blue", "₹20/SQ FT"],
  ["Mohit Traders", "Jaipur", "Wet Blue Leather", "₹45/Square Feet"],
  ["Imaan Impex", "Chennai", "Wet Blue Leather", "₹70/Square Feet"],
  ["Southern Tanners", "Vellore", "Wet Blue Leather", null],
  ["Perfect Leather Industries", "Kanpur", "Goat Wet Blue Leather", null],
  ["World Leather Exports", "Chennai", "Wet Blue Leather", null],
  ["Octane Leathers", "Kanpur", "Wet Blue Split Leather", "₹15/sq ft"],
  ["Rehan Leather Impex", "South 24 Parganas", "Sheep Wet Blue leather", "₹35/sq ft"],
  ["Malerkotla Tenneries", "Malerkotla", "Buffalo Wet Blue Leather", "₹110/Square Feet"],
  ["MNS Enterprise", "Kolkata", "3 mm Wet Blue Leather", "₹150/sq ft"],
  ["Farha Hides", "Pernambut", "Wet Blue Leather", "₹100/Sq ft"],
  ["MK Groups", "Vellore", "Wet Blue Split Leather", "₹90/Sq ft"],
  ["Kothwal Habibur Rahman & Sons", "Pernambut", "Goat Wet Blue Leather", "₹18/sq ft"],
  ["Anja International", "Kanpur", "Goat Wet Blue Leather", "₹30/sq ft"],
  ["Apex Trading", "Kolkata", "Wet Blue Leather", "₹30/sq ft"],
  ["Lotus Global Exim", "Motihari", "Wet Blue Hides", "₹55/sq ft"],
  ["Uswah Global Traders", "Ambur", "Buffalo Wet Blue Leather", "₹45/sq ft"],
  ["Lithium Leather Enterprise", "Kolkata", "Sheep & Goat Wet Blue leather", "₹18/sq ft"],
  ["Smart Traders", "Erode", "Wet Blue Leather gloving materials", "₹15/sq ft"],
  ["AL Malik International", "Kanpur", "Wetblue Leather", "₹30/sq ft"],
  ["Shakil Enterprises", "Kuchaman", "Buffalo Wet Blue Leather", "₹60/Sq ft"],
  ["Taurus Lederwaren", "South 24 Parganas", "Wet Blue Leather", "₹750/Sq ft"],
];

const CATTLE_HIDES: Listing[] = [
  ["Imaan Impex", "Chennai", "Raw Hides", null],
  ["Lulu Leather", "Kozhikode", "Natural Grains Wet Salted Cattle Hides", "₹510/Piece"],
  ["Ovion Lifestyle Pvt. Ltd.", "Bengaluru", "Leather Hides And Skins", "₹160/sq ft"],
  ["Hideskin Godown", "North Lakhimpur", "Cattle Hides", "₹450/Piece"],
  ["Ambala Leather Stores", "Bareilly", "Unisex Leather Hides And Skins", null],
  ["Globe Tanners", "Kanpur", "Cattle Hides", null],
  ["Aar Gee Brothers", "Ghaziabad", "Cattle Hides", null],
  ["Mahboob And Sons", "Kanpur", "Cattle Hides", "₹88/Piece"],
  ["SGT Impex", "Arcot", "Cattle Hides", "₹110/sq ft"],
  ["Sri Sai Veda Enterprises", "Hyderabad", "Cattle Hides", "₹999/Piece"],
  ["Plate Mate", "Bhubaneswar", "Cattle Hides", "₹1,539/Piece"],
  ["Rajkamal Food Products", "Kanyakumari", "Cattle Hides", "₹897/Piece"],
  ["AL Anwari Trading Company", "Ghaziabad", "Cattle Hides", "₹250/Piece"],
  ["S A R Traders", "Bengaluru", "Cattle Hides", "₹500/Piece"],
  ["Aarish International", "Kanpur", "Cattle Hides", "₹750/Piece"],
  ["Rana Enterprises", "Kanpur", "Bleach hides mundella", "₹73/Piece"],
  ["Solvate Laboratories Private Limited", "Patna", "Natural Printed Raw Cattle Hides", "₹34/Piece"],
  ["Lone And Sons", "Handwara", "Animal Skin", "₹700/Square Feet"],
  ["Nisarga Agro Farm", "Bengaluru", "Glossy Plain Wet Salted Cattle Hides", "₹500/Piece"],
  ["AL- Iqbal Hides", "Kanpur", "Raw Hides", "₹20/Square Feet"],
  ["Yanam Abdul Khader Sons", "Rajahmundry", "Cattle Hides", null],
  ["alok bhai ki dukkan dongargaon", "Indore", "Hidis", "₹40/Piece"],
  ["Kangla Food Products", "Imphal", "Cattle Hides", null],
  ["Afra Traders", "Belgaum", "Raw Hides", "₹1,000/Piece"],
  ["Percept General Trading", "Bengaluru", "Leather Hides & Skins", null],
  ["Vijay Enterprises", "Rae Bareli", "Cattle Hides", "₹1,000/Piece"],
  ["Federal Agro Industries Pvt. Ltd.", "Raigad", "Cattle Hides", "₹500/Piece"],
];

const LEATHER_RAW_MATERIAL: Listing[] = [
  ...RAW_LEATHER,
  ...WET_BLUE_LEATHER,
  ...CATTLE_HIDES,
];

const ALL_SUBCATEGORIES: { key: keyof typeof SOURCES; entries: Listing[] }[] = [
  { key: "ferrousMetals", entries: FERROUS_METALS },
  { key: "paperPulp", entries: PAPER_PULP_RAW },
  { key: "timberWood", entries: TIMBER_WOOD },
  { key: "textileFibers", entries: TEXTILE_FIBERS },
  { key: "mineralsOres", entries: MINERALS_ORES },
  { key: "leatherRawMaterial", entries: LEATHER_RAW_MATERIAL },
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
  let existingIds: number[] = [9999]; // seed just below the 10000-10999 block (see lib/supplier-store.ts)
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
      if (c === "Raw Materials") continue;
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

  const dataFile = path.join(process.cwd(), "data", "suppliers", "raw-materials.json");
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ suppliers }, null, 2), "utf-8");
  console.log(`\nWrote ${suppliers.length} suppliers to ${dataFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
