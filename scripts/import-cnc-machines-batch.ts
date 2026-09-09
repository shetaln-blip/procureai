// Ingestion run: CNC Machines supplier batch (India-wide) — the third
// category batch of the 14-category supplier database expansion. Every
// record here traces to a real, fetched public source (see SOURCES below).
// Writes to data/suppliers/cnc-machines.json — a SEPARATE file from
// office-furniture.json, industrial-machinery.json, and the legacy
// packaging file, combined transparently at read time by
// lib/supplier-store.ts. Ids for this file are drawn from the 3000-3999
// block reserved for CNC machines (see the comment in lib/supplier-store.ts
// — that comment is extended below to record this block).
//
// Technical specs (axis count, tool changer, spindle bore, turning length,
// table/bed size, bending capacity, power, automation grade, controller
// brand) are extracted with parseSpecs() below ONLY when the literal
// listing title contains that fact — nothing here is inferred from a bare
// "CNC machine" listing with no stated specs. Extracted specs are stored
// in capabilities.manufacturingCapabilities (an existing free-text array
// field), not a new schema — per "do not create another supplier
// architecture."
//
// Run with: npx tsx scripts/import-cnc-machines-batch.ts
import { promises as fs } from "fs";
import path from "path";
import {
  normalizeSupplierRecord,
  computeDataConfidence,
  type RawSupplierRecord,
} from "../lib/ingestion/normalize";
import { findPotentialDuplicates, normalizeCompanyName } from "../lib/dedup";
import type { Supplier } from "../lib/supplier-types";

const RETRIEVED_AT_NOTE = "2026-09-08";

type SubcategorySource = {
  subcategory: string;
  url: string;
  sourceName: string;
};

const SOURCES = {
  milling: {
    subcategory: "CNC milling machines",
    url: "https://m.indiamart.com/impcat/cnc-milling-machine.html",
    sourceName: "IndiaMART — CNC Milling Machine directory",
  },
  machiningCentre: {
    subcategory: "CNC machining centers",
    url: "https://m.indiamart.com/impcat/cnc-machining-centre.html",
    sourceName: "IndiaMART — CNC Machining Centre directory",
  },
  turning: {
    subcategory: "CNC turning machines",
    url: "https://m.indiamart.com/impcat/cnc-turning-machine.html",
    sourceName: "IndiaMART — CNC Turning Machine directory",
  },
  lathe: {
    subcategory: "CNC lathes",
    url: "https://m.indiamart.com/impcat/cnc-lathe-machine.html",
    sourceName: "IndiaMART — CNC Lathe Machine directory",
  },
  routers: {
    subcategory: "CNC routers",
    url: "https://m.indiamart.com/impcat/cnc-routers.html",
    sourceName: "IndiaMART — CNC Routers directory",
  },
  grinding: {
    subcategory: "CNC grinding machines",
    url: "https://m.indiamart.com/impcat/cnc-grinders.html",
    sourceName: "IndiaMART — CNC Grinders directory",
  },
  drilling: {
    subcategory: "CNC drilling machines",
    url: "https://m.indiamart.com/impcat/cnc-drilling-machine.html",
    sourceName: "IndiaMART — CNC Drilling Machine directory",
  },
  edm: {
    subcategory: "CNC EDM machines",
    url: "https://m.indiamart.com/impcat/cnc-edm-machines.html",
    sourceName: "IndiaMART — CNC EDM Machines directory",
  },
  wireEdm: {
    subcategory: "Wire EDM",
    url: "https://m.indiamart.com/impcat/cnc-wire-cut-edm-machine.html",
    sourceName: "IndiaMART — CNC Wire Cut EDM Machine directory",
  },
  laser: {
    subcategory: "CNC laser cutting machines",
    url: "https://m.indiamart.com/impcat/cnc-laser-cutting-machine.html",
    sourceName: "IndiaMART — CNC Laser Cutting Machine directory",
  },
  plasma: {
    subcategory: "CNC plasma cutting machines",
    url: "https://m.indiamart.com/impcat/cnc-plasma-cutting-machine.html",
    sourceName: "IndiaMART — CNC Plasma Cutting Machine directory",
  },
  waterjet: {
    subcategory: "CNC waterjet machines",
    url: "https://m.indiamart.com/impcat/cnc-water-jet-cutting-machine.html",
    sourceName: "IndiaMART — CNC Water Jet Cutting Machine directory",
  },
  pressBrakes: {
    subcategory: "CNC press brakes",
    url: "https://m.indiamart.com/impcat/cnc-press-brakes.html",
    sourceName: "IndiaMART — CNC Press Brakes directory",
  },
  gearHobbing: {
    subcategory: "CNC gear machines",
    url: "https://m.indiamart.com/impcat/cnc-gear-hobbing-machine.html",
    sourceName: "IndiaMART — CNC Gear Hobbing Machine directory",
  },
  woodCutting: {
    subcategory: "CNC wood-working machines",
    url: "https://m.indiamart.com/impcat/cnc-wood-cutting-machine.html",
    sourceName: "IndiaMART — CNC Wood Cutting Machine directory",
  },
  stoneRouter: {
    subcategory: "CNC stone/marble machines",
    url: "https://m.indiamart.com/impcat/stone-cnc-router-machine.html",
    sourceName: "IndiaMART — Stone CNC Router Machine directory",
  },
  general: {
    subcategory: "CNC machines (general)",
    url: "https://m.indiamart.com/impcat/cnc-machines.html",
    sourceName: "IndiaMART — CNC Machines directory",
  },
} satisfies Record<string, SubcategorySource>;

// ---------------------------------------------------------------------
// City -> State lookup. Superset of the industrial-machinery batch's map
// plus every new city that appeared across the 17 CNC subcategory pages.
// ---------------------------------------------------------------------
const STATE_BY_CITY: Record<string, string> = {
  "New Delhi": "Delhi",
  Delhi: "Delhi",
  Gurugram: "Haryana",
  Gurgaon: "Haryana",
  Noida: "Uttar Pradesh",
  "Greater Noida": "Uttar Pradesh",
  Faridabad: "Haryana",
  Ghaziabad: "Uttar Pradesh",
  Manesar: "Haryana",
  Bawal: "Haryana",
  Chandigarh: "Chandigarh",
  Ambala: "Haryana",
  Kurukshetra: "Haryana",
  Kurali: "Punjab",
  Panipat: "Haryana",
  Sonipat: "Haryana",
  Bhiwadi: "Rajasthan",
  Jaipur: "Rajasthan",
  Mumbai: "Maharashtra",
  "Navi Mumbai": "Maharashtra",
  Thane: "Maharashtra",
  Pune: "Maharashtra",
  Nashik: "Maharashtra",
  Satara: "Maharashtra",
  Vasai: "Maharashtra",
  "Vasai Virar": "Maharashtra",
  Boisar: "Maharashtra",
  Saswad: "Maharashtra",
  "Pimpri Chinchwad": "Maharashtra",
  Dombivli: "Maharashtra",
  Aurangabad: "Maharashtra",
  Bhiwandi: "Maharashtra",
  Bengaluru: "Karnataka",
  Hubballi: "Karnataka",
  Chennai: "Tamil Nadu",
  Coimbatore: "Tamil Nadu",
  Tiruppur: "Tamil Nadu",
  Salem: "Tamil Nadu",
  Vellore: "Tamil Nadu",
  Gobichettipalayam: "Tamil Nadu",
  Ramanathapuram: "Tamil Nadu",
  Ahmedabad: "Gujarat",
  Vadodara: "Gujarat",
  Surat: "Gujarat",
  Rajkot: "Gujarat",
  Anand: "Gujarat",
  Gandhinagar: "Gujarat",
  Gondal: "Gujarat",
  Sanand: "Gujarat",
  Kalol: "Gujarat",
  Waghodia: "Gujarat",
  Wadhwan: "Gujarat",
  Bavla: "Gujarat",
  Kanaipur: "Gujarat",
  Kolkata: "West Bengal",
  Howrah: "West Bengal",
  Cuttack: "Odisha",
  Hyderabad: "Telangana",
  Karimnagar: "Telangana",
  Muradnagar: "Uttar Pradesh",
  Vijayawada: "Andhra Pradesh",
  Ludhiana: "Punjab",
  Batala: "Punjab",
  Mohali: "Punjab",
  Rohtak: "Haryana",
  Meerut: "Uttar Pradesh",
  Mathura: "Uttar Pradesh",
  Saharanpur: "Uttar Pradesh",
  Indore: "Madhya Pradesh",
};

function locationFor(city: string): string {
  const cleanCity = city.split(",")[0].trim();
  const state = STATE_BY_CITY[cleanCity];
  return state ? `${cleanCity}, ${state}` : cleanCity;
}

type Listing = [string, string, string, string | null];

// ---------------------------------------------------------------------
// Technical-spec extraction — ONLY literal facts present in the listing
// title/snippet. Nothing here fabricates a spec for a listing that
// doesn't state one; a listing with no matches contributes no entries.
// ---------------------------------------------------------------------
const CONTROLLER_BRANDS = [
  "FANUC",
  "Siemens",
  "Mitsubishi",
  "Fagor",
  "Syntec",
  "GSK",
  "Mach3",
  "Beckhoff",
  "Heidenhain",
];

function parseSpecs(title: string): string[] {
  const specs: string[] = [];

  const axisMatch = title.match(/(\d+)(?:st|nd|rd|th)?[\s-]?axis(?:es)?/i);
  if (axisMatch) specs.push(`${axisMatch[1]}-axis`);

  if (/\bATC\b/.test(title) || /tool changer/i.test(title) || /tool magazine/i.test(title)) {
    const toolMagazine = title.match(/(\d+)\s*tool magazine/i);
    specs.push(toolMagazine ? `Automatic tool changer (${toolMagazine[1]}-tool magazine)` : "Automatic tool changer");
  }

  const spindleBore = title.match(/spindle bore:\s*([\d.]+\s*mm)/i);
  if (spindleBore) specs.push(`Spindle bore: ${spindleBore[1]}`);

  const turningLength = title.match(/(?:maximum )?turning length:\s*([\d.]+\s*mm)/i);
  if (turningLength) specs.push(`Turning length: ${turningLength[1]}`);

  const turningDiameter = title.match(/(?:maximum )?turning diameter:\s*([\d.]+\s*mm)/i);
  if (turningDiameter) specs.push(`Turning diameter: ${turningDiameter[1]}`);

  const tableSize = title.match(/table size:\s*([\dx]+\s*mm)/i);
  if (tableSize) specs.push(`Table size: ${tableSize[1]}`);
  else {
    const bedWxH = title.match(/(\d{3,5}\s?x\s?\d{3,5}\s?mm)/i);
    if (bedWxH) specs.push(`Work envelope: ${bedWxH[1]}`);
  }

  const bendingCapacity = title.match(/bending capacity:\s*([\d.]+\s*ton)/i);
  if (bendingCapacity) specs.push(`Bending capacity: ${bendingCapacity[1]}`);
  const bendingLength = title.match(/bending length:\s*([\d.]+\s*mm)/i);
  if (bendingLength) specs.push(`Bending length: ${bendingLength[1]}`);

  const power = title.match(/([\d.]+\s?k?W)\b(?!att)/i);
  if (power && /(kw|k w)/i.test(power[1])) specs.push(`Power: ${power[1]}`);

  const rpm = title.match(/(\d{3,6})\s?RPM/i);
  if (rpm) specs.push(`Spindle speed: ${rpm[1]} RPM`);

  const automationGrade = title.match(/automation grade:\s*([a-z-]+)/i);
  if (automationGrade) specs.push(`Automation grade: ${automationGrade[1]}`);

  for (const brand of CONTROLLER_BRANDS) {
    if (new RegExp(`\\b${brand}\\b`, "i").test(title)) specs.push(`Controller/brand: ${brand}`);
  }

  return specs;
}

// A supplier's overall subcategory can be sharpened by an axis count that
// is EXPLICITLY stated in the listing title — e.g. "5-Axis CNC Gantry
// Milling Machines" — for milling and machining-centre listings only,
// where the user specifically asked for 3/4/5-axis milling as distinct
// subcategories. This never applies to a listing with no stated axis
// count (it just keeps the page-level subcategory).
function axisSharpenedSubcategory(baseSubcategory: string, title: string): string | null {
  if (baseSubcategory !== "CNC milling machines" && baseSubcategory !== "CNC machining centers") return null;
  const axisMatch = title.match(/(\d+)(?:st|nd|rd|th)?[\s-]?axis(?:es)?/i);
  if (!axisMatch) return null;
  const n = axisMatch[1];
  if (n === "3" || n === "4" || n === "5") {
    return `${n}-axis CNC milling machines`;
  }
  return null;
}

// ---------------------------------------------------------------------
// RAW LISTINGS, one array per subcategory page.
// ---------------------------------------------------------------------

const MILLING: Listing[] = [
  ["Windset India LLP", "Rajkot", "CNC Drilling Milling Machine ZXCB-CNC-600, Automatic", "₹3,20,000"],
  ["Colorjet India Ltd.", "Noida", "Roland Automatic CNC Milling Machine MDX 50", "₹10,50,000"],
  ["Axisco Corporation", "Gandhinagar", "CNC Milling Machine", "₹8,50,000"],
  ["Micro Teknik", "Ambala", "CNC Milling Machine (Model MTS-3504)", "₹40,000"],
  ["Patson Machines Private Limited", "Pune", "CNC Milling And Deburring Machine, Automatic", "₹85,00,000"],
  ["Quality Engineers", "Ambala", "CNC Milling Machine (800x240mm worktable)", "₹53,10,000"],
  ["Yantra Design Private Limited", "Surat", "4000RPM CNC Milling Machine", "₹44,00,000"],
  ["Premier Machine Tools", "Coimbatore", "CNC Milling Machine (2000 RPM)", "₹1,80,000"],
  ["Machinery Clinic", "Ahmedabad", "CNC Spiral Gear Milling Machine (5 Axes)", "₹1,00,000"],
  ["Zenith Engineering Corporation", "Waghodia", "CNC 3 Axis Aluminium Drilling And Milling Machine", "₹3,75,000"],
  ["Zillion RPM Labs", "Coimbatore", "Automatic Educational CNC Milling Machine", "₹5,95,000"],
  ["D. P. Enterprises", "New Delhi", "CNC Worm Milling Machine", "₹10,00,000"],
  ["Mac Machine Tools", "Coimbatore", "CNC Milling Machine (1000x500mm table)", "₹27,00,000"],
  ["Shah Machinery", "Surat", "CNC Milling Machine (4000 R/Min)", "₹8,05,000"],
  ["J.R. Rao & Co.", "Bengaluru", "CNC Milling Machine (24 Tool Magazine)", "₹20,00,000"],
  ["Kunark Hitech Machining & Sales Private Limited", "Vasai", "Droop & Rein FWL 1600 CNC Milling Machine", "₹1,00,000"],
  ["Himshiv Machines Private Limited", "New Delhi", "Mild Steel CNC Duplex Milling Machines (DPM 200)", "₹15,00,000"],
  ["Sudershan Machinery Pvt Ltd", "Jaipur", "CNC Milling Machine (MT-2 taper)", "₹1,90,000"],
  ["Sahil Alloys And Machine Tools", "Batala", "Suraj 5-Axis CNC Gantry Milling Machines FGM 6", "₹2,75,00,000"],
  ["Interface Design Associates Private Limited", "Bhiwandi", "MM3030 Table Top CNC Milling Machine", "₹4,50,000"],
  ["Octagon Manufacturing Techonology", "Saswad", "Educational CNC Milling Machine", "₹32,000"],
  ["Unitech Advance Technologies", "New Delhi", "CNC Milling Machine, 440V, 24000 spindle", "₹5,00,000"],
  ["Jasan Toolcrafts And Equipments", "Salem", "15kW CNC Milling Machine", "₹15,00,000"],
  ["Monika Engineers", "Ludhiana", "Hust Milling CNC Series (3 Axis)", "₹60,000"],
  ["Bharatmech", "Boisar", "3 Axis CF222 CNC Micro Milling Machine (200x200mm)", "₹7,00,000"],
  ["Hipat Machine Tools", "Cuttack", "CNC Milling Machine (TLPCM 126)", "₹15,60,000"],
  ["Krsnaye Industrial Private Limited", "Mathura", "Stainless Steel 5 Axis CNC Milling", "₹25,000"],
  ["Popular Science Appratus Workshops Private Limited", "Ambala", "CNC Milling Machine (600x300mm table)", "₹2,00,000"],
];

const MACHINING_CENTRE: Listing[] = [
  ["Maaster Machinery & Tools", "Coimbatore", "CNC Vertical Machining Centers", "₹29,00,000"],
  ["Patson Machines Private Limited", "Pune", "CNC Facing, Centring, Drilling & Tapping SPM For Round Bar Model 1135", "₹1,60,00,000"],
  ["Labh Projects Private Limited", "Ahmedabad", "Graphite Machining Center", "₹8,00,000"],
  ["Machinery Clinic", "Ahmedabad", "Chevalier CNC Vertical Machining Center", "₹9,50,000"],
  ["Mehta Hitech Industries Limited", "Ahmedabad", "Glass Processing Centre Machine", "₹19,00,000"],
  ["Yantra Design Private Limited", "Surat", "7000RPM CNC Machining Centre (3 Axis)", "₹39,50,000"],
  ["Raise Machine Tools Private Limited", "Pune", "CNC Vertical Machining Centers (1000x500mm table)", "₹45,00,000"],
  ["Rishabh Technosolutions", "New Delhi", "Vertical Machining Center (3 Axis)", "₹44,00,000"],
  ["Zillion RPM Labs", "Coimbatore", "1325-4S Nesting CNC Machining Centre", "₹28,00,000"],
  ["Newton Technologies", "Bengaluru", "NCP3312Z2 CNC Machining Centre (18000 RPM)", "₹63,00,000"],
  ["Abhijat Equipments Private Limited", "Satara", "Deepak E32 CNC Turning Machine", "₹8,50,000"],
  ["Tussor Machine Tools India Private Limited", "Tiruppur", "CNC Machining Centre (Horizontal)", "₹45,00,000"],
  ["Himshiv Machines Private Limited", "New Delhi", "CNC Multi Tasking Machines", "₹97,00,000"],
  ["Iyalia Engineering Solutions India Private Limited", "Coimbatore", "Industrial SPM Machine CNC (5 Axis)", "₹29,99,999"],
  ["Pathak Machines Industries", "Cuttack", "HIPAT CNC Milling Machine", "₹3,50,000"],
  ["Tamilnadu Engineering Instruments", "Chennai", "CNC Milling Machine", "₹2,50,000"],
  ["Laxmi Metal & Machines", "Rohtak", "3 Axis Vertical Machining Center Bridgeport 1000/22 VMC", "₹2,00,000"],
  ["Shree Umiya F Tech Machines", "Ahmedabad", "CNC Machining Centre (9 Tool)", "₹19,00,000"],
  ["Interface Design Associates Private Limited", "Bhiwandi", "SC-04E 8 Axis CNC And Motion Controller", "₹60,000"],
  ["Aarati Industries", "Ahmedabad", "CNC Machining Centre (600x400mm table)", "₹2,45,000"],
  ["Next Tech CNC Pvt. Ltd.", "New Delhi", "Mild Steel Batliboi CNC Machining Centers", "₹24,00,000"],
  ["Taalin Machinery & Robotics Private Limited", "Chennai", "4th Axis CNC Machining Center For Aluminium Profiles", "₹45,85,950"],
  ["Jarc Teknology", "Ahmedabad", "CNC Miller Machine", "₹3,00,000"],
  ["Pacemaker Solutions", "Ahmedabad", "CNC Machining Centre (2000 RPM)", "₹11,50,000"],
  ["D S Tech", "New Delhi", "Cast Iron 6 And 12 Spindle CNC SPM Machine", "₹15,00,000"],
  ["Dhillon Machinery Corporation", "Kolkata", "Automatic CNC Milling Machine", "₹29,00,000"],
  ["Rajsen Mechatronics & Tools", "Chennai", "CNC Milling Machine Center VL850 Linear Guideways", "₹30,00,000"],
  ["Axiom Enterprises", "Pune", "CNC Machining Centre", "₹20,00,000"],
];

const TURNING: Listing[] = [
  ["Bhavya Machine Tools LLP", "Ahmedabad", "CNC Turning Machine, Spindle bore: 48mm, Turning length: 300 mm", "₹9,60,500"],
  ["Cad Mech Engineering Private Limited", "Pune", "Mini CNC Turning Machine", "₹18,92,000"],
  ["SV CNC Technology", "Rajkot", "CNC Turning Machine GT-100, Spindle bore: 40 mm, Turning length: 140 mm", "₹9,75,000"],
  ["Axisco Corporation", "Gandhinagar", "CNC Turning Machine", "₹10,00,000"],
  ["Maaster Machinery & Tools", "Coimbatore", "CNC Turning Machines", "₹29,00,000"],
  ["Patson Machines Private Limited", "Pune", "CNC Shift Fork Machine", "₹1,05,00,000"],
  ["Machinery Clinic", "Ahmedabad", "Wasino JD1 Twin Spindle Chucker With Fedek Bar Feeder", "₹11,50,000"],
  ["Esskay Lathe Engineers And Traders", "Indore", "Slant Bed CNC Turning Machine", "₹4,50,000"],
  ["Laxmi Metal & Machines", "Rohtak", "CNC Turning DMTG Ingersoll DL30M", "₹1,00,001"],
  ["Tussor Machine Tools India Private Limited", "Tiruppur", "Automatic CNC Turning Machine ST285x1500", "₹34,00,000"],
  ["Mac Machine Tools", "Coimbatore", "CNC Turning Machine, Spindle bore: 26 mm", "₹16,50,000"],
  ["Shree Yantra Solutions", "Bengaluru", "CNC Turning Machine, 115 mm", "₹9,00,000"],
  ["Sahil Alloys And Machine Tools", "Batala", "Suraj CNC Axle Turning Lathe ATL", "₹3,50,00,000"],
  ["Abhijat Equipments Private Limited", "Satara", "HYB 32 CNC Machine", "₹6,20,000"],
  ["SMT Innovative", "Pune", "Midas 8i CNC Turning Machine", "₹18,40,000"],
  ["Zenith Machinery", "New Delhi", "CNC Turning Machine, Turning length: 450 mm", "₹9,00,000"],
  ["A. R. International", "New Delhi", "Bochi SK-40P CNC Turning Lathe Machine", "₹1,100"],
  ["Swaraj Machinery Makers", "Batala", "Heavy Duty CNC Roll Turning Machine", "₹30,00,000"],
  ["Pathak Machines Industries", "Cuttack", "CNC Turning Center KCP 60", "₹12,45,000"],
  ["Vishawkarma Engg. Works", "Mohali", "Special Purpose Machine, 534 mm", "₹16,00,000"],
  ["Maheshwari International", "Pune", "CNC Turning Machine, 534 mm", "₹16,00,000"],
  ["Deneb Industrial Solutions", "Coimbatore", "Realtech CNC Machine CK640 LM", "₹11,00,000"],
  ["Krishna Machine Tools", "Thane", "JAEWOO Art 300 CNC Turning Machine", "₹6,50,000"],
  ["World Tech", "Faridabad", "Megaturn-100 FANUC CNC Turning Machine", "₹2,00,000"],
  ["J.P. Industries", "Rajkot", "CNC Turning Machine", "₹1,00,000"],
  ["Arrow Machine Tools", "Chennai", "CNC Turning Machines", "₹10,50,000"],
  ["Pathak Industries Kol", "Howrah", "KCP-CWT1 CNC Wood Turning Machine for Roman Pillar", "₹9,32,000"],
  ["D.S.Machinery Makers", "Batala", "CNC Turning Lathe Machine", "₹9,50,000"],
];

const LATHE: Listing[] = [
  ["SV CNC Technology", "Rajkot", "CNC Lathe Machine GT-75", "₹8,50,000"],
  ["Bhavya Machine Tools LLP", "Ahmedabad", "CNC Lathe Machine, Maximum turning diameter: 500 mm, Maximum turning length: 200 mm", "₹2,00,000"],
  ["Axisco Corporation", "Gandhinagar", "CNC Trainer Lathe Machine", "₹10,50,000"],
  ["H.P.Singh & Co.", "Kolkata", "CNC Lathe Machine", "₹18,50,000"],
  ["Success Technologies", "Ahmedabad", "CNC Wood Lathe", "₹9,00,000"],
  ["Techno-Mech Machine Tools", "Rajkot", "Semi Automatic CNC Lathe Machine, Maximum turning length: 700 mm, Maximum turning diameter: 500 mm", "₹2,65,000"],
  ["Vmakeu Global Private Limited", "Bengaluru", "CNC Lathe Machine", "₹2,00,000"],
  ["Colorjet India Ltd.", "Noida", "Bench Type CNC Lathe", "₹19,00,000"],
  ["Quality Engineers", "Ambala", "CNC Lathe Machine", "₹41,30,000"],
  ["Jak Machinery", "Surat", "Mini CNC Wood Turning Lathe Machine", "₹5,50,000"],
  ["Premier Machine Tools", "Coimbatore", "Slant Bed CNC Lathe, Maximum turning length: 500 mm, Maximum turning diameter: 400 mm", "₹15,00,000"],
  ["Machinery Clinic", "Ahmedabad", "Flat Bed CNC Lathe, Maximum turning length: 600 mm", "₹8,50,000"],
  ["Jai Technologies", "Vijayawada", "CNC Lathe Machine", "₹3,20,000"],
  ["Kabir Foundry Works", "Ludhiana", "Mild Steel CNC Lathe Machine", "₹12,55,500"],
  ["Karam Industries", "Batala", "CNC Lathe Machine", "₹15,00,000"],
  ["Gautam Industries", "Thane", "Trepanning Lathes", "₹1,00,000"],
  ["Leader Machine Tools", "Batala", "CNC Lathe Machine", "₹15,00,000"],
  ["Tussor Machine Tools India Private Limited", "Tiruppur", "ST 310 3000 CNC Lathe Machine, Maximum turning length: 300 mm", "₹40,00,000"],
  ["D. P. Enterprises", "New Delhi", "Monfort Gear Head CNC Lathe Machine", "₹12,50,000"],
  ["A. R. International", "New Delhi", "Anyang CK 6194 CNC Lathe Machine 4 Meter", "₹1,100"],
  ["ONS Engineers", "Faridabad", "CNC Lathe Machine", "₹23,00,000"],
  ["Caple Industrial Solutions", "Mumbai", "CNC315W Cosen Double Turning Tools CNC Wood Lathe Machine, Maximum turning length: 1000 mm", "₹16,25,000"],
  ["Shree Yantra Solutions", "Bengaluru", "CKI-6140 CNC Lathe CKI Series Machine", "₹10,00,000"],
  ["Sahil Technocrats", "Pune", "CNC Lathe Machine", "₹15,00,000"],
  ["Shree Gajanan Engineers", "Pune", "CNC Lathe Machine KX-46J with X, Y, Z Axis", "₹13,00,000"],
  ["Trilok Lasers", "Pune", "CNC Rotary Lathe Machine", "₹7,50,000"],
  ["Pacemaker Solutions", "Ahmedabad", "CNC Lathe Machine, Maximum turning length: 200 mm", "₹7,80,000"],
  ["Deneb Industrial Solutions", "Coimbatore", "Stainless Steel CNC Series 5 Axis Vices, 4 Inch", "₹78,435"],
];

const ROUTERS: Listing[] = [
  ["Daksh Enterprises", "New Delhi", "6KW CNC Router With Rotary Machine, 3 Axis", "₹6,65,500"],
  ["Mechtek Industries Private Limited", "Ahmedabad", "CNC Acrylic Router Machine", "₹7,50,001"],
  ["H.P.Singh & Co.", "Kolkata", "CNC Router Machine, 3 Axis", "₹4,00,000"],
  ["Shree Umiya Engineers", "Ahmedabad", "3.5kW T Slot Table CNC Wood Router", "₹4,00,000"],
  ["Shusa Mechatronics", "Ahmedabad", "3 Axis CNC Carving Machine", "₹8,81,000"],
  ["Aaradhana Machineries Private Limited", "Kanaipur", "1300x2500mm Multipurpose CNC Router, 3.5 kW", "₹4,70,000"],
  ["Jai Industries", "Ahmedabad", "Optimus Nesting CNC Machine", "₹18,98,000"],
  ["Incos Wood Tech", "Kurukshetra", "CNC Router Machine", "₹2,00,000"],
  ["Techno Laser", "Ahmedabad", "CNC Routers", "₹5,00,000"],
  ["Hunny Impex", "Ahmedabad", "Hi-1325DH CNC Router", "₹8,00,000"],
  ["Success Technologies", "Ahmedabad", "CNC Router With Wood Turning Lathe, 4 Axis", "₹11,50,000"],
  ["Aaditya Mechatronics LLP", "Noida", "CNC Router Cutting Machine -02, 3 Axis", "₹12,50,000"],
  ["Woodmaster (India) Machines Private Limited", "Ludhiana", "CNC Router Machine, 3 Axis", "₹8,50,000"],
  ["Mtech Laser India Private Limited", "Ahmedabad", "MT9060 CNC Router", "₹2,50,000"],
  ["Akshar International Private Limited", "Gondal", "2.2 kW CNC Router Machine", "₹6,00,000"],
  ["Suresh Indu Laser Pvt Ltd", "Pune", "5.5kW CNC Router Machine", "₹5,40,000"],
  ["Lipi Marketing Private Limited", "Chennai", "Maxicut 1325 12 ATC CNC Router", "₹21,00,000"],
  ["R. S. Electro Alloys Private Limited", "New Delhi", "Metal Engraving CNC Router", "₹4,50,000"],
  ["Jak Machinery", "Surat", "Double Head CNC Router, 3 Axis", "₹8,50,000"],
  ["Solar CNC Automation", "Vadodara", "CNC Router Machine (2000x3000mm, 3 Axis)", "₹25,25,000"],
  ["Suresh Indu Lasers Private Limited", "Pune", "Stone CNC Router Machine, 3 Axis", "₹9,00,000"],
  ["R.K. Corporation", "Greater Noida", "Multipurpose Stone CNC Routers", "₹8,50,000"],
  ["Hunkjet Laser", "Pune", "CNC Router Machine, 3 Axis", "₹6,00,000"],
  ["Printo", "Gobichettipalayam", "CNC Router -Roller Attached", "₹5,50,000"],
  ["VSL Technology", "New Delhi", "CNC Router Cutting Machine, 3.5 kW", "₹3,60,000"],
  ["Zillion RPM Labs", "Coimbatore", "CNC Router with Superior Bed and Electronics", "₹5,50,000"],
  ["Vishvkarma Machine Tools", "Ambala", "CNC Router Machine, 9 kW", "₹4,50,000"],
  ["Wanneng Trading Company", "Ghaziabad", "4 Axis CNC Router Machine", "₹6,10,000"],
];

const GRINDING: Listing[] = [
  ["Kismat Machines India Private Limited", "Pune", "Yuva SCG-20 CNC Tool Grinding Machine, 3-Axis", "₹2,46,000"],
  ["Precision Machine Tool", "Ahmedabad", "Cylindrical CNC Grinding Machine, 2-Axis", "₹32,98,000"],
  ["Machinery Clinic", "Ahmedabad", "HMT Mild Steel CNC 500 Universal Worm Shaft Grinding Machine 7 Axis", "₹2,50,00,000"],
  ["Lakshmi Electro Controls And Automation", "Bengaluru", "Silver Steel Mac 26 4 Axis CNC Tool Regrinding Machine, Auto, 9000 RPM", "₹28,18,440"],
  ["Zillion RPM Labs", "Coimbatore", "CNC Tools Grinding Machine", "₹68,500"],
  ["Prime Technologies", "Mumbai", "CNC Gear Profile Grinding Machine", null],
  ["Vollmer Technologies India Private Limited", "Bengaluru", "Vollmer VGrind Argon Linear CNC Tool & Cutter Grinding Machine", "₹4,50,00,000"],
  ["Atul Machine Tools", "Rajkot", "CNC Grinding Machine", "₹25,00,000"],
  ["A. R. International", "New Delhi", "Normac CNC Thread Tap Grinder", "₹7,05,000"],
  ["Rushil Engineering", "Ahmedabad", "Twist PNC 450 Internal Grinding Machines", "₹11,00,000"],
  ["Arswan", "Pimpri Chinchwad", "Arswan MD-60 Grinding Machine", "₹6,50,000"],
  ["Pathak Industries Kol", "Howrah", "CNC Surface Grinder, Model: PPSC-24", "₹48,00,000"],
  ["Kunark Hitech Machining & Sales Private Limited", "Vasai", "Matrix 39 (CNC Five Axis) CNC Thread Grinder Machine", "₹1,00,000"],
  ["Deneb Industrial Solutions", "Coimbatore", "Edgetec 5 Axis CNC Tool Grinding Machine Model CTG-520S/526S/536S", "₹37,50,000"],
  ["Sanki Machine Tools (India) Private Limited", "Mumbai", "Chevalier CNC Surface Grinder", "₹7,00,000"],
  ["Laxmi Metal & Machines", "Rohtak", "CNC Gear Grinder, Niles-ZP08/2, 800 mm", "₹1,00,001"],
  ["Laxman Machine Tools", "Wadhwan", "1 Axis CNC Centerless Grinding Machine", "₹10,00,000"],
  ["Bhurji Grinders", "Faridabad", "CNC Surface Grinding Machine", "₹10,50,000"],
  ["Aolin Engineering Private Limited", "Ramanathapuram", "CNC Grinding Machine, 2-Axis", "₹8,00,000"],
  ["Techno Crafts", "Pune", "CNC Grinding Machine", "₹2,00,000"],
  ["Kandha Machinery Corporation", "Coimbatore", "CNC End Mill Grinding Machine", "₹2,90,000"],
  ["LSK Machine Tools", "Coimbatore", "THW 3080 Worm Grinding Machine", "₹35,00,000"],
  ["United Grinding India LLP", "Bengaluru", "Planomat XT Essential Grinding Machines, Horizontal", "₹3,00,00,000"],
  ["Rekha Engineering Works", "Wadhwan", "CNC Angular Head Grinding Machine, Horizontal", "₹22,00,000"],
  ["Prayosha Industries", "Ahmedabad", "C2X 1632 Fully Automatic CNC Surface Grinding Machine", "₹2,20,000"],
  ["Smartek Machines Private Limited", "Muradnagar", "Internal Smart IG150/250 CNC Bore Grinder Machine, 3-Axis", "₹42,00,000"],
  ["Injectman Plastic", "Faridabad", "Bhurji CNC Surface Grinding Machine", "₹18,50,000"],
  ["CNC Techno Cart", "Bengaluru", "CNC Gear Grinding Machine", "₹45,00,000"],
];

const DRILLING: Listing[] = [
  ["Windset India LLP", "Rajkot", "CNC Drilling Milling Machine ZXCB-CNC-1050", "₹4,50,000"],
  ["Axisco Corporation", "Gandhinagar", "Automatic CNC Plate Drilling Machine", "₹28,00,000"],
  ["Hunny Impex", "Ahmedabad", "Huahua CNC Six Sided Drilling Machine", "₹31,00,000"],
  ["Prakash Engitech Private Limited", "Rajkot", "CNC Flange ATC Drilling Machine", "₹29,85,000"],
  ["R S Electroalloys Private Limited", "New Delhi", "Automatic CNC EDM Small Hole Drilling Machine", "₹3,00,000"],
  ["Patson Machines Private Limited", "Pune", "CNC 5 Axis Microdrilling Machine, 10 mm", "₹45,00,000"],
  ["Jai Industries", "Ahmedabad", "Optimus CNC Drilling Machine", "₹31,98,000"],
  ["A & P Automation Systems", "Vadodara", "Automatic Mild Steel CNC Drilling Milling Machine, 40W, Capacity: 650mm", "₹30,00,000"],
  ["Yantra Design Private Limited", "Surat", "5000RPM CNC Drilling Machine", "₹38,50,000"],
  ["Avi Enterprises", "Faridabad", "CNC Drilling Machine", "₹6,00,000"],
  ["Weld Zone", "Hyderabad", "Automatic CNC Drilling Machine, 10 mm", "₹50,00,000"],
  ["Machinery Clinic", "Ahmedabad", "Mild Steel T21 Fanuc Robodrill Alpha Machine", "₹16,00,000"],
  ["Black Smith", "Ahmedabad", "Mild Steel CNC Automatic Drilling Machine, 12 kW", "₹48,00,000"],
  ["Zillion RPM Labs", "Coimbatore", "CNC Wood Drilling Machine", "₹6,50,000"],
  ["Welding Aids", "New Delhi", "Automatic Technoweld CNC Drilling Machine, 50 mm", "₹40,00,000"],
  ["Alfa Systems Pvt. Ltd.", "Vadodara", "Automatic Stainless Steel High Speed CNC Drilling Machine, Twist Drill Capacity: 102 mm", "₹50,00,000"],
  ["Koike Cutting & Welding (India) Ptd. Ltd.", "Pune", "Automatic CNC Drilling Machine", "₹60,00,000"],
  ["S M Automation", "Pune", "Aluminium Heat Sink CNC Drilling Machine", "₹4,50,000"],
  ["J.J.Enterprises", "Chennai", "Aluminium CNC Drilling & Milling Machine", "₹5,10,000"],
  ["Nandini Machine And Tools", "Pune", "Automatic HB621JX 6 Axis CNC Drilling Machine", "₹32,50,000"],
  ["Caple Industrial Solutions", "Mumbai", "CNC 6-Sided Drilling Machine ND512TS (415V)", "₹31,00,000"],
  ["Easy Automation", "Rajkot", "High Speed Drilling Machine For Gas Burner", "₹1,85,000"],
  ["H C & Co.", "Pune", "Automatic Stainless Steel Drilling Of Spacers On CNC HBM", "₹2,50,000"],
  ["Numac Hitech", "Mumbai", "CNC Wood Drilling Machine, 20 mm", "₹3,00,000"],
  ["Dellatecnica", "Ludhiana", "CNC Drilling Machine (Six Sides)", "₹24,00,000"],
  ["Newton Technologies", "Bengaluru", "5 Axis CNC Drilling Machine", "₹35,50,000"],
  ["Ador Welding Limited", "Pune", "Ador King Drill 1500 CNC Plate Drilling Machine", "₹52,45,000"],
  ["J.P. Industries", "Rajkot", "Automatic M120x1600 Double Column CNC Drill Machine, 50 mm", "₹95,00,000"],
];

const EDM: Listing[] = [
  ["Berlin Machineries Private Limited", "Pune", "H35CNC Bed Movement Mirror Spark EDM Machine", "₹29,13,473"],
  ["R S Electroalloys Private Limited", "New Delhi", "CNC EDM Machines", "₹5,50,000"],
  ["Jig Engineering", "Mumbai", "EDM Machines, Model: Axis Corrector", "₹20,000"],
  ["Plassteze", "New Delhi", "CNC EDM Machines", "₹10,00,000"],
  ["Sparkonix India Private Limited", "Pimpri Chinchwad", "Speed III CNC EDM Machine, Automation Grade: Automatic", "₹6,50,000"],
  ["R.S.Machinery", "New Delhi", "CNC EDM Drill CNC450, Automation Grade: Manual", "₹7,50,000"],
  ["Shree Yantra Solutions", "Bengaluru", "CNC EDM Machines, Wire Cut", "₹8,50,000"],
  ["Ratnaparkhi Electronic Industries Pvt. Ltd.", "Nashik", "5530 CNC EDM Machine, Automation Grade: Automatic", "₹18,50,000"],
  ["J.K.Machines", "New Delhi", "CNC EDM Fixed Table Moving Head (Double Head), Die Sinking", "₹45,00,000"],
  ["Vinpak Machines Private Limited", "Pune", "Vinpak Ricco Double Head EDM, Die Sinking", "₹45,00,000"],
  ["Sanki Machine Tools (India) Private Limited", "Mumbai", "Chmer Double Head CNC EDM Machine (CM3076C), 3100x1000 mm", "₹5,00,000"],
  ["Advanced Micro Services Private Limited", "Bengaluru", "CNC Electrical Discharge Machine", "₹25,000"],
  ["Associated Technocrats Private Limited", "Noida", "CNC EDM Machines", "₹1,00,000"],
  ["Unique Machineries", "Pune", "Unique CNC EDM Machines", "₹6,85,400"],
  ["DSM EDM Engineering Products", "Rajkot", "CNC EDM Precision Double Heads Cow Head EDM Machine AM130R, Die Sinking", "₹1,00,00,000"],
  ["Naksh Engineers", "Ahmedabad", "CNC EDM Machines", "₹5,50,000"],
  ["MS Powerdrive Pvt. Ltd.", "Coimbatore", "CNC EDM Machine, Automation Grade: Automatic", "₹24,00,000"],
  ["EDM & Machineries Co.", "Surat", "430 BMG CNC Wire Cut EDM Machine, Automation Grade: Automatic, 1800 Kg", "₹21,55,962"],
  ["Gmax Engineering Services", "Chennai", "CNC EDM Machines", "₹6,00,000"],
  ["Om Sai Machine Tools", "New Delhi", "High Precision CNC EDM (AD Model), Automation Grade: Automatic", "₹20,00,000"],
  ["Bharath Accura Private Limited", "Bengaluru", "CNC EDM Machines, Die Sinking", "₹7,00,000"],
  ["Sekhem Machine Tools Private Limited", "Pune", "Mitsubishi E8A8 Sinkar EDM CNC Machine, Die Sinking", "₹24,30,000"],
  ["Anusuya Enterprises", "Chennai", "Electric Discharge Die Sinker Machine", "₹1,00,000"],
  ["Jai Jawan Auto Components", "Meerut", "CNC EDM 5535 Electronica", "₹2,00,000"],
  ["RPM Machines India", "Mumbai", "Semi-Automatic Alfred Herbert 7B EDM Machine", "₹1,35,000"],
  ["Global Machine & Co.", "New Delhi", "CNC EDM Machine, Automation Grade: Automatic, Model: HPSB45S", "₹1,50,000"],
  ["Microtech Services And Solutions", "Bengaluru", "CNC Electrical Discharge Machine, Wire Cut", "₹2,500"],
  ["Real Enterprises", "Mumbai", "Form 20 Charmilles CNC EDM Machine, Automation Grade: Automatic", "₹8,00,000"],
];

const WIRE_EDM: Listing[] = [
  ["Thakur Ji Machine And Tools", "Vasai Virar", "CNC Wire Cut EDM Machine, Automation Grade: Automatic, 100kg", "₹5,00,000"],
  ["Berlin Machineries Private Limited", "Pune", "CNC EDM SF 600 Series Machine for Blanking and Piercing Dies", "₹30,30,866"],
  ["R S Electroalloys Private Limited", "New Delhi", "EDM Wire Cut Machine, Automation Grade: Semi-Automatic", "₹5,50,000"],
  ["Raise Machine Tools Private Limited", "Pune", "High Precision Wire Cut Machines", "₹7,40,000"],
  ["Jig Engineering", "Mumbai", "Submerged Used Charmilles CUT20P Wire Cut Machine, Automation Grade: Automatic, 2500kg", "₹32,00,000"],
  ["M M D Dmaic Profile Solutions Private Limited", "Faridabad", "440V AC Wire Cutting Machine EDM, Automation Grade: Automatic", "₹7,50,000"],
  ["J.K.Machines", "New Delhi", "Automatic CNC Wire Cut EDM Machine", "₹14,50,000"],
  ["Rhoneum Enterprise", "Vasai Virar", "Used EDM WireCut Machine", "₹20,00,000"],
  ["VSL Tech", "Ludhiana", "CNC Wire Cut EDM Machine, Max Work Piece Weight 300 Kg", "₹12,80,000"],
  ["R.S.Machinery", "New Delhi", "CNC Wire Cut Machine 7735", "₹6,25,000"],
  ["S & T Engineers Private Limited", "Coimbatore", "NP400L CNC Wire EDM Submerge Type", "₹86,00,000"],
  ["Shree Yantra Solutions", "Bengaluru", "Multi Cutting Wire Cut EDM Machine", "₹6,50,000"],
  ["India International Marketing Co.", "New Delhi", "CNC Wire Cut EDM", "₹6,50,000"],
  ["Ratnaparkhi Electronic Industries Pvt. Ltd.", "Nashik", "H NXG CNC Wire Cut EDM Machine", "₹12,50,000"],
  ["Faridabad Control Electricals Pvt. Ltd.", "Faridabad", "CNC EDM Wire Cut Machine", "₹6,35,000"],
  ["Ganesh Grinding Mills Private Limited", "Mumbai", "320x250 mm CNC Wire Cut EDM Machine", "₹4,65,000"],
  ["Camarc Toolings", "Chennai", "Used CNC Wirecut EDM Machine", "₹8,00,000"],
  ["Sichuan YNJ Industries Private Limited", "Anand", "CNC Wire Cut EDM Machine, Wire Diameter: 0.1-0.20mm, Model: MC500K", "₹15,90,909"],
  ["Kenford (A unit of Indian Air Compressors)", "Gurugram", "CNC High Speed Wire Cut EDM Machine", "₹5,90,000"],
  ["Sanki Machine Tools (India) Private Limited", "Mumbai", "CNC Wire EDM Machine (AW6S)", "₹9,00,000"],
  ["Newturn Press Tools", "Ahmedabad", "EDM CNC Wire Cut Machine", "₹80,000"],
  ["Das Instruments And Solutions", "Chennai", "CNC EDM Wire Cutting Machine", "₹1,00,300"],
  ["Mec Tech Machines & Tools", "New Delhi", "Fully Automatic CNC EDM Wire Cut Machine, Wire Diameter: 0.18, Model: KD500 ZL-A", "₹21,50,000"],
  ["Varenyam Machine Tools Pvt. Ltd.", "New Delhi", "Charmill Machine Die Block Suitable for Agie Charmilles", "₹5,550"],
  ["Excon Engineering", "Bengaluru", "CNC Reusable Wire Cut EDM", "₹10,00,000"],
  ["Emtex Machinery Private Limited", "New Delhi", "Reusable CNC Wire Cut EDM Machine (DK7745)", "₹6,95,000"],
  ["S. N. Enterprises", "New Delhi", "DK7745 CNC Wire Cut WEDM Machines", "₹6,20,000"],
  ["Global Engineering Equipments", "Coimbatore", "CNC Wire Cut EDM Machine", "₹8,00,000"],
];

const LASER: Listing[] = [
  ["Jayshree Machinetools Private Limited", "Rajkot", "CNC Laser Cutting Machine, Fiber Laser, 3 kW, 1500x3000 mm", "₹21,00,000"],
  ["Techno Laser", "Ahmedabad", "CNC Laser Cutting Machine, Fiber Laser, 3 kW, 3000x1500 mm", "₹19,50,000"],
  ["Suresh Indu Laser Pvt Ltd", "Pune", "6kW 6525 Pro Series CNC Laser Cutting Machine, 6 kW, 6500x2500 mm", "₹72,00,000"],
  ["A Innovative International Ltd.", "Bavla", "CNC Laser Cutting Machine, 10 mm thickness", "₹40,00,000"],
  ["Divine Laser Technologies", "Ahmedabad", "CNC Fiber Laser Cutting Machine, 3000 W, 3000x1500 mm", "₹35,00,000"],
  ["M.S. Enterprises", "Faridabad", "CNC Laser Cutting Machine, Fiber Laser, 1 kW, 900x600 mm", "₹30,00,000"],
  ["Mtech Laser India Private Limited", "Ahmedabad", "CNC Laser Cutting Machine, 1500W, 3000x1500 mm", "₹21,11,111"],
  ["Success Technologies", "Ahmedabad", "CNC Laser Cutting Machine, CO2 Laser, 80W, 900x600 mm", "₹2,50,000"],
  ["A & P Automation Systems", "Vadodara", "CNC Laser Cutting Machine, CO2 Laser, 6 kW, 900x600 mm", "₹50,00,000"],
  ["Prompt Lasers", "Pune", "400W CNC Laser Cutting Machine, CO2 Laser, 400W, 2000x4000 mm", "₹25,00,000"],
  ["Agile Machineries Private Limited", "Kalol", "Dual Pallet CNC Laser Cutting Machine, 6 kW", "₹26,00,000"],
  ["Supercut Welding Industries", "Faridabad", "CNC Sheet Metal Cutting Machine, 5 mm thickness, 1500x3000 mm", "₹9,00,000"],
  ["Laser Technologies Private Limited", "Navi Mumbai", "CNC Laser Cutting Machine, Fiber Laser, 1.5 kW, 1500x3000 mm", "₹24,00,000"],
  ["Besttechno Dynamics Private Limited", "Vadodara", "Round SHS CNC Laser Cutting Machine, 3 kW, 6 m length, 200 mm diameter", "₹24,00,000"],
  ["Ritik Engineers", "Pune", "CNC Laser Cutting Machine, Fiber Laser, 1.5 kW, 1500x3000 mm", "₹15,00,000"],
  ["Avi Enterprises", "Faridabad", "CNC Laser Cutting Machine, Fiber Laser, 1.5 kW, 1500x3000 mm", "₹15,50,000"],
  ["Suresh Indu Lasers Private Limited", "Pune", "3000W Pro 3015 CNC Laser Cutting Machine, 3 kW, 3000x1500 mm", "₹36,00,000"],
  ["Divine Techno Engineers", "Vadodara", "1.5 kW CNC Laser Cutting Machine, Fiber, 3000x1500 mm", "₹21,85,000"],
  ["Chirag International", "New Delhi", "Brass Laser Cutting Machine, Fiber Laser, 1.5 kW, 3000x1500 mm", "₹18,00,000"],
  ["D. H. Enterprises", "Ghaziabad", "CNC Laser Cutting Machine, Fiber Laser, 3000x1500 mm", "₹29,88,800"],
  ["Solar CNC Automation", "Vadodara", "CNC Laser Cutting Machine, Fiber Laser, 1.5 kW, 1500x3000 mm", "₹18,50,000"],
  ["Hunkjet Laser", "Pune", "CNC Laser Cutting Machine, Fiber Laser, 1.5 kW, 1500x3000 mm", "₹22,00,000"],
  ["A.M. Laser Technologies", "Mumbai", "CNC Laser Cutting Machine, 1300x1000 mm, CO2 Laser", "₹3,60,000"],
  ["Universal Coating Solutions", "Ghaziabad", "Laser Cutting Machine, Fiber Laser, 1 kW, 2000x6000 mm", "₹32,00,000"],
  ["Rishabh Technosolutions", "New Delhi", "CNC Laser Cutting Machine, 220V 50Hz", "₹2,85,000"],
  ["Deswam Engineering Solutions", "Pune", "1 kW CNC Laser Cutting Machine, Fiber Laser, 900x600 mm", "₹25,00,000"],
  ["Axis India", "Vadodara", "6 kW CNC Metal Laser Cutting Machine, Fiber Laser, 1500x3000 mm", "₹30,00,000"],
  ["Krystal Energy", "Ahmedabad", "CNC Laser Cutting Machine, Fiber Laser, 1.5 kW, 1500x3000 mm", "₹24,00,000"],
];

const PLASMA: Listing[] = [
  ["Vigor Sales Corporation", "New Delhi", "15 HP Mild Steel CNC Gantry Type With Servo Motor 1.5x6.3, 220V, Automation Grade: Fully-automatic", "₹18,00,000"],
  ["Cruxweld Industrial Equipments Private Limited", "Faridabad", "160A Portable CNC Cutting Machine, Table size: 1500x3000 mm", "₹2,18,000"],
  ["Pro-Arc Welding And Cutting Systems Private Limited", "Pune", "CNC Plasma Cutting Machine", "₹18,00,000"],
  ["Mechtek Industries Private Limited", "Ahmedabad", "MTPC 1325 CNC Plasma Cutting Machine, Table size: 1300x2500 mm", "₹14,00,001"],
  ["A & P Automation Systems", "Vadodara", "25W Mild Steel Automatic CNC Plasma Cutting Machine, 240V, Automation Grade: Semi-automatic", "₹7,00,000"],
  ["Jekson Machinery", "Ahmedabad", "Mild Steel CNC Plasma Cutting, Automation Grade: Semi-automatic", "₹16,00,000"],
  ["Jayendra Sales Corporation", "Ahmedabad", "CNC Plasma Cutting Machine", "₹15,00,000"],
  ["Excel Metal & Engg Industries", "Mumbai", "Automatic CNC Plasma Cutting Machine, 440V, Automation Grade: Fully-automatic", "₹25,00,000"],
  ["Axisco Corporation", "Gandhinagar", "CNC Plasma Cutting Machine, 380V", "₹6,00,000"],
  ["Labh Projects Private Limited", "Ahmedabad", "CNC Plasma Cutting Machine", "₹5,00,000"],
  ["D. H. Enterprises", "Ghaziabad", "200A 20mm CNC Plasma Cutting Machine, Table size: 3000x12000 mm", "₹14,88,800"],
  ["Adinath Equipments Private Limited", "Ahmedabad", "CNC Plasma Flame Cutting Machine, Flame cutting thickness 5-200mm", "₹15,00,000"],
  ["Supercut Welding Industries", "Faridabad", "GYS CNC Plasma Cutting Machine, Automation Grade: Fully Automatic", "₹2,80,000"],
  ["Ritik Engineers", "Pune", "Single Phase Mild Steel Heavy Duty CNC Plasma Cutting Machine, Automation Grade: Fully-automatic", "₹4,50,000"],
  ["Weld Zone", "Hyderabad", "Mild Steel 5mm CNC Plasma Gas Cutting Machine, Automation Grade: Fully-automatic, 220v", "₹15,00,000"],
  ["Besttechno Dynamics Private Limited", "Vadodara", "CNC 1015 Plasma Cutting Machine", "₹8,00,000"],
  ["Messer Cutting Systems India Private Limited", "Coimbatore", "AirBlade CNC Plasma Cutting Machine", "₹16,00,000"],
  ["Avi Enterprises", "Faridabad", "400A CNC Plasma Cutting Machines, 16 mm, Table size: 2000x4000 mm", "₹12,00,000"],
  ["Solar CNC Automation", "Vadodara", "100A CNC Pipe Profile Plasma Cutting Machine, Table size: 2500x6000 mm", "₹23,00,000"],
  ["Atlas Machines (India)", "Mumbai", "CNC Plasma Cutting Machine", "₹7,50,000"],
  ["ARC Welding Company", "New Delhi", "Mild Steel CNC Profile Cutting Machine, Plasma, Automation Grade: Fully-automatic", "₹26,00,000"],
  ["Black Smith", "Ahmedabad", "Black Smith Mild Steel CNC Plasma Cutting Machine", "₹8,70,000"],
  ["Intimate Machine Tools", "Rajkot", "CNC Plasma Cutting Machines, 420V AC", "₹5,56,000"],
  ["Delta Engineering Works", "Pune", "12-15 kW Mild Steel CNC Plate Cutting Machine, Automatic, 415V", "₹11,00,000"],
  ["Sh Electronic Co.", "Pimpri Chinchwad", "10A Mild Steel CNC Plasma Cutting Machine LG3065G, 220-230V, Automation Grade: Semi-automatic", "₹9,50,000"],
  ["Advanzo Equipments Private Limited", "New Delhi", "63A CNC Plasma Cutting Machine, 25 mm, Table size: 1500x3000 mm", "₹14,95,000"],
  ["Fohmics Industrial Machinery", "Mumbai", "200A Mild Steel Gantry Type CNC Plasma Cutting Machine, 440V, Automation Grade: Fully-automatic", "₹9,25,000"],
  ["Bhagwati Engineers", "Rajkot", "63A CNC Plasma Cutting Machine, Table size: 1500x3000 mm, 16 mm", "₹15,00,000"],
];

const WATERJET: Listing[] = [
  ["A Innovative International Ltd.", "Bavla", "MS CNC Water Jet Machine", "₹30,00,000"],
  ["Techno Laser", "Ahmedabad", "Water Jet Cutting Machines", "₹55,51,000"],
  ["Cad Mech Engineering Private Limited", "Pune", "Small CNC Waterjet Cutting Machine", "₹15,25,000"],
  ["Jekson Machinery", "Ahmedabad", "CNC Waterjet Cutting Machine", "₹35,00,000"],
  ["Labh Projects Private Limited", "Ahmedabad", "CNC Waterjet Cutting Machine", "₹5,00,000"],
  ["S.K.Glass Machines (India) Pvt. Ltd", "Ghaziabad", "CNC Waterjet Profile Cutting Machine", "₹1,00,000"],
  ["Stonetek India", "Ahmedabad", "Bridge CNC Water Jet Cutting Machine", "₹47,65,000"],
  ["Meba India Private Limited", "Faridabad", "MEBA Resato High Pressure Water Jet Cutting Machine", "₹25,00,000"],
  ["Agnicut Machine Tool", "Chennai", "CNC Water Jet Cutting Machine", "₹30,00,000"],
  ["Phoenix CNC", "Gondal", "Bevel CNC Waterjet Cutting Machine", "₹55,00,000"],
  ["Vaam Engineering", "Surat", "CNC Waterjet Cutting System", "₹30,00,000"],
  ["J.R. Rao & Co.", "Bengaluru", "CNC Water Jet Cutting Machine", "₹75,00,000"],
  ["Pathak Machines Industries", "Cuttack", "CNC Water Jet Cutting Machine", "₹58,00,000"],
  ["Pathak Machine Tools Pvt. Ltd.", "Howrah", "CNC Waterjet Cutting Machine", "₹80,00,000"],
  ["Sumaya World Technology", "Jaipur", "CNC Water Jet Cutting Machine", "₹42,00,000"],
  ["Dgcut Mechatronic Automation Private Limited", "New Delhi", "Automatic Mild Steel CNC Water Jet Cutting Machine", "₹30,00,000"],
  ["Arnavi Machines Private Limited", "Bengaluru", "Kimla Stainless Steel Waterjet CNC Cutting Machine", "₹70,00,000"],
  ["Robotech Automation Private Limited", "Ghaziabad", "Waterjet CNC Cutting Machine", "₹50,00,000"],
  ["Astra Engineers", "Coimbatore", "Flow CNC Water Jet Cutting Machine", "₹1,30,00,000"],
  ["Pathak Industries LlP", "Kolkata", "CNC Waterjet Machine", "₹58,00,000"],
  ["Ram Engineering", "Bengaluru", "5 Axis CNC Water Jet Cutting Machine", "₹75,00,000"],
  ["Kraft Mech Engineering Services", "Chennai", "KMES CNC Water Jet Cutting Machine", "₹55,00,000"],
  ["Hydrautech industries", "Ahmedabad", "CNC Water Jet Cutting Machine", "₹5,00,000"],
  ["M D Corporation", "New Delhi", "OMAX-60120 5-Axis Water Jet Cutting Machine", null],
  ["Biesse India Private Limited", "Bengaluru", "Biesse Master Cut Up J O Stone Water Jet Cutting Machine", null],
  ["Waterjet Systems International Pvt. Ltd.", "Ghaziabad", "WSI USA Waterjet Cutting Machine", null],
];

const PRESS_BRAKES: Listing[] = [
  ["Marathon Engineering", "Ahmedabad", "Automatic 80 Ton CNC Hydraulic Press Brake Machine, Bending length: 2500 mm", "₹18,50,000"],
  ["Jayshree Machinetools Private Limited", "Rajkot", "Automatic Tandem Press Brake, Bending length: 14 m", "₹80,21,000"],
  ["Energy Mission Machineries (India) Limited", "Sanand", "Fully-automatic CNC Press Bending Machine", "₹18,25,000"],
  ["Sunshine Hydraulics India Private Limited", "Ahmedabad", "CNC Press Brake, Capacity: 100 Ton, Bed size: 1000mm to 6000mm", "₹17,65,000"],
  ["Bhavya Machine Tools LLP", "Ahmedabad", "Automatic NC Press Brake Machine", "₹15,54,000"],
  ["Parmar CNC Machines India LLP", "Gondal", "Fully Automatic Parmar Brand CNC Press Brake Machine, Bending length: 3200 mm, Bending capacity: 125 ton", "₹30,07,000"],
  ["Weldor Appliances Pvt. Ltd.", "Rajkot", "CNC Press Brakes, Bending capacity: 400 ton", "₹15,00,000"],
  ["KB Industries", "Ahmedabad", "Semi Automatic Hydraulic Press Brake Machine", "₹12,00,000"],
  ["Monotech Engineers Private Limited", "Ghaziabad", "CNC Synchro Hydraulic Press Brake, Capacity: 100 Ton, Automation Grade: Semi-Automatic", "₹19,00,000"],
  ["Techno Laser", "Ahmedabad", "Fully Automatic CNC Press Brake Machine, Bending capacity: 160 ton, Bending length: 3200 mm", "₹18,25,000"],
  ["Technex Machines (India) LLP", "Rajkot", "3 Axis To 9 Axis Automatic CNC Press Brakes", "₹16,00,000"],
  ["Jayshree Machines Private Limited", "Rajkot", "Automatic CNC Synchro Press Brake Machine, Bending length: 6000 mm, Bending capacity: 400 ton", "₹12,00,000"],
  ["Rudraksh Engineering", "Rajkot", "ANOX Mild Steel Automatic CNC Press Brake Machine, Automation Grade: Semi-Automatic", "₹8,49,999"],
  ["Mtech Laser India Private Limited", "Ahmedabad", "4+1 Axis CNC Press Brake, Capacity: 150 Ton, Automation Grade: Automatic", "₹29,50,000"],
  ["Vivek Machine Tools", "Rajkot", "CNC Press Brake Machine, Capacity: Up To 255 Ton, Automation Grade: Automatic", "₹5,00,000"],
  ["Jekson Machinery", "Ahmedabad", "CNC Press Brake", "₹15,00,000"],
  ["Sharda Engineers", "Faridabad", "Hydraulic Press Brake Bending Machine, 30T-3000T CNC/NC Press Brake", "₹20,00,000"],
  ["Siddhapura Machine Tools", "Rajkot", "400 Ton CNC Press Brake Machine, Automation Grade: Automatic", "₹47,16,000"],
  ["Purvaj Engineers", "Vadodara", "CNC Synchronize Hydraulic Press Brake", "₹24,50,000"],
  ["Haco Machinery Private Limited", "Bawal", "Automatic 175 Ton CNC Press Brakes, Bending length: 3100 mm", "₹39,50,000"],
  ["Rajesh Global Machines Pvt. Ltd.", "Rajkot", "Automatic CNC Break Press Machine", "₹25,00,000"],
  ["Premier Machine Tools", "Coimbatore", "63 Ton CNC Press Brakes, Bending length: 1500 mm", "₹22,00,000"],
  ["Energy Mission Machineries (India) Limited", "Sanand", "CNC Hydraulic Press Brake Bending Machine, Bending capacity: 160 ton, Bending length: 3000 mm", "₹30,50,000"],
  ["Laser Technologies Private Limited", "Navi Mumbai", "Automatic 160T/3200 CNC Press Brake Machine, Bending capacity: 160 ton, Bending length: 3200 mm", "₹31,43,000"],
  ["Vee M Automation Technology", "Faridabad", "CNC Press Brakes, Capacity: 100 Ton, Automation Grade: Automatic", "₹18,00,000"],
  ["I & J Machinery", "Ahmedabad", "CNC Press Brake Machine", "₹25,00,000"],
  ["Nandi Machinery", "Ahmedabad", "CNC Press Brake, Capacity: upto 10 Ton, Automation Grade: Automatic", "₹14,00,000"],
  ["Jayshree Engineering Co.", "Rajkot", "CNC Hydraulic Press Brake, Bending capacity: 80 ton, Bending length: 2500 mm", "₹16,50,000"],
];

const GEAR_HOBBING: Listing[] = [
  ["Labh Projects Private Limited", "Ahmedabad", "Gear Hobbing Machine - CNC", "₹1,50,000"],
  ["Machinery Clinic", "Ahmedabad", "6 Axis CNC High Speed Gear Hobbing Machines", "₹60,00,000"],
  ["Prime Technologies", "Mumbai", "CNC Gear Hobbing Machine Y3140CNC6, 12 Module", "₹9,99,999"],
  ["A. R. International", "New Delhi", "Gleason Phoenix 125 GH CNC Gear Hobbing Machine, Automation Grade: Automatic", "₹1,100"],
  ["Circle Machinery (India)", "Ghaziabad", "Used Kashifuji KN150 CNC Gear Hobbing Machine", "₹9,99,999"],
  ["Vertex Gear Machinery", "Muradnagar", "Used CNC Gear Hobbing Machine Liebherr LC152", "₹2,00,000"],
  ["Laxmi Metal & Machines", "Rohtak", "Used CNC Gear Hobbing Machine Pfauter PE150", "₹3,50,000"],
  ["Nanak Enterprises", "New Delhi", "Automatic CNC Gear Hobbing PE300", "₹1,50,000"],
  ["Kunark Hitech Machining & Sales Private Limited", "Vasai", "WMW Modul ZFWZ 03 CNC Gear Hobbing Machine", "₹1,00,000"],
  ["Mtat Technologies Private Limited", "Ludhiana", "CNC Vertical Gear Hobbing Machine", "₹1,00,00,000"],
  ["Universal Gears", "Thane", "630 mm CNC Gear Hobbing Machine, 4 Module", "₹50,000"],
  ["Kalyan PLC Automation", "Muradnagar", "Cast Iron CNC Gear Hobbing Machine", "₹32,00,000"],
  ["Ucam Private Limited", "Bengaluru", "CNC Gear Hobbing Machine-Vajra 250, 6 Module", null],
  ["Tritools Machinery Private Limited", "Navi Mumbai", "150 mm CNC Gear Hobbing Machine, 4 Module", null],
  ["Jaldhara Small Tools Private Limited", "Ludhiana", "Mild Steel CNC Gear Hobbing Machine", null],
  ["Himshiv Machines Private Limited", "New Delhi", "250 mm CNC Gear Hobbing Machine", null],
  ["Shiva Shakthi Enterprises", "Bengaluru", "Cast Iron Cooper CNC Gear Hobbing Machine", null],
  ["D. P. Enterprises", "New Delhi", "Used CNC Gear Hobbing Gleason 775", null],
  ["Jay Somnath Engineering Works", "Ahmedabad", "630 mm 2 Axis PLC Gear Hobbing Machine", null],
  ["Ashwin Engineering Works", "Ahmedabad", "Gear Hobbing CNC Machine", null],
  ["Milind Jagannath Ambardekar", "Dombivli", "Amey Engineer Cast Iron CNC Gear Hobbing Machine", null],
  ["Saibaba Machine Tools India Pvt. Ltd.", "Navi Mumbai", "Mikron 102.04 CNC Gear Hobbing", null],
  ["Europa Machine & Tools", "Ghaziabad", "Liebherr LC80 CNC Hobbing Machine", "₹50,000"],
  ["Apex Transmission Pvt. Ltd.", "Sonipat", "CNC Gear Hobbing Machine", null],
  ["Four Star Industries", "Thane", "CNC Gear Hobbing", null],
  ["Archi Enterprises", "Ghaziabad", "CNC Hobbing Machines Fanuc System, 10 Module", "₹2,00,000"],
  ["Sree Krishna Engineering", "Coimbatore", "500 mm CNC Gear Hobbing Machine, 10 Module", "₹10,00,000"],
  ["Swaroop Industries", "Hubballi", "CNC Gear Hobbing Machine", "₹1,50,000"],
];

const WOOD_CUTTING: Listing[] = [
  ["H.P.Singh & Co.", "Kolkata", "CNC Wood Cutting Machine", "₹3,65,000"],
  ["Success Technologies", "Ahmedabad", "CNC Wood Cutting Machine", "₹5,25,000"],
  ["Aaradhana Machineries Private Limited", "Kanaipur", "CNC Wood Cutting Machine, 1500x3000mm XY Axis, 300mm Z Axis, 4.5 kW Spindle", "₹5,50,000"],
  ["Incos Wood Tech", "Kurukshetra", "CNC Wood Cutting Machine", "₹1,00,000"],
  ["Mechtek Industries Private Limited", "Ahmedabad", "CNC Wood Cutting Machine, 3 Axis", "₹7,50,001"],
  ["Jai Industries", "Ahmedabad", "CNC Wood Cutting Machine with Stepper Motor, 3 Axis", "₹5,20,000"],
  ["Suresh Indu Laser Pvt Ltd", "Pune", "5.5kW CNC Wood Cutting Machine", "₹5,50,000"],
  ["Mtech Laser India Private Limited", "Ahmedabad", "MT1325 CNC Router Machine, 3.5 kW", "₹4,50,000"],
  ["Prompt Lasers", "Pune", "2.2 kW CNC Wood Cutting Machine", "₹8,00,000"],
  ["R.K. Corporation", "Greater Noida", "CNC Wood Cutting Machine", "₹6,25,000"],
  ["Hunkjet Laser", "Pune", "Wood Cutting Machine, CNC Router", "₹4,50,000"],
  ["Ritik Engineers", "Pune", "CNC Wood Cutting Machine", "₹5,00,000"],
  ["Suresh Indu Lasers Private Limited", "Pune", "CNC Wood Cutting Machine", "₹4,80,000"],
  ["Mehta Hitech Industries Limited", "Ahmedabad", "FX1325-2Z Wood Cutting Machine, 6 kW", "₹9,50,000"],
  ["Solar CNC Automation", "Vadodara", "CNC Pattern Router Machine, 7.5 kW", "₹24,50,000"],
  ["Jak Machinery", "Surat", "CNC Wood Cutting Machine (MTC), 3 Axis", "₹5,50,000"],
  ["Zillion RPM Labs", "Coimbatore", "Szolid 3kW CNC Wood Cutting Machine, Model: 1325", "₹4,75,000"],
  ["Black Smith", "Ahmedabad", "K1530 CNC Router Wood Cutting Machine, 6 kW", "₹6,50,000"],
  ["Advanzo Equipments Private Limited", "New Delhi", "CNC Wood Cutting Machine", "₹5,50,000"],
  ["Kameshwara Technologies", "Karimnagar", "Double Head Wood Grill Cutting CNC Machine", "₹6,80,000"],
  ["MK Technologies", "Bengaluru", "CNC Wood Cutting Machine, 3 Axis", "₹4,20,000"],
  ["Trilok Lasers", "Pune", "Wood Cutting CNC Router & Engraving Machine, 3 Axis", "₹3,96,000"],
  ["Quicksoftpro", "Thane", "CNC Wood Cutting Machine", "₹4,83,870"],
  ["A & G Technologies", "Kurali", "Automatic CNC Wood Cutting Machine", "₹4,65,000"],
  ["YKS Engineerings", "New Delhi", "3 Axis CNC Router Wood Cutting Machine, 1300x2500 mm, 4.5 kW", "₹3,80,000"],
  ["K Tech CNC", "Karimnagar", "CNC Router Wood Carving Machine", "₹4,60,000"],
  ["Aaradhana Machineries Private Limited", "Bengaluru", "Aaradhana Mild Steel ATC CNC Wood Cutting Machine", "₹12,50,000"],
  ["Marksys Integrators", "Aurangabad", "CNC Router Wood Carving Machine 4X8", "₹3,89,999"],
];

const STONE_ROUTER: Listing[] = [
  ["Aaradhana Machineries Private Limited", "Kanaipur", "Stone CNC Router Machine", "₹8,50,000"],
  ["Shusa Mechatronics", "Ahmedabad", "SM2536S2 4 Axis CNC Router Machine, 10 kW", "₹18,90,000"],
  ["Mechtek Industries Private Limited", "Ahmedabad", "MTS1530-4 CNC Routers, 5.5 kW", "₹13,00,000"],
  ["Incos Wood Tech", "Kurukshetra", "Stone CNC Router Machine, 3 Axis", "₹4,45,000"],
  ["Suresh Indu Laser Pvt Ltd", "Pune", "5.5kW Stone CNC Router Machine", "₹6,50,000"],
  ["Mtech Laser India Private Limited", "Ahmedabad", "MT-1325 CNC Stone Engraving Machine", "₹6,25,000"],
  ["Daksh Enterprises", "New Delhi", "1325 Stone CNC Router", "₹6,05,000"],
  ["Success Technologies", "Ahmedabad", "2D/3D CNC Stone Engraving Machine, 3 Axis", "₹7,50,000"],
  ["Labh Projects Private Limited", "Ahmedabad", "Stone CNC Router Machine", "₹7,00,000"],
  ["Mehta Hitech Industries Limited", "Ahmedabad", "Stone CNC Router Machine", "₹7,50,000"],
  ["R.K. Corporation", "Greater Noida", "Stone CNC Router Machine", "₹8,50,000"],
  ["Ritik Engineers", "Pune", "CNC Stone Router Cutting & Engraving Machine, 3 Axis", "₹7,50,000"],
  ["Wanneng Trading Company", "Ghaziabad", "Wanneng WTC Stone Router, Max Job Size: 1300x2500 mm", "₹5,50,000"],
  ["Solar CNC Automation", "Vadodara", "Double Head Stone CNC Router", "₹9,75,000"],
  ["Hunkjet Laser", "Pune", "CNC Stone Router Cutting & Engraving Machine", "₹6,00,000"],
  ["Jai Technologies", "Vijayawada", "4.5 kW Stone CNC Router Machine", "₹4,50,000"],
  ["Black Smith", "Ahmedabad", "KS-1530 3 Axis CNC Stone Router Machine, 5 kW", "₹9,50,000"],
  ["VSL Technology", "New Delhi", "1325 Stone CNC Router", "₹6,78,900"],
  ["Hindcam Private Limited", "New Delhi", "Mild Steel Stone CNC Router Machine, 6 kW, 380V", "₹8,00,000"],
  ["Advanzo Equipments Private Limited", "New Delhi", "Stone CNC Router Machine", "₹4,95,000"],
  ["Sanseiko Laser Enterprises Private Limited", "Saharanpur", "Stone CNC Router", "₹6,10,000"],
  ["Kedar Mechatronics", "Ahmedabad", "Double Head Stone CNC Router Machine, 3 Axis", "₹11,50,000"],
  ["Sidharth Machineries", "Jaipur", "Stone CNC Router With Rotary", "₹11,00,000"],
  ["K Tech CNC", "Karimnagar", "K-1325 CNC Stone Router Cutting & Engraving Machine, 6 kW", "₹5,45,000"],
  ["Aaradhana Machineries Private Limited", "Bengaluru", "Stone Cutting CNC Router, 3 Axis", "₹5,90,000"],
  ["Sainath Industries", "Ahmedabad", "Wood Craft CNC Router Stone-Stepper, Model SI-1325, 230V", "₹5,80,000"],
  ["Trilok Lasers", "Pune", "CNC Pattern Making Router Machine, 3 Axis", "₹6,66,000"],
  ["Kameshwara Technologies", "Karimnagar", "CNC Stone/Marble Engraving & Router Machine, 6 kW", "₹5,45,000"],
];

const GENERAL: Listing[] = [
  ["Monotech Engineers Private Limited", "Ghaziabad", "High Quality CNC Press Brake Machine", "₹19,00,000"],
  ["Lipi Marketing Private Limited", "Chennai", "Maxicut CNC Machine", "₹3,00,000"],
  ["Jai Industries", "Ahmedabad", "Nesting CNC Router Machine", "₹20,98,000"],
  ["Mtech Laser India Private Limited", "Ahmedabad", "CNC Router Machine", "₹2,65,000"],
  ["Success Technologies", "Ahmedabad", "3 Axis CNC Commercial Machine, Router, 4x8 ft", "₹6,75,000"],
  ["Patson Machines Private Limited", "Pune", "CNC Machine for Crank Case Operations", "₹42,00,000"],
  ["K M Trivedi Engineering Pvt. Ltd.", "Ahmedabad", "Mild Steel CNC Machine", "₹35,00,000"],
  ["Machinery Clinic", "Ahmedabad", "DTC Fuda FMT 500", "₹13,25,000"],
  ["R.K. Corporation", "Greater Noida", "3 Axis Stone Engraving Machine, 7.5 kW, Router", "₹11,50,000"],
  ["Zillion RPM Labs", "Coimbatore", "3 Axis Aluminum Structure Table Top CNC Machine", "₹2,95,000"],
  ["Jak Machinery", "Surat", "Automatic CNC Wood Router Machine, 5x10 ft, 3 Axis", "₹10,50,000"],
  ["Ritik Engineers", "Pune", "Automatic CNC Machine, Plasma Cutter", "₹9,00,000"],
  ["Pancha Technical Services", "Chennai", "Mild Steel Brother CNC Machine", "₹29,800"],
  ["Reya Technologies", "Bengaluru", "3 kW RT1630 2G Double Gantry CNC Router Machine", "₹10,25,000"],
  ["Nihar Industries", "Ahmedabad", "3 Axis CNC Engraving Machine, Router, 4x8 ft", "₹6,75,000"],
  ["Trilok Lasers", "Pune", "3 Axis CNC Machine, 4x8 ft", "₹3,96,000"],
  ["Star Engineers", "Pune", "AM-1525 CNC Pattern Making Machine", "₹4,50,000"],
  ["Circle Machinery (India)", "Ghaziabad", "Mitsubishi GB15 CNC", "₹99,999"],
  ["Paras International", "Ahmedabad", "CNC Machines", "₹3,00,000"],
  ["MK Technologies", "Bengaluru", "Automatic CNC Wood Router Machines for Woodworking", "₹3,90,000"],
  ["A & G Technologies", "Kurali", "3 Axis CNC Machine for Furniture Work, 4x8 ft, Router", "₹4,00,000"],
  ["Shri Import And Export", "Surat", "5 Axis CNC Machines, Router", "₹5,95,000"],
  ["Numac Hitech", "Mumbai", "6090 Router CNC Machine, 3 kW", "₹3,25,000"],
  ["True Colors Solutions & Technologies India Private Limited", "New Delhi", "Fully Automatic CNC Machine, 1300x2500x200 mm, 3 Axis", "₹4,50,000"],
  ["Quicksoftpro", "Thane", "3 Axis Wood Working Machines, Milling Machine, 4x8 ft", "₹4,87,870"],
  ["Raghav Technologies", "Ahmedabad", "3 Axis FRP CNC Pattern Making Machine", "₹15,85,000"],
  ["Ranoson Machines Private Limited", "Noida", "CNC Camless MCB Aircoil Winding Machine", "₹24,75,000"],
  ["Aaradhana Technology Systems", "Jaipur", "3 Axis CNC Wood Router, 4x8 ft", "₹3,80,000"],
];

const ALL_SUBCATEGORIES: { key: keyof typeof SOURCES; entries: Listing[] }[] = [
  { key: "milling", entries: MILLING },
  { key: "machiningCentre", entries: MACHINING_CENTRE },
  { key: "turning", entries: TURNING },
  { key: "lathe", entries: LATHE },
  { key: "routers", entries: ROUTERS },
  { key: "grinding", entries: GRINDING },
  { key: "drilling", entries: DRILLING },
  { key: "edm", entries: EDM },
  { key: "wireEdm", entries: WIRE_EDM },
  { key: "laser", entries: LASER },
  { key: "plasma", entries: PLASMA },
  { key: "waterjet", entries: WATERJET },
  { key: "pressBrakes", entries: PRESS_BRAKES },
  { key: "gearHobbing", entries: GEAR_HOBBING },
  { key: "woodCutting", entries: WOOD_CUTTING },
  { key: "stoneRouter", entries: STONE_ROUTER },
  { key: "general", entries: GENERAL },
];

function rawRecordsForSubcategory(key: keyof typeof SOURCES, entries: Listing[]): RawSupplierRecord[] {
  const { subcategory: baseSubcategory, url, sourceName } = SOURCES[key];

  return entries.map(([companyName, city, title, price]) => {
    const specs = parseSpecs(title);
    const sharpened = axisSharpenedSubcategory(baseSubcategory, title);
    const categories = Array.from(new Set(["CNC machines", baseSubcategory, ...(sharpened ? [sharpened] : [])]));

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
        snippet: `Listed on IndiaMART's ${baseSubcategory} category page (retrieved ${RETRIEVED_AT_NOTE}). Full listing title: "${title}".`,
      },
    } satisfies RawSupplierRecord;
  });
}

function mergeTwo(primary: Supplier, secondary: Supplier): Supplier {
  const sources = [...primary.intelligence.sources, ...secondary.intelligence.sources];
  const citiesServed = new Set([...primary.identity.citiesServed, ...secondary.identity.citiesServed]);
  if (secondary.identity.location && secondary.identity.location !== primary.identity.location) {
    citiesServed.add(secondary.identity.location);
  }

  return {
    ...primary,
    identity: {
      ...primary.identity,
      citiesServed: Array.from(citiesServed),
    },
    capabilities: {
      ...primary.capabilities,
      categories: Array.from(new Set([...primary.capabilities.categories, ...secondary.capabilities.categories])),
      products: Array.from(new Set([...primary.capabilities.products, ...secondary.capabilities.products])),
      manufacturingCapabilities: Array.from(
        new Set([...primary.capabilities.manufacturingCapabilities, ...secondary.capabilities.manufacturingCapabilities])
      ),
    },
    commercial: {
      ...primary.commercial,
      priceRange: primary.commercial.priceRange ?? secondary.commercial.priceRange,
    },
    intelligence: {
      ...primary.intelligence,
      sources,
      dataConfidence: computeDataConfidence(sources),
    },
    mergedFrom: [...primary.mergedFrom, secondary.id, ...secondary.mergedFrom],
  };
}

function mergeSameCompanyAcrossSubcategories(suppliers: Supplier[]): { merged: Supplier[]; mergeCount: number } {
  const byKey = new Map<string, Supplier[]>();
  for (const s of suppliers) {
    const key = normalizeCompanyName(s.identity.companyName);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(s);
  }

  const merged: Supplier[] = [];
  let mergeCount = 0;
  for (const group of byKey.values()) {
    let current = group[0];
    for (let i = 1; i < group.length; i++) {
      current = mergeTwo(current, group[i]);
      mergeCount++;
    }
    merged.push(current);
  }

  return { merged, mergeCount };
}

async function main() {
  // Id block reserved for this file: 3000-3999 (see lib/supplier-store.ts).
  let existingIds: number[] = [2999];
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

  console.log(`Total raw listings across ${ALL_SUBCATEGORIES.length} CNC subcategory pages: ${totalRawListings}`);
  console.log(`Normalized (pre-merge) records: ${rawNormalized.length}`);
  console.log(`Same-company merges across subcategories: ${mergeCount}`);
  console.log(`Final unique suppliers: ${suppliers.length}`);
  console.log(`findPotentialDuplicates() flagged ${candidates.length} candidate pair(s) for human review:`);
  for (const candidate of candidates) {
    console.log(
      `  - "${candidate.a.identity.companyName}" (${candidate.a.identity.location}) <-> "${candidate.b.identity.companyName}" (${candidate.b.identity.location}) [${candidate.reason}]`
    );
  }

  const byConfidence = { high: 0, medium: 0, low: 0 };
  const byState = new Map<string, number>();
  const byCity = new Map<string, number>();
  const bySubcategory = new Map<string, number>();
  let withWebsite = 0;
  let withProducts = 0;
  let withSpecs = 0;
  let withPricing = 0;
  let withMoq = 0;
  let withLeadTime = 0;
  let withCertifications = 0;

  for (const s of suppliers) {
    byConfidence[s.intelligence.dataConfidence]++;
    const state = s.identity.location.split(",").pop()?.trim() || "Unspecified";
    const city = s.identity.location.split(",")[0]?.trim() || "Unspecified";
    byState.set(state, (byState.get(state) ?? 0) + 1);
    byCity.set(city, (byCity.get(city) ?? 0) + 1);
    for (const cat of s.capabilities.categories) {
      if (cat === "CNC machines") continue;
      bySubcategory.set(cat, (bySubcategory.get(cat) ?? 0) + 1);
    }
    if (s.identity.website) withWebsite++;
    if (s.capabilities.products.length > 0) withProducts++;
    if (s.capabilities.manufacturingCapabilities.length > 0) withSpecs++;
    if (s.commercial.priceRange) withPricing++;
    if (s.commercial.moq) withMoq++;
    if (s.commercial.leadTime) withLeadTime++;
    if (s.compliance.certifications.length > 0 || s.compliance.isoCertifications.length > 0) withCertifications++;
  }

  console.log("\n--- Batch summary ---");
  console.log(`Total suppliers: ${suppliers.length}`);
  console.log(`Confidence: high=${byConfidence.high} medium=${byConfidence.medium} low=${byConfidence.low}`);
  console.log(`With website: ${withWebsite}`);
  console.log(`With product evidence: ${withProducts}`);
  console.log(`With technical specs: ${withSpecs}`);
  console.log(`With pricing data: ${withPricing}`);
  console.log(`With MOQ: ${withMoq}`);
  console.log(`With lead time: ${withLeadTime}`);
  console.log(`With certifications: ${withCertifications}`);
  console.log("State distribution:");
  for (const [state, count] of Array.from(byState.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${state}: ${count}`);
  }
  console.log("City distribution (top 20):");
  for (const [city, count] of Array.from(byCity.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${city}: ${count}`);
  }
  console.log("Subcategory distribution (a supplier can count in more than one):");
  for (const [cat, count] of Array.from(bySubcategory.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  const dataFile = path.join(process.cwd(), "data", "suppliers", "cnc-machines.json");
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ suppliers }, null, 2), "utf-8");

  console.log(`\nWrote ${suppliers.length} suppliers to ${dataFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
