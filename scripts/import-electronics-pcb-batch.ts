// Ingestion run: Electronics / PCB supplier batch (India-wide) — the fourth
// per-category dataset added to the existing multi-file supplier repository
// (see lib/supplier-store.ts's id-block scheme). Follows the exact same
// architecture as scripts/import-cnc-machines-batch.ts: normalizeSupplierRecord
// / computeDataConfidence / computeDedupeKey / findPotentialDuplicates from
// the existing lib/ingestion + lib/dedup modules — nothing new is invented.
//
// SOURCE AUDIT (reported to the user before this script was written):
// 10 pan-India IndiaMART "impcat" category pages, chosen deliberately to
// EXCLUDE the generic "circuit-board.html" category, which the audit found
// dominated by industrial spare-parts resellers (OEM replacement control
// boards for marine engines, CNC/PLC controllers, appliances) rather than
// genuine PCB manufacturers — including it would have miscategorized
// resellers as PCB suppliers. A small TradeIndia supplement is included,
// filtered to India-only, PCB-assembly-evidenced listings (foreign
// suppliers and OEM spare-part resellers found there are excluded).
//
// INCLUSION RULE applied while curating the raw listings below (every
// listing was manually reviewed against this rule before being transcribed
// here — nothing was included by inferring from a company's name alone):
//   - Included only when the LISTING TITLE itself states real PCB
//     manufacturing/fabrication/assembly evidence (material, layer count,
//     PCB type, thickness, surface finish, explicit "manufacturer" /
//     "assembly" / "PCBA" / "EMS" / "contract manufacturing" / "SMT" /
//     "SMD" / "through-hole" / "prototype" wording) — the same standard
//     used for CNC's parseSpecs().
//   - EXCLUDED regardless of title wording: listings naming a third-party
//     OEM brand + model/part number (Cummins, ABB, Siemens, GE, LG,
//     Samsung, Panasonic, Vivo, Fanuc, Juki, Hobart, etc.) — these are
//     spare-parts resellers, not the company's own manufactured product.
//   - EXCLUDED: listings for a clearly unrelated business that surfaced by
//     keyword coincidence (a food company, textile mill, pharma CDMO,
//     decorative novelty item, EV vehicle, hobby kit, bare component/IC,
//     printing/media company, physical fixture/holder product).
//   - EXCLUDED: every foreign (non-Indian) company found on TradeIndia.
//   - Company name alone (e.g. containing "Trading", "Design Solutions")
//     was NOT used to exclude a listing whose title carried genuine PCB
//     manufacturing/assembly evidence — per the user's explicit instruction
//     not to infer (or deny) capability from a company's name.
// A materially larger set of "UNCLEAR" listings (bare titles with no
// manufacturing/assembly spec, ambiguous coded model numbers, or missing
// city information) were found during sourcing and are NOT included here —
// see the Batch 4 report for the excluded counts and reasoning.
//
// PRICING: per instruction, suspicious placeholder/nominal EMS job-work
// rates (the "electronic-assembly-service" and "electronics-contract-
// manufacturing" listings, which showed bare unit-less numbers like "0.10"
// or a vague range like "2500-5000") are treated as MISSING rather than
// real pricing — only product-tied prices with a clear per-unit basis
// (₹X/Piece, ₹X/sq cm, ₹X/Square Inch, etc.) are recorded.
import { promises as fs } from "fs";
import path from "path";
import {
  normalizeSupplierRecord,
  type RawSupplierRecord,
} from "../lib/ingestion/normalize";
import { findPotentialDuplicates, normalizeCompanyName } from "../lib/dedup";
import type { Supplier } from "../lib/supplier-types";

const RETRIEVED_AT_NOTE = "September 2026";

type Listing = [company: string, city: string, title: string, price: string | null];

type SourceKind = "manufacturer" | "assembler" | "ems";

type SubcategorySource = {
  subcategory: string;
  kind: SourceKind;
  url: string;
  sourceName: string;
};

const SOURCES = {
  flexiblePcb: {
    subcategory: "Flexible PCBs",
    kind: "manufacturer",
    url: "https://m.indiamart.com/impcat/flexible-pcb.html",
    sourceName: "IndiaMART — Flexible PCB directory",
  },
  rigidFlexPcb: {
    subcategory: "Rigid-flex PCBs",
    kind: "manufacturer",
    url: "https://m.indiamart.com/impcat/rigid-flex-pcb.html",
    sourceName: "IndiaMART — Rigid-Flex PCB directory",
  },
  multilayerPcb: {
    subcategory: "Multilayer PCBs",
    kind: "manufacturer",
    url: "https://m.indiamart.com/impcat/multilayer-pcb.html",
    sourceName: "IndiaMART — Multilayer PCB directory",
  },
  singlePcb: {
    subcategory: "Single-sided PCBs",
    kind: "manufacturer",
    url: "https://m.indiamart.com/impcat/single-pcb.html",
    sourceName: "IndiaMART — Single-sided PCB directory",
  },
  doubleSidedPcb: {
    subcategory: "Double-sided PCBs",
    kind: "manufacturer",
    url: "https://m.indiamart.com/impcat/double-sided-pcb.html",
    sourceName: "IndiaMART — Double-sided PCB directory",
  },
  rigidPcb: {
    subcategory: "Rigid PCBs",
    kind: "manufacturer",
    url: "https://m.indiamart.com/impcat/rigid-pcb.html",
    sourceName: "IndiaMART — Rigid PCB directory",
  },
  prototypePcb: {
    subcategory: "PCB prototyping",
    kind: "manufacturer",
    url: "https://m.indiamart.com/impcat/prototype-pcb.html",
    sourceName: "IndiaMART — PCB Prototyping directory",
  },
  pcbAssembly: {
    subcategory: "PCB assembly / PCBA",
    kind: "assembler",
    url: "https://m.indiamart.com/impcat/pcb-assembly.html",
    sourceName: "IndiaMART — PCB Assembly directory",
  },
  electronicAssemblyService: {
    subcategory: "SMT / through-hole assembly",
    kind: "assembler",
    url: "https://m.indiamart.com/impcat/electronic-assembly-service.html",
    sourceName: "IndiaMART — Electronic Assembly Service directory",
  },
  electronicsContractManufacturing: {
    subcategory: "Electronic contract manufacturing",
    kind: "ems",
    url: "https://m.indiamart.com/impcat/electronics-contract-manufacturing.html",
    sourceName: "IndiaMART — Electronics Contract Manufacturing directory",
  },
  tradeIndiaPcbAssembly: {
    subcategory: "PCB assembly / PCBA",
    kind: "assembler",
    url: "https://www.tradeindia.com/manufacturers/printed-circuit-board.html",
    sourceName: "TradeIndia — Printed Circuit Board manufacturers directory (India-only, filtered)",
  },
} satisfies Record<string, SubcategorySource>;

const STATE_BY_CITY: Record<string, string> = {
  Vadodara: "Gujarat",
  Ahmedabad: "Gujarat",
  Gandhinagar: "Gujarat",
  Surat: "Gujarat",
  Dehgam: "Gujarat",
  Chhatral: "Gujarat",
  "New Delhi": "Delhi",
  Delhi: "Delhi",
  Bengaluru: "Karnataka",
  Mysuru: "Karnataka",
  Hyderabad: "Telangana",
  Secunderabad: "Telangana",
  Noida: "Uttar Pradesh",
  "Greater Noida": "Uttar Pradesh",
  Ghaziabad: "Uttar Pradesh",
  Mirzapur: "Uttar Pradesh",
  Lucknow: "Uttar Pradesh",
  Mumbai: "Maharashtra",
  "Navi Mumbai": "Maharashtra",
  Bhiwandi: "Maharashtra",
  Ahmednagar: "Maharashtra",
  Pune: "Maharashtra",
  Thane: "Maharashtra",
  Chandur: "Maharashtra",
  Nashik: "Maharashtra",
  Vasai: "Maharashtra",
  Siolim: "Goa",
  Thiruverumbur: "Tamil Nadu",
  Chennai: "Tamil Nadu",
  Coimbatore: "Tamil Nadu",
  Erode: "Tamil Nadu",
  Dindigul: "Tamil Nadu",
  Virudhunagar: "Tamil Nadu",
  Gurugram: "Haryana",
  Gurgaon: "Haryana",
  Panchkula: "Haryana",
  Faridabad: "Haryana",
  Jaipur: "Rajasthan",
  Rupnagar: "Punjab",
  Mohali: "Punjab",
  Fazilka: "Punjab",
  Bhubaneswar: "Odisha",
  Kolkata: "West Bengal",
  Indore: "Madhya Pradesh",
  Puducherry: "Puducherry",
};

function locationFor(city: string): string {
  const cleanCity = city.split(",")[0].trim();
  const state = STATE_BY_CITY[cleanCity];
  return state ? `${cleanCity}, ${state}` : cleanCity;
}

// Literal-evidence-only technical spec extraction — every extracted fact is
// a direct regex match against the listing title, nothing inferred. Same
// discipline as CNC's parseSpecs(): if the source doesn't say it, it isn't
// recorded.
function parsePcbSpecs(title: string): string[] {
  const specs: string[] = [];
  const push = (label: string) => {
    if (!specs.includes(label)) specs.push(label);
  };

  const layerMatch = title.match(/(\d+(?:\s*-\s*\d+)?)\s*layers?\b/i);
  if (layerMatch) push(`${layerMatch[1].replace(/\s+/g, "")}-layer`);

  if (/\bFR[- ]?4\b/i.test(title)) push("FR4");
  if (/\bFR[- ]?1\b/i.test(title)) push("FR1");
  if (/\bglass\s*epoxy\b/i.test(title)) push("Glass Epoxy");
  if (/\bfiber\s*glass\b/i.test(title)) push("Fiber Glass");
  if (/\bmetal\s*core\b/i.test(title)) push("Metal Core");
  if (/\baluminu?m\b/i.test(title)) push("Aluminum");
  if (/\bpvc\b/i.test(title)) push("PVC");

  const minWidthMatch =
    title.match(/([\d.]+\s*mm)\s*min(?:imum)?\s*(?:line|trace)\s*width/i) ||
    title.match(/min(?:imum)?\s*(?:line|trace)\s*width[:\s]*([\d.]+\s*mm)/i);
  if (minWidthMatch) push(`Min line width: ${minWidthMatch[1]}`);

  // Board-thickness mm (checked after min-line-width so that pattern's own
  // "mm" isn't double-counted as a separate generic thickness spec).
  const withoutMinWidth = minWidthMatch ? title.replace(minWidthMatch[0], "") : title;
  const thicknessMatch = withoutMinWidth.match(/(\d+(?:\.\d+)?)\s*mm\b/i);
  if (thicknessMatch) push(`${thicknessMatch[1]}mm thickness`);

  const copperMatch = title.match(/(\d+(?:\.\d+)?)\s*(oz|micron)\b/i);
  if (copperMatch) push(`Copper: ${copperMatch[1]} ${copperMatch[2].toLowerCase()}`);

  if (/\bENIG\b/i.test(title)) push("ENIG surface finish");
  if (/\bHASL\b/i.test(title)) push("HASL surface finish");
  if (/\bOSP\b/i.test(title)) push("OSP surface finish");
  const immersionMatch = title.match(/\bimmersion\s+(gold|silver|tin)\b/i);
  if (immersionMatch) push(`Immersion ${immersionMatch[1].toLowerCase()}`);

  if (/\bHDI\b/i.test(title)) push("HDI");
  if (/\bPTH\b/i.test(title)) push("PTH (plated through-hole)");

  const solderMaskMatch = title.match(/\b(green|red|blue|black|white|yellow)\s*(?:solder\s*)?mask\b/i);
  if (solderMaskMatch) push(`${solderMaskMatch[1]} solder mask`);

  const wattMatch = title.match(/(\d+)\s*w\b/i);
  if (wattMatch && /led|panel|light/i.test(title)) push(`${wattMatch[1]}W`);

  if (/\bsmt\b/i.test(title) || /\bsmd\b/i.test(title)) push("SMT/SMD assembly");
  if (/through[- ]?hole/i.test(title) || /\btht\b/i.test(title)) push("Through-hole assembly");
  if (/\bbga\s*reballing\b/i.test(title)) push("BGA reballing");
  if (/\bturnkey\b/i.test(title)) push("Turnkey assembly");
  if (/box\s*build/i.test(title)) push("Box build assembly");

  return specs;
}

// Suspicious/placeholder pricing filter (instruction #6): the two
// service-style subcategories (generic EMS job-work and contract
// manufacturing) showed bare unit-less numbers or vague ranges with no
// credible per-unit basis — those are recorded as missing rather than as
// real prices. Product-tied prices from the manufacturing/assembly
// subcategories (₹X/Piece, ₹X/sq cm, etc.) are kept as-is.
function creditablePrice(kind: SourceKind, price: string | null): string | null {
  if (!price) return null;
  if (kind === "ems") return null;
  return price;
}

function rawRecordsForSubcategory(key: keyof typeof SOURCES, entries: Listing[]): RawSupplierRecord[] {
  const { subcategory: baseSubcategory, kind, url, sourceName } = SOURCES[key];
  const typeTag =
    kind === "manufacturer"
      ? "PCB manufacturers"
      : kind === "assembler"
        ? "PCB assembly / PCBA"
        : "Electronic contract manufacturing";

  return entries.map(([companyName, city, title, rawPrice]) => {
      const specs = parsePcbSpecs(title);
      const price = creditablePrice(kind, rawPrice);
      const extraTags: string[] = [];
      if (/\bsmt\b/i.test(title) || /\bsmd\b/i.test(title)) extraTags.push("SMT assembly");
      if (/through[- ]?hole/i.test(title) || /\btht\b/i.test(title)) extraTags.push("Through-hole assembly");

      const categories = Array.from(
        new Set(["Electronics / PCB", typeTag, baseSubcategory, ...extraTags])
      );

      const fields = [
        "identity.companyName",
        "identity.location",
        "capabilities.categories",
        "capabilities.products",
        "capabilities.productDescription",
      ];
      if (price) fields.push("commercial.priceRange");
      if (specs.length > 0) fields.push("capabilities.manufacturingCapabilities");

      return {
        companyName,
        location: locationFor(city),
        categories,
        products: [title],
        productDescription: title,
        manufacturingCapabilities: specs,
        priceRange: price ? `${price} (indicative, for: ${title})` : undefined,
        source: {
          url,
          sourceName,
          sourceType: "public_directory",
          fields,
          snippet: `Listed on ${sourceName.includes("TradeIndia") ? "TradeIndia's" : "IndiaMART's"} ${baseSubcategory} category page (retrieved ${RETRIEVED_AT_NOTE}). Full listing title: "${title}".`,
        },
      } satisfies RawSupplierRecord;
    });
}

// ---------------------------------------------------------------------
// Raw listings — curated GENUINE-only (see the inclusion rule in the file
// header). Every entry is transcribed verbatim from WebFetch results
// against the live IndiaMART/TradeIndia pages.
// ---------------------------------------------------------------------

const FLEXIBLE_PCB: Listing[] = [
  ["Vinrox Technologies Private Limited", "Vadodara", "FR1 Flexible PCB (0.2mm)", "₹599/Piece"],
  ["Drishti Electronics", "New Delhi", "Flexible PCB For LED Panel Light, 0.8mm", "₹14/Piece"],
  ["Siltech Corporation Inc", "Bengaluru", "Flexible PCB", "₹250/Piece"],
  ["Argus Embedded Systems Private Limited", "Hyderabad", "FR4 Flexrigid Pcb", "₹100/Piece"],
  ["Argus Embedded Systems Private Limited", "Hyderabad", "FR4 Flexible Circuits Design", "₹100/Unit"],
  ["Tech On Electronics", "Noida", "12W FLEXIBILE PCB", "₹24/Piece"],
  ["Tech On Electronics", "Noida", "6W Flexible Pcb", "₹15/Piece"],
  ["Online Techno Systems LLP", "Mumbai", "FR4 FPC Flexible Cable", "₹50/Piece"],
  ["Linepro Controls Private Limited", "Bhiwandi", "FR4 Flexible Printed Circuits", "₹1,355/Piece"],
  ["Continent Electronics", "Ahmednagar", "FR1 Flexible Printed Circuit Board", "₹300/Piece"],
  ["The Marketing House", "Pune", "Flexible Printed Circuit Boards - PCB", "₹250/Piece"],
  ["Sai Associates", "Bengaluru", "FR4 Flexible PCB Cable", "₹12/Piece"],
  ["Shree Balaji Enterprise", "Surat", "Flexible Pcb Circuit", "₹450/Piece"],
  ["Ramson Electronic Innovation", "Siolim", "Flexible Printed Circuits", "₹399/Piece"],
  ["Tri Stone Industries Private Limited", "Thiruverumbur", "Flexible PCB (FPC) Manufacturer", "₹4,000/Piece"],
  ["Ragha Sai Technologies", "Bengaluru", "Flexible PCB Manufacturers", null],
  ["Zenitic PCB", "Gandhinagar", "Double Layer Flexible PCB - FR-4 (1.6mm, 0.5 oz Copper, 0.25mm Min Line Width)", null],
  ["Touchlink PCB Private Limited", "Gandhinagar", "FR 4 Flexible PCB Board, For Electronics, Copper Thickness: 1.6 mm", null],
  ["Chhaperia Electro Components Private Limited", "Bengaluru", "Flexible Pcb Manufacturers", "₹183/Piece"],
  ["Batra Engineering", "Greater Noida", "Flexible PCB", "₹1,000/Piece"],
  ["New India Work", "Mumbai", "Customized Flexible Transparent Printed PCB Circuits Board", null],
  ["Acme Circuits", "Ahmedabad", "Flexible PCB", null],
  ["Chain Electronics Private Limited", "Gandhinagar", "Flexible PCB", null],
  ["Spinks India Private Limited", "Gurugram", "Flexible Pcb", null],
  ["Holitech India Private Limited", "Noida", "Flexible Printed Circuits", null],
  ["Octane Circuits", "Bengaluru", "FR4 Flexible PCBs", "₹200/Piece"],
  ["Roja Circuit", "Panchkula", "FR1 50W Flexible LED PCB", "₹100/Piece"],
  ["Aditya Circuit Systems", "Ghaziabad", "Flexible PCB Board", "₹40/Piece"],
  ["Ishwari Global Tech Pvt. Ltd.", "Chandur", "Flexible PCB Manufacturer & Supplier", "₹10/Piece"],
];

const RIGID_FLEX_PCB: Listing[] = [
  ["Argus Embedded Systems Private Limited", "Hyderabad", "Rigid Flex Pcb", "₹100/Piece"],
  ["The Marketing House", "Pune", "Rigid Flex Pcb Suppliers In All India", "₹199/Piece"],
  ["Zenitic PCB", "Gandhinagar", "Rigid Flex Pcb", "₹300/Piece"],
  ["Tri Stone Industries Private Limited", "Thiruverumbur", "Rigid-Flex PCB Manufacturer", "₹3,000/Piece"],
  ["Glonix Electronics Private Limited", "Chennai", "Rigid Flex PCB", "₹1,000/Piece"],
  ["Impedx", "Thane", "Rigid, Flex & Rigid-Flex Boards", "₹2,000/Piece"],
  ["Layer Tech Trader", "Gandhinagar", "Flexible PCB and Flexi-Rigid PCB", "₹0.28/Piece"],
  ["Vinrox Technologies LLP", "Vadodara", "Rigid Flex Printed Circuit Board", "₹1,500/Piece"],
  ["Allnyx Technologies LLP", "Vadodara", "Rigid Flex PCB", "₹500/Piece"],
  ["Arktron Electronics", "Faridabad", "Flex Rigid Pcbs", null],
  ["Arktron Electronics", "Faridabad", "Own Double sided Electronic Rigid PCB Boards", null],
  ["P C Process Private Limited", "Bengaluru", "Flex And Rigid-Flex PCBs", null],
  ["Flexify Manufacturing Systems Private Limited", "Coimbatore", "1.5mm Rigid Flex PCB", "₹350/Piece"],
  ["Shara Circuits Private Limited", "Bengaluru", "Rigid Flex PCB", "₹300/Piece"],
  ["Ishwari Global Tech Pvt. Ltd.", "Chandur", "Rigid Flex PCB Manufacturer & Exporter", "₹10/Piece"],
  ["Shri Sai Green Technologies", "Coimbatore", "Rigid Flex PCB", null],
  ["Jyothi Technologies", "Bengaluru", "Rigidised Flexible PCB", null],
  ["Karni Tech Solutions Pvt. Ltd.", "Bengaluru", "Rigid and Flex PCB", null],
  ["Electrobit Technology", "Ahmedabad", "Flex PCB for Wearable device", null],
  ["Chain Electronics Private Limited", "Gandhinagar", "Electronic Rigid Flex PCB", null],
  ["Circuitronix", "Gurgaon", "Rigid-Flex PCBs", null],
  ["Wuerth Elektronik India Pvt. Ltd.", "Mysuru", "Flex Rigid Circuit Boards", null],
  ["Micropack Private Limited", "Bengaluru", "Rigid Flex Pcbs", null],
];

const MULTILAYER_PCB: Listing[] = [
  ["Vinrox Technologies Private Limited", "Vadodara", "6 Layers Multilayer PCB", "₹50,000/Piece"],
  ["Argus Embedded Systems Private Limited", "Hyderabad", "4L HDI PCB", "₹100/Piece"],
  ["Eljos", "Ahmedabad", "FR4 MULTILAYER PCB", "₹0.50/Cm"],
  ["Continent Electronics", "Ahmednagar", "Multi Layer Printed Circuit Board", "₹100/Piece"],
  ["Vision Tech Design Solution", "Ghaziabad", "Pcb Designing Single Layer To 8 Layer", "₹2,500/Piece"],
  ["Nextwave Technologies", "Nashik", "FR4 Multilayer Bare PCB", "₹50/Piece"],
  ["Secure Circuits", "Nashik", "2mm 70 Micron FR4 Multilayer PCB", "₹225/Piece"],
  ["Secure Circuits", "Nashik", "1mm 17 Micron FR4 Multilayer PCB", "₹148/Piece"],
  ["Zenitic PCB", "Gandhinagar", "MULTILAYER 1-20 Layers", "₹200/Piece"],
  ["Vishva Tech", "Gandhinagar", "Multi Layer Pcb", "₹100/Piece"],
  ["A7 Circuit", "Gandhinagar", "Pcb Multilayer Manufacturer", "₹2,000/Piece"],
  ["Teqtis Info Private Limited", "Chennai", "Multilayer Pcb Manufacturing Services", "₹250/Piece"],
  ["The Marketing House", "Pune", "Multilayer PCB - 12 Layer", "₹13.55/Square Inch"],
  ["The Marketing House", "Pune", "Multi Layer PCB - 4 Layer", "₹0.65/Cm"],
  ["Touchlink PCB Private Limited", "Gandhinagar", "FR 4 Multi Layer PCB Board", "₹0.64/Square Inch"],
  ["EEPAC Solutions", "Nashik", "Green PVC Multilayer BARE PCB from 1L - 16L", "₹950/Piece"],
  ["Aaraavi Circuit", "Gandhinagar", "Multilayer Pcb Manufacturing", "₹1,500/Piece"],
  ["Tri Stone Industries Private Limited", "Thiruverumbur", "Multilayer PCB Fabrication (4 Layer / 6 Layer / 8 Layer)", "₹200/Piece"],
  ["RST Ecoenergy Private Limited", "Mirzapur", "Multilayer Pcb", "₹100/Piece"],
  ["Platinum Electronics", "Pune", "DC ENIG PCB Plating, For Electronics, Copper Thickness: 1 mm", "₹1/Cm"],
  ["Apselon Technology Private Limited", "Dehgam", "1.6mm FR4 Multilayer PCB", "₹100/Piece"],
  ["Apselon Technology Private Limited", "Dehgam", "Custom Multilayer PCB As Per Gerber", "₹3,500/Piece"],
  ["Shah Circuit System", "Vadodara", "Multilayer Printed Circuit Board", "₹100/Piece"],
  ["Layer Tech Trader", "Gandhinagar", "FR4 Multilayer Pcb Board", "₹20/Piece"],
  ["Supreme Circuits", "New Delhi", "FR4 Multilayer Printed Circuit Boards", "₹3.75/Sq.Inch"],
];

const SINGLE_PCB: Listing[] = [
  ["Vinrox Technologies Private Limited", "Vadodara", "Single Layer PCB", "₹25,000/Piece"],
  ["Buljin Elmec Private Limited", "Chennai", "Glass Epoxy FR4PCB Fr4 Single Sided Pcb", "₹100/Piece"],
  ["Sunrise Semiconductor", "Mumbai", "Manufacturer Blank Pcb, For Electronic Devices, Number of LED in PCB: 6 Led Display", "₹6/Piece"],
  ["Diya Electronics", "Pune", "Single Sided PCB", "₹440/Piece"],
  ["Michael Electronics", "Coimbatore", "Single Layer Pcb", "₹100/Piece"],
  ["R And D Control Systems", "New Delhi", "Zero PCB Single Side 6x4 inch", "₹49/Piece"],
  ["Blackfox Embedded Solutions", "Erode", "FR4 Electronic Circuit Boards", "₹200/Hour"],
  ["Zenitic PCB", "Gandhinagar", "Aluminum PCB & PCBA, 150 W", "₹15/Piece"],
  ["Spark Tech Labz", "New Delhi", "Fr 1 Single Side Pcb, Copper Thickness: 2 mm", "₹1,500/Piece"],
  ["Zeal Electromech Private Limited", "Pune", "Single Sided Pcb", "₹100/Piece"],
  ["Vishva Tech", "Gandhinagar", "Single Layer PCB", "₹15/Piece"],
  ["Arjun Service", "Chennai", "Aluminum 2.5 Mm Pc Board", "₹1,000/Piece"],
  ["Goyal Enterprises", "New Delhi", "Single Sided PCB Manufacturer", "₹12/Piece"],
  ["A7 Circuit", "Gandhinagar", "Single Side PCB manufacturers in Gurgaon", "₹200/Piece"],
  ["Metro Electronics", "Gandhinagar", "Customized Pcb Manufacturer", "₹48/Piece"],
];

const DOUBLE_SIDED_PCB: Listing[] = [
  ["UK Electro Mech Systems", "Mumbai", "Fr-4 Glass Green Double Layer Printed Circuit Board", "₹0.72/sq cm"],
  ["Vinrox Technologies Private Limited", "Vadodara", "Double Sided PCB (10 x 10 cm)", "₹0.40/sq cm"],
  ["Diya Electronics", "Pune", "Metal Core Double Sided PCB", "₹0.75/Square Centimeter"],
  ["Michael Electronics", "Coimbatore", "Double Sided Printed Circuit Boards", "₹0.70/Piece"],
  ["Mohite Electronics Private Limited", "Pune", "5mm Carbon Printing Double Layer PCB", "₹100/Piece"],
  ["Mohite Electronics Private Limited", "Pune", "FR 4 Double Side PCB", "₹1/Piece"],
  ["Eljos", "Ahmedabad", "Double Sided Pcb", "₹25/Piece"],
  ["R And D Control Systems", "New Delhi", "Dual Side General PCB 6x4", "₹111/Piece"],
  ["Caddline Systems Pvt. Ltd.", "Chennai", "Heavy Copper PCB", "₹600/Piece"],
  ["Blackfox Embedded Solutions", "Erode", "Double Sided PCB", "₹1/Piece"],
  ["D D Enterprises", "Pune", "Double Sided Printed Circuit Boards", "₹100/Piece"],
  ["Metro Electronics", "Gandhinagar", "Through Hole Pcb", "₹69/Piece"],
  ["Vision Tech Design Solution", "Ghaziabad", "PCB Sample Single/ Double Sided", "₹395/Piece"],
  ["Nextwave Technologies", "Nashik", "PCB Circuit Board, Double layered", "₹75/Piece"],
  ["Zenitic PCB", "Gandhinagar", "Aluminum Green Round Double Sided PCB", "₹0.65/Piece"],
  ["Vishva Tech", "Gandhinagar", "Double Sided PCB", "₹80/Piece"],
  ["Continent Electronics", "Ahmednagar", "Double Side Printed Circuit Board", "₹3.20/Piece"],
  ["Secure Circuits", "Nashik", "1.6mm 35 Micron Double Layer PCB (98x85mm)", "₹0.65/sq cm"],
  ["Secure Circuits", "Nashik", "1.6mm 105 Micron Double Layer PCB (98x85mm)", "₹2.18/sq cm"],
  ["Print Well PCB", "Gandhinagar", "Double Sided PTH PCB Boards, For Electronics", "₹0.62/Piece"],
  ["Print Well PCB", "Gandhinagar", "Double Layer PTH PCB, Copper Thickness: 1.6", "₹0.65/sq cm"],
  ["A7 Circuit", "Gandhinagar", "Double Side PCB Green Solder Mask", "₹0.80/sq cm"],
  ["Touchlink PCB Private Limited", "Gandhinagar", "FR 4 Green Mask Double Sided PCB Board", "₹0.60/sq cm"],
  // City not given verbatim in the source snippet for this second Aaraavi
  // Circuit listing — Gandhinagar is used because it is the same company's
  // independently-evidenced location from its MULTILAYER_PCB listing above,
  // not an invented value.
  ["Aaraavi Circuit", "Gandhinagar", "Double Sided Pcb Manufacturers", "₹500/Piece"],
];

const RIGID_PCB: Listing[] = [
  ["Metro Electronics", "Gandhinagar", "Rigid Printed Circuit Board", "₹55/Piece"],
  ["A7 Circuit", "Gandhinagar", "Pcb Board Manufacturer", "₹120/Piece"],
  ["Vinrox Technologies LLP", "Vadodara", "Fiber Glass Rigid Printed Circuit Board", "₹1,000/Piece"],
  ["Allnyx Technologies LLP", "Vadodara", "Rigid PCB", "₹500/Piece"],
  ["Chain Electronics Private Limited", "Gandhinagar", "Rigid PCB", null],
  ["SRS", "Fazilka", "Inverter Bare PCB Circuit Board, Green", "₹85/Unit"],
  ["PCB Globe (India) Private Limited", "Gandhinagar", "Rigid Flex Pcb", "₹0.18/Piece"],
  ["Circuit Systems (India) Private Limited", "Gandhinagar", "FR4 Grade Rigid PCB", null],
  ["Keerthi Industries Limited", "Hyderabad", "Rigid PCB", null],
  ["Fluxden", "Dindigul", "Rigid PCB", null],
  ["HDC Technologies Inc", "Bengaluru", "Rigid Circuit Board", "₹1,72,000/Piece"],
  ["Q-Tech Electronics", "Rupnagar", "Rigid Pcb", null],
  ["AVS Electronics", "Ahmedabad", "Grade Rigid Pcb", null],
  ["Mitatronics", "Navi Mumbai", "Rigid Flex Printed Circuit Board", null],
  ["Micropack Private Limited", "Bengaluru", "High Copper Rigid PCBs", null],
  ["Om Guru Electronics", "Pune", "Rigid Printed Circuit Board", null],
  ["Flashline Ems Private Limited", "Hyderabad", "HDI Rigid PCB", null],
];

const PROTOTYPE_PCB: Listing[] = [
  ["Argus Embedded Systems Private Limited", "Hyderabad", "Pcb Prototype Services", "₹1,000/Piece"],
  ["D&V Engineering", "New Delhi", "5x7 cm Double Sided Universal PCB Prototype Board Green", "₹35/Piece"],
  ["Metro Electronics", "Gandhinagar", "Pcb Prototype Services", "₹350/Piece"],
  ["A7 Circuit", "Gandhinagar", "PCB Prototype Manufacturer in Pune", "₹1,499/Piece"],
  ["Tri Stone Industries Private Limited", "Thiruverumbur", "10 Layer Prototype Pcb Manufacturer", "₹200/Piece"],
  ["G-Tech", "Chennai", "Prototype PCB Assembly Services", "₹100/Piece"],
  ["Touchlink PCB Private Limited", "Gandhinagar", "Double Layer Prototype Pcb", null],
  ["EPS PCB Technologies", "Navi Mumbai", "FR4 8 x 12 cm Prototype Pcb", null],
  ["Shah Circuit System", "Vadodara", "Online Prototype PCB", null],
  ["Disha Elektronics", "New Delhi", "Glass Epoxy Bare PCB, Up To 18", null],
  ["Tissconn Technocrafts Private Limited", "Mohali", "PROTO TYPE BARE PCB", null],
  ["Ranjit Embedded Solutions", "Pune", "FR4 Prototype PCB Assembly Automotive", "₹500/Piece"],
  ["PCB Globe (India) Private Limited", "Gandhinagar", "Prototype Pcb", "₹125/Piece"],
  ["Sem Technology", "Bengaluru", "Prototype PCB", "₹500/Piece"],
  ["Ozonio Technologies", "Chhatral", "PCB Prototyping", "₹5/Piece"],
  ["Vision Electronics", "Navi Mumbai", "Prototype Pcb Assembly Service, Navi Mumbai", "₹16/Piece"],
  ["Master Electronics", "Gandhinagar", "Prototype Pcb Assembly Service", "₹1,500/Piece"],
  ["Elite Systems", "Pune", "Prototype PCB Assembly Service", null],
  ["Piyush Electronics & Electricals Private Limited", "New Delhi", "PCB Prototyping", null],
  ["Innosys Industrial Systems", "Thane", "Led Aluminum Pcb", null],
  ["Yogeshwar Cercuits", "Ahmedabad", "Prototype PCB", null],
];

const PCB_ASSEMBLY: Listing[] = [
  ["UK Electro Mech Systems", "Mumbai", "Glass Epoxy Single Sided PCB Assembly", "₹0.18/Piece"],
  ["Vinrox Technologies Private Limited", "Vadodara", "Turnkey PCB Assembly", "₹499/Piece"],
  ["Arrob", "Secunderabad", "Through Hole Pcb Assembly, For Electronics", "₹999/Piece"],
  ["Mirai Multisolution", "Gurugram", "Electronic PCB Assembly and PCB Soldering SMT TH, Double sided", "₹0.50/Piece"],
  ["Hbeonlabs Technologies Private Limited", "Greater Noida", "Single Sided Pcb Assembly", "₹2,000/Piece"],
  ["Argus Embedded Systems Private Limited", "Hyderabad", "Press Fit Fixture pcb assembly, Multi Layered", "₹100/Piece"],
  ["Enthu Technology Solutions India Private Limited", "Coimbatore", "Printed Circuit Board Assembly", "₹30/Piece"],
  ["Easy Ems India", "Greater Noida", "Mixed PCB Assembly, For Electronics", "₹410/Piece"],
  ["Michael Electronics", "Coimbatore", "Best Printed Circuit board Assembly", "₹1,499/Unit"],
  ["3GB Technology Private Limited", "Jaipur", "Pcb Assembly ., Multi Layered", "₹10/Piece"],
  ["Denics Devices", "Pune", "SMT PCB Assembly 0603 To 0402, Double sided", "₹0.25/Piece"],
  ["Umiya Assembly Technologies", "Vadodara", "FR4 Electronic PCB Assembly Manufacturers, Thickness: 1.6mm", "₹18/Piece"],
  // City assigned from this same company's independently-evidenced listing
  // elsewhere in this batch (electronics-contract-manufacturing.html), not
  // invented — the featured-seller snippet on pcb-assembly.html itself did
  // not show a city.
  ["Trisol Technology", "Pune", "Development Pcb Assembly", "₹1/Piece"],
  ["Theri Embedded Circuits", "Virudhunagar", "Pcb Assembly Service", null],
  ["Continent Electronics", "Ahmednagar", "Pcb Assembly", null],
  ["Blackfox Embedded Solutions", "Erode", "PCB Assembly, For Electronics, Double sided", null],
  ["Star Automations", "Puducherry", "Printed Circuit Board Assy", null],
  ["East India Technologies Pvt Ltd", "Greater Noida", "Green Color Printed Circuit Board Assembly", "₹80/Piece"],
];

const ELECTRONIC_ASSEMBLY_SERVICE: Listing[] = [
  ["MEI Technologies", "Coimbatore", "Double sided Electronic Assembly Service", null],
  ["Argus Embedded Systems Private Limited", "Hyderabad", "Bga Reballing Services", null],
  ["Mohan Electronics & Systems", "New Delhi", "SMD Job Work", null],
  ["Theri Embedded Circuits", "Virudhunagar", "Smd Job Work", null],
  ["Mangal Camtronics", "Mumbai", "Aluminum PCB Assembly Service", null],
  ["Litech Electrosystems Private Limited", "Bhiwandi", "Single sided Electronic Assembly Service", null],
  ["Uma Poly Solutions Private Limited", "Kolkata", "Offline Bare PCB & Electronic Component Assembly Services OEM Services", null],
  ["Fortuna Industries Private Limited", "Lucknow", "SMD Electronic Assembly Service Job Work", null],
  ["Krypton (India) Solutions Pvt. Ltd.", "Bengaluru", "Through-Hole Assembly Services", null],
  ["Acme Circuits", "Ahmedabad", "Electronic Box Build Assembly Services, India", null],
];

const ELECTRONICS_CONTRACT_MANUFACTURING: Listing[] = [
  ["Blackfox Embedded Solutions", "Erode", "PCB Contract Manufacturing Services", null],
  ["Teqtis Info Private Limited", "Chennai", "Electronics Contract Manufacturing", null],
  ["Epsilon Electronics", "Ahmedabad", "Electronics Contract Manufacturing", null],
  ["Trisol Technology", "Pune", "Electronic Contract Manufacturing Service", null],
  ["Frog Innovations Limited", "Noida", "Contract Electronics Manufacturing Service", null],
  ["Ciphermech", "Thane", "Electronic Contract Manufacturing Service", null],
  ["Dura Control Systems", "Chennai", "Electronics Manufacturing Service", null],
  ["Makeitech Solution", "Bhubaneswar", "Electronics Contract Manufacturing", null],
  ["Mangal Camtronics", "Mumbai", "Electronics Contract Manufacturing Service", null],
  ["Allnyx Technologies LLP", "Vadodara", "Electronic Contract Manufacturing Service", null],
  ["Tescom", "Bengaluru", "EMS and Contract Manufacturing of PCBA", null],
  ["Chaitrali Enterprises", "Pune", "PCB Contract Manufacturing", null],
  ["Volts & Bytes Technologies", "Indore", "Electronic Contract Manufacturing Service", null],
  ["Digiopto Technologies Private Limited", "Vasai", "LED Dedicated EMS Service", null],
  ["Siddh-Tech Electronics", "Mumbai", "Electronics Contract Manufacturing", null],
  ["Tecno Systems India Electronics Private Limited", "Bengaluru", "Electronics Contract Manufacturing Services", null],
  ["Electro Trail Technologies Private Limited", "Pune", "Electronics Manufacturing Services Pune", null],
  ["S. R Aaryan Global Tech", "New Delhi", "Contract Manufacturing For Electronics", null],
];

const ALL_SUBCATEGORIES: { key: keyof typeof SOURCES; entries: Listing[] }[] = [
  { key: "flexiblePcb", entries: FLEXIBLE_PCB },
  { key: "rigidFlexPcb", entries: RIGID_FLEX_PCB },
  { key: "multilayerPcb", entries: MULTILAYER_PCB },
  { key: "singlePcb", entries: SINGLE_PCB },
  { key: "doubleSidedPcb", entries: DOUBLE_SIDED_PCB },
  { key: "rigidPcb", entries: RIGID_PCB },
  { key: "prototypePcb", entries: PROTOTYPE_PCB },
  { key: "pcbAssembly", entries: PCB_ASSEMBLY },
  { key: "electronicAssemblyService", entries: ELECTRONIC_ASSEMBLY_SERVICE },
  { key: "electronicsContractManufacturing", entries: ELECTRONICS_CONTRACT_MANUFACTURING },
];

// ---------------------------------------------------------------------
// Cross-subcategory merge — identical pattern to Batches 2 & 3's
// mergeSameCompanyAcrossSubcategories(). A company appearing under several
// genuine PCB subcategory pages (very common in this category — the same
// fabricator posts near-identical listings across "single/double/multi/
// rigid/flex" variants of its own catalog) is folded into ONE supplier
// record, unioning sources/categories/products/specs — never counted
// multiple times, never blindly merged with a differently-named company.
// ---------------------------------------------------------------------

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

// Mirrors lib/ingestion/normalize.ts's computeDataConfidence() rule
// (high: >=2 sources AND >=8 covered fields; medium: >=4 covered fields;
// else low) so a merge that genuinely accumulates more source evidence and
// field coverage can honestly earn a higher confidence tier — never
// inflated beyond what the evidence rule already allows.
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
  let existingIds: number[] = [3999]; // 4000-4999 block (see lib/supplier-store.ts)
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

  // TradeIndia supplement — separate loop since its SOURCES entry shares
  // the same subcategory label as pcbAssembly but a distinct source URL.
  const tradeIndiaListings: Listing[] = [
    ["Star Automations", "Puducherry", "Printed Circuit Board Assy", null],
    ["East India Technologies Pvt Ltd", "Greater Noida", "Green Color Printed Circuit Board Assembly", "₹80/Piece"],
  ];
  totalRawListings += tradeIndiaListings.length;
  for (const raw of rawRecordsForSubcategory("tradeIndiaPcbAssembly", tradeIndiaListings)) {
    const supplier = normalizeSupplierRecord(raw, existingIds);
    existingIds = [...existingIds, supplier.id];
    rawNormalized.push(supplier);
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

  const byConfidence: Record<string, number> = { high: 0, medium: 0, low: 0 };
  for (const s of suppliers) byConfidence[s.intelligence.dataConfidence]++;

  const byState = new Map<string, number>();
  const byCity = new Map<string, number>();
  for (const s of suppliers) {
    const loc = s.identity.location;
    const parts = loc.split(",").map((p) => p.trim());
    const city = parts[0];
    const state = parts[1] ?? loc;
    byCity.set(city, (byCity.get(city) ?? 0) + 1);
    byState.set(state, (byState.get(state) ?? 0) + 1);
  }

  const bySubcategory = new Map<string, number>();
  for (const s of suppliers) {
    for (const c of s.capabilities.categories) {
      if (c === "Electronics / PCB") continue;
      bySubcategory.set(c, (bySubcategory.get(c) ?? 0) + 1);
    }
  }

  console.log(`Total raw listings across ${ALL_SUBCATEGORIES.length} IndiaMART subcategory pages + 1 TradeIndia supplement: ${totalRawListings}`);
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

  const dataFile = path.join(process.cwd(), "data", "suppliers", "electronics-pcb.json");
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ suppliers }, null, 2), "utf-8");
  console.log(`\nWrote ${suppliers.length} suppliers to ${dataFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
