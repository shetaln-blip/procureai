// Ingestion run: Electrical Equipment supplier batch (India-wide) — Batch 7
// of the master plan, sixth per-category dataset added to the existing
// multi-file supplier repository (see lib/supplier-store.ts's id-block
// scheme). Same architecture as scripts/import-chemicals-materials-batch.ts:
// normalizeSupplierRecord / computeDataConfidence / computeDedupeKey /
// findPotentialDuplicates from the existing lib/ingestion + lib/dedup
// modules — nothing new invented.
//
// SOURCES: 8 pan-India IndiaMART "impcat" category pages — switchgear,
// transformers, electrical control panels, electric motors, electrical
// cables/wires, power distribution equipment, industrial UPS/power backup
// systems, industrial automation equipment.
//
// INCLUSION RULE applied while curating the raw listings below:
//   - EXCLUDED: foreign companies not based in India.
//   - EXCLUDED: listings that are purely a reseller of ONE specific named
//     foreign brand (Siemens, Schneider, Mitsubishi, Hager, Danfoss, APC,
//     Hitachi, Eaton/MGE, ABB, Parker SSD, B&R, KK Wind Solutions, Kitz,
//     Panasonic, Woodward, Telemechanique, Polycab-as-sole-brand) via an
//     otherwise-unrelated trading company with no stated Indian
//     manufacturing/own-business evidence.
//   - EXCLUDED: spare-parts/component-only listings (a bare "spare power
//     board", a valve "motor operator", a connector cordset) rather than a
//     complete equipment product.
//   - EXCLUDED: repair/rewinding/system-integration SERVICE-only listings.
//   - EXCLUDED: consumer/residential-only items (household wiring, toy/
//     hobby motors) and educational/lab demonstration/training equipment.
//   - EXCLUDED: listings for a clearly unrelated business that surfaced by
//     keyword coincidence (a food company, a construction company, a coal
//     trader, a fragrance company, a stone-crusher — see per-subcategory
//     source-audit notes carried over from the research pass).
//   - A company name alone (e.g. "Techno Scientific Instruments", "Nakoda
//     Steel") was NOT used to exclude a listing whose title carried
//     genuine electrical-equipment evidence — same rule as every prior
//     batch.
//   - CROSS-CATEGORY CONSISTENCY CHECK: "Spot India Group"/"Spot India
//     Company" and "Econtrol Devices Private Limited" each showed up
//     reselling a DIFFERENT single named foreign brand in more than one of
//     this project's category batches (Spot India: Araldite resin-adhesive
//     in Batch 6, a multi-brand cable listing here, Hitachi UPS here;
//     Econtrol Devices: 3M adhesive in Batch 6, Eaton UPS here) — that
//     pattern is itself evidence of a generic multi-line trading reseller
//     rather than a genuine electrical-equipment business, so both are
//     excluded here even where a single listing in isolation might have
//     been kept.
//
// MANUFACTURER/DISTRIBUTOR/TRADER STATUS: left unset (-> "unknown") unless
// a literal, unambiguous business-type word appears on the listing itself
// ("Manufacturer", "Trader" — not the vaguer "Supplier"/"Service provider"/
// "Dealers"/compound tags like "manufacturer/exporter/supplier", which are
// not mapped to any single ManufacturingStatus value and are left unset
// rather than guessed at).
//
// TECHNICAL SPECS: extracted only when literally present in the title —
// voltage (V), kVA/kW/HP power rating, phase count, IP rating, RPM — via
// parseElecSpecs(). Nothing is inferred beyond the title text.
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
  switchgear: {
    subcategory: "Switchgear",
    group: "Switchgear",
    url: "https://m.indiamart.com/impcat/industrial-switchgear.html",
    sourceName: "IndiaMART — Industrial Switchgear directory",
  },
  transformers: {
    subcategory: "Transformers",
    group: "Transformers",
    url: "https://m.indiamart.com/impcat/industrial-transformers.html",
    sourceName: "IndiaMART — Industrial Transformers directory",
  },
  controlPanels: {
    subcategory: "Electrical control panels",
    group: "Control Panels",
    url: "https://m.indiamart.com/impcat/industrial-control-panel.html",
    sourceName: "IndiaMART — Industrial Control Panel directory",
  },
  electricMotors: {
    subcategory: "Electric motors",
    group: "Electric Motors",
    url: "https://m.indiamart.com/impcat/electric-motors.html",
    sourceName: "IndiaMART — Electric Motors directory",
  },
  cablesWires: {
    subcategory: "Electrical cables and wires",
    group: "Cables & Wires",
    url: "https://m.indiamart.com/impcat/electric-cables.html",
    sourceName: "IndiaMART — Electric Cables directory",
  },
  powerDistribution: {
    subcategory: "Power distribution equipment",
    group: "Power Distribution",
    url: "https://m.indiamart.com/impcat/power-distribution-equipment.html",
    sourceName: "IndiaMART — Power Distribution Equipment directory",
  },
  upsSystems: {
    subcategory: "UPS / power backup systems",
    group: "UPS / Power Backup",
    url: "https://m.indiamart.com/impcat/industrial-ups-systems.html",
    sourceName: "IndiaMART — Industrial UPS Systems directory",
  },
  automationEquipment: {
    subcategory: "Industrial automation equipment",
    group: "Automation Equipment",
    url: "https://m.indiamart.com/impcat/industrial-automation-systems.html",
    sourceName: "IndiaMART — Industrial Automation Systems directory",
  },
} satisfies Record<string, SubcategorySource>;

const STATE_BY_CITY: Record<string, string> = {
  // Gujarat
  Ahmedabad: "Gujarat",
  Vapi: "Gujarat",
  Vadodara: "Gujarat",
  Surat: "Gujarat",
  Gandhinagar: "Gujarat",
  Bhavnagar: "Gujarat",
  Rajkot: "Gujarat",
  Morbi: "Gujarat",
  Bavla: "Gujarat",
  Umargam: "Gujarat",
  Navsari: "Gujarat",
  Jamnagar: "Gujarat",
  Kalol: "Gujarat",
  // Rajasthan
  Jaipur: "Rajasthan",
  Jodhpur: "Rajasthan",
  Dholpur: "Rajasthan",
  Alwar: "Rajasthan",
  // Maharashtra
  Mumbai: "Maharashtra",
  Thane: "Maharashtra",
  "Navi Mumbai": "Maharashtra",
  Pune: "Maharashtra",
  "Pimpri Chinchwad": "Maharashtra",
  Nashik: "Maharashtra",
  Kalyan: "Maharashtra",
  Vasai: "Maharashtra",
  "Bhayander West": "Maharashtra",
  Loni: "Maharashtra",
  Shrirampur: "Maharashtra",
  Panvel: "Maharashtra",
  "Chhatrapati Sambhajinagar": "Maharashtra",
  Jejuri: "Maharashtra",
  Nagpur: "Maharashtra",
  // Delhi
  "New Delhi": "Delhi",
  Delhi: "Delhi",
  // Uttar Pradesh
  Noida: "Uttar Pradesh",
  "Greater Noida": "Uttar Pradesh",
  Ghaziabad: "Uttar Pradesh",
  Kanpur: "Uttar Pradesh",
  Naugarh: "Uttar Pradesh",
  // Telangana
  Hyderabad: "Telangana",
  Secunderabad: "Telangana",
  // Tamil Nadu
  Chennai: "Tamil Nadu",
  Coimbatore: "Tamil Nadu",
  Madurai: "Tamil Nadu",
  Tiruchirappalli: "Tamil Nadu",
  Tiruppur: "Tamil Nadu",
  // Karnataka
  Bengaluru: "Karnataka",
  Ramanagara: "Karnataka",
  Badagaulipady: "Karnataka",
  // Haryana
  Gurugram: "Haryana",
  Gurgaon: "Haryana",
  Faridabad: "Haryana",
  Panchkula: "Haryana",
  Ambala: "Haryana",
  Barwala: "Haryana",
  // Punjab
  Mohali: "Punjab",
  Amritsar: "Punjab",
  "Mandi Gobindgarh": "Punjab",
  // Madhya Pradesh
  Indore: "Madhya Pradesh",
  Pithampur: "Madhya Pradesh",
  // West Bengal
  Kolkata: "West Bengal",
  "South 24 Parganas": "West Bengal",
  // Chandigarh
  Chandigarh: "Chandigarh",
  // Assam
  Guwahati: "Assam",
  // Jammu & Kashmir
  Srinagar: "Jammu and Kashmir",
  // Meghalaya
  Umiam: "Meghalaya",
  // Goa
  Bandoda: "Goa",
  // Chhattisgarh
  Durg: "Chhattisgarh",
  // Uttarakhand
  Haridwar: "Uttarakhand",
};

function locationFor(city: string): string {
  const cleanCity = city.split(",")[0].trim();
  if (!cleanCity) return "";
  const state = STATE_BY_CITY[cleanCity];
  return state ? `${cleanCity}, ${state}` : cleanCity;
}

// Literal-evidence-only technical spec extraction — same discipline as
// prior batches' parseChemSpecs()/parsePcbSpecs(): every extracted fact is
// a direct regex match against the listing title, nothing inferred.
function parseElecSpecs(title: string): string[] {
  const specs: string[] = [];
  const push = (label: string) => {
    if (!specs.includes(label)) specs.push(label);
  };

  const kvaMatch = title.match(/(\d+(?:\.\d+)?)\s*kva\b/i);
  if (kvaMatch) push(`${kvaMatch[1]} kVA`);

  const kwMatch = title.match(/(\d+(?:\.\d+)?)\s*kw\b/i);
  if (kwMatch) push(`${kwMatch[1]} kW`);

  const hpMatch = title.match(/(\d+(?:\.\d+)?)\s*hp\b/i);
  if (hpMatch) push(`${hpMatch[1]} HP`);

  const voltMatch = title.match(/(\d+(?:\.\d+)?)\s*v\b/i);
  if (voltMatch) push(`${voltMatch[1]}V`);

  const ampMatch = title.match(/(\d+(?:\.\d+)?)\s*a(?:mp)?\b/i);
  if (ampMatch) push(`${ampMatch[1]}A`);

  const phaseMatch = title.match(/\b(single|three|3|1)[\s-]*phase\b/i);
  if (phaseMatch) {
    const p = phaseMatch[1].toLowerCase();
    push(`${p === "3" ? "Three" : p === "1" ? "Single" : p.charAt(0).toUpperCase() + p.slice(1)} phase`);
  }

  const ipMatch = title.match(/\bIP\s?(\d{2})\b/i);
  if (ipMatch) push(`IP${ipMatch[1]}`);

  const rpmMatch = title.match(/(\d+(?:\.\d+)?)\s*rpm\b/i);
  if (rpmMatch) push(`${rpmMatch[1]} RPM`);

  const sqmmMatch = title.match(/(\d+(?:\.\d+)?)\s*sq\.?\s*mm\b/i);
  if (sqmmMatch) push(`${sqmmMatch[1]} sq.mm`);

  const coreMatch = title.match(/\b(\d+)\s*core\b/i);
  if (coreMatch) push(`${coreMatch[1]}-core`);

  return specs;
}

function rawRecordsForSubcategory(
  key: keyof typeof SOURCES,
  entries: Listing[]
): RawSupplierRecord[] {
  const { subcategory, group, url, sourceName } = SOURCES[key];
  const categories = Array.from(new Set(["Electrical Equipment", group, subcategory]));

  return entries.map(([companyName, city, title, price, bizType]) => {
    const specs = parseElecSpecs(title);
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

const SWITCHGEAR: Listing[] = [
  ["Aira Trex Solutions India Private Limited", "Bengaluru", "Single, Three Industrial Electrical Switchgear", "₹10,000/Piece"],
  ["D'Mak Energia Private Limited", "Gandhinagar", "D'Mak Three Phase 440V Industrial Switchgear Panel", "₹40,000/Piece"],
  ["Single Window Solutions & Construction Co.", "Jodhpur", "Industrial Electrical Switchgear", "₹1,000/Piece"],
  ["S & S Panel Builders", "Faridabad", "Industrial Electrical Switchgear", "₹55,000/Piece"],
  ["IB Monotaro Private Limited", "New Delhi", "NISI 63 Amp 3 Pole Three Phase with Indicator and box", "₹2,390/Piece"],
  ["Recurve Marketing", "Chennai", "40 Amp Miniature Circuit Breakers (MCB) Enzo lehar kundan Four Pole", "₹925/Piece"],
  ["S B Enterprises", "Pune", "Industrial Electrical Switchgear", "₹1,50,000/Piece"],
  ["Electro Automation Industries", "Faridabad", "Industrial Electrical Switchgear", "₹300/Piece"],
  ["Vijay Kumar Sanjeev Kr Electric", "New Delhi", "Switch Gear for Electric Power System", "₹294/Piece"],
  ["Jaimax Switchgear", "Mumbai", "Electrical Industrial Switchgear, Making Capacity: Electricalelectrical", "₹1,00,000/Piece"],
  ["Trade Well", "Ahmedabad", "Industrial Electrical Switchgear", "₹80,000/Piece"],
  ["Sanjyot Enterprises", "Pune", "Industrial Switchgear", "₹750/Piece"],
  ["SS Electricals", "Jaipur", "INDUSTRIAL SWITCHGEAR", "₹49,500/Piece"],
  ["Sri Krishna Impex", "New Delhi", "Industrial Electrical Switchgear, Breaking Capacity: 240", "₹600/Piece"],
  ["Shree Ganesh Control Systems", "Rajkot", "L & T Switchgear", "₹100/Piece"],
  ["Sai Mail Box", "Indore", "Industrial Electrical Switchgear", "₹2,000/Piece"],
  ["HSL Industries & Sales Corporation", "New Delhi", "Industrial Switchgear", "₹300/Piece"],
  ["Pasand International", "Bhavnagar", "Industrial Electrical Switchgear", "₹45,999/Piece"],
  ["Anand Power System", "Panchkula", "Industrial Electrical Switchgear", "₹2,00,000/Piece"],
  ["J.K. Electric & Refrigeration", "Guwahati", "Industrial Electrical Switchgear", "₹150/Piece"],
  ["A. P. Associates", "", "Electrical Switchgear For Electrical Industry", null],
  ["Anand Electricals", "New Delhi", "Single Phase Industrial Electrical Switchgear", "₹220/Piece"],
  ["Power Square Engineers", "Chennai", "Industrial Electrical Switchgear", "₹1,00,000/Piece"],
  ["Aera Solutions", "", "Electrical Switchgear For Electrical Industry", null],
];

const TRANSFORMERS: Listing[] = [
  ["Servostar India Private Limited", "Loni", "Rolling Contact Type Transformer", "₹1,25,000"],
  ["H.D. Transformers", "Jaipur", "Three Phase Unitized Substation", "₹8,50,000"],
  ["Servokon Systems Limited", "Noida", "SERVOKON 1250 KVA HERMETICALLY SEALED TRANSFORMER", "₹35,00,000"],
  ["Z.M.Enterprises", "Srinagar", "Industrial Electrical Transformer", "₹18,00,000"],
  ["Trutech Products", "Pimpri Chinchwad", "Three Phase 25kVA Air Cooled Step Down Transformers", "₹59,500"],
  ["Twin Track Engineering Spares Of India", "Coimbatore", "Industrial Transformer", "₹17,000"],
  ["Nakoda Steel", "Vadodara", "Industrial Electrical Transformer", "₹65,00,000"],
  ["Samtronix Power Equipments", "New Delhi", "Variable Voltage Transformer", "₹26,502"],
  ["Global Energy Saver", "Faridabad", "Global Upto 5000kva Industrial Distribution Transformer", "₹3,70,000"],
  ["United Transformers", "Jaipur", "Three Phase 10 kVA Multi Stage Booster Transformer, For Industrial", "₹2,00,000"],
  ["Sonal Transformer", "Pune", "Three Phase Industrial Electrical Transformer", "₹35,000"],
  ["Step Up Electricals Private Limited", "Pune", "Three Phase Industrial Electrical Transformer, 1000 kVA", "₹35,722"],
  ["T - Power Transformer & Swichgear Private Limited", "Jaipur", "Industrial Transformer", "₹8,90,000"],
  ["Manyayi Transformers Private Limited", "Ahmedabad", "Delta 3-Phase 42 kVA Three Phase Transformer", "₹1,65,800"],
  ["Gaurav Transformers & Electricals", "Dholpur", "Three Phase Oil Cooled Industrial Transformer, Output Voltage: 415/433, Input Voltage: 33/0.433,11/0.433", "₹8,00,000"],
  ["Solar Power Tech Solutions", "Coimbatore", "Step Up and Step Down Transformer", "₹20,000"],
  ["Gold Lotus Electronic", "Ahmedabad", "50 kVA Industrial Control Transformer", "₹24,999"],
  ["A B Electrical", "Kalyan", "63 kVA to 5000 kVA Industrial Transformer", "₹14,50,000"],
  ["Dqbydt Switchgear Private Limited", "Ghaziabad", "Industrial Distribution Transformer", "₹51,000"],
  ["Servo True Power Solution", "Ghaziabad", "400kva Industrial High Tension Transformer", "₹5,10,000"],
  ["Tirupati Transformers Private Limited", "Greater Noida", "500 kva Industrial Transformer", "₹7,25,000"],
  ["Mahendra Transformers Private Limited", "Ghaziabad", "3-Phase 630 KVA 11 KV CLASS DISTRIBUTION TRANSFORMER", "₹8,50,000"],
  ["Red Phase Engineers", "Chandigarh", "315 kVA 3-Phase Industrial Power Transformer", "₹3,85,000"],
  ["Powertech Transformers & Controls Pvt. Ltd.", "Hyderabad", "Industrial Transformer", "₹5,00,000"],
  ["Aaditri Industrial Solutions", "Ghaziabad", "Three Phase Industrial Transformers", "₹50,000"],
  ["Systems And Solutions", "Ghaziabad", "200 Amp Three Phase Current Transformer", "₹23,000"],
  ["Delta Power Systems", "", "Industrial Distribution Transformer", "₹15,00,000/Piece"],
];

const CONTROL_PANELS: Listing[] = [
  ["Next Gen Power Controls", "Ahmedabad", "Industrial Electrical Control Panel, 240A", "₹50,000"],
  ["Earth Automation", "Ahmedabad", "Heavy Duty Industrial Electric Control Panel", "₹60,000"],
  ["Kesher Automation", "Ahmedabad", "Kesher Automation Industrial BCS Control Panel", "₹3,00,000"],
  ["Relief Power Control Panel", "Ahmedabad", "Industrial Electrical Panel", "₹3,00,000"],
  ["Ecosys Efficiencies Private Limited", "Mumbai", "Three Phase 440 V Industrial Control Panel", "₹50,000"],
  ["Simatech Automation", "Vasai", "Control Panel", "₹1,10,000"],
  ["Shree Sai Solutions", "New Delhi", "Electrical and industrial control Panels", "₹10,00,000"],
  ["Noble Automation Private Limited", "Rajkot", "AC Drive Panel", "₹10,000"],
  ["Lucsam Enterprises Private Limited", "Navi Mumbai", "11 kW Industrial Control Panel", "₹5,000"],
  ["Indian Electric And Power Control Inc", "Vadodara", "45 kW Industrial Control Panel", "₹55,000"],
  ["Wonder Systems (India) Private Limited", "Mohali", "Electric Control Panel, For Industrial", "₹4,00,001"],
  ["D'Mak Energia Private Limited", "Gandhinagar", "D'Mak Three Phase 440V Heavy Duty Industrial Electrical Control Panel", "₹63,999"],
  ["Kap Automation Technologies", "Chennai", "250 kW Industrial PLC Control Panel", "₹8,83,005"],
  ["Labh Projects Private Limited", "Ahmedabad", "Industrial Electrical Control Panel Board - Labh Group, 5000A", "₹1,00,000"],
  ["Controls Instruments India", "New Delhi", "Electrical Control Panel, Operating Voltage: 440V, Degree of Protection: IP55", "₹80,999"],
  ["SRR Energy & Automation Private Limited", "Greater Noida", "Industrial Control Panel", "₹2,25,000"],
  ["Mahendra Industries", "Ahmedabad", "Industrial Control Panel", "₹1,60,000"],
  ["PSP Techno Engineers Private Limited", "New Delhi", "45 kW Industrial Control Panel", "₹1,49,999"],
  ["Invent Controls And Automation", "Chennai", "IOT Based Control Panel", "₹15,000"],
  ["J K Electrical And Automation", "Ahmedabad", "Industrial Distribution Panel", "₹80,000"],
  ["Ampper Controls And Automation", "Coimbatore", "10HP Control Panel For Interlock Brick Machine", "₹55,000"],
  ["We Tech Power Control Pvt. Ltd.", "Ahmedabad", "210kW Industrial Control Panel", "₹2,00,000"],
  ["Power Line Traders", "Chennai", "PLT Electrical Control Panel", "₹1,00,000"],
  ["Star Solutions", "Chandigarh", "500 kW Industrial Control Panel", "₹8,00,000"],
  ["SRI RAMANUJAM CONTROLS", "Chennai", "15HP Industrial Control Panel", "₹1,80,000"],
  ["Motion Automation", "Rajkot", "Mild Steel sheet Industrial Control Panel, For Machine Power Distribution", "₹1,30,000"],
  ["Listrik System LLP", "Mumbai", "Three Phase Industrial Electrical Control Panel", "₹15,000"],
  ["E Square Automation", "Pune", "Control Panel for Process Industry", "₹2,00,000"],
  ["Electro Control Systems India Private Limited", "Rajkot", "Industrial Electrical Control Panel", "₹2,00,000"],
  ["Spectrum Technologies", "", "Industrial Electrical Control Panel", "₹3,50,000"],
  ["Rapid Control System", "", "3.5 kW Industrial Control Panel", "₹21,000"],
];

const ELECTRIC_MOTORS: Listing[] = [
  ["Aira Trex Solutions India Private Limited", "Bengaluru", "101-200 KW 40 HP Bharat Bijlee AC Motor, 1500 rpm", "₹10,000/Piece"],
  ["Power Cable Corporation", "Chennai", "Crompton Greaves CG IE3 Flame Proof Electric Motors, Power: 10-100 KW, 440", "₹12,550/Piece"],
  ["Jaggi Industries", "New Delhi", "Copper winding motor", "₹6,000/Piece"],
  ["Mechelectric Solution Co.", "Bengaluru", "Nema Electric Motor", "₹25,000/Piece"],
  ["Hanuman Power Transmision Equipments Private Limited", "Mumbai", "REMI Dual Speed Motor", "₹2,300/Piece"],
  ["Maaster Machinery & Tools", "Coimbatore", "5 HP Electric Motors", "₹15,750/Piece"],
  ["Nexa Engineering Solutions", "Pune", "Cast Iron Three/Single Phase AC SERVO MOTORS, Packaging Type: Box", "₹10,000/Piece"],
  ["Vikas Machinery And Automobiles", "Rajkot", "Electric Motor", "₹4,200/Piece"],
  ["Power Step", "Ghaziabad", "5 Kg 60 Rpm Motor", "₹799/Piece"],
  ["Stark Industries", "Coimbatore", "Carding Machine Motors", "₹8,000/Unit"],
  ["Sumit Engineering Works", "Ahmedabad", "Electric Motor", "₹3,500/Piece"],
  ["Precision Engineering Works", "Mumbai", "110 KW Flameproof Electric Motors", "₹12,000/Piece"],
  ["Innovators Electric Solutions Private Limited", "Pune", "Crompton 9.3kW 1500 RPM Flange Mounted Non FLP Motor IE2", "₹43,116/Piece"],
  ["Shreeji International", "Ahmedabad", "3 Phase 60HP Electric Motor", "₹1,19,400/Piece"],
  ["New India Electricals Ltd.", "Bengaluru", "Hazardous Area Motors", "₹10,000/Piece"],
  ["Kar Brothers Electric", "Kolkata", "< 10 KW Electric Motor Bharat Bijlee Make, 1500 rpm", "₹5,500/Piece"],
  ["Tiger India Engineering Works", "Mumbai", "5 HP Electric Vertical AC Motor", "₹3,500/Piece"],
  ["Shruti Engineering", "Ahmedabad", "3 Phase AC Brake Motor", "₹6,200/Number"],
  ["Sai Agro", "Shrirampur", "Krushi Power Motor For Milking Machine", "₹6,000/Piece"],
  ["Sedan Engineering Enterprises", "Hyderabad", "0.75 KW 1 HP General Purpose Single Phase Motor, 1440 rpm", "₹4,000/Piece"],
  ["Al-Ameen Enterprises", "Kolkata", "Electric Motors, 45 Degree Celsius", "₹9,000/Piece"],
  ["M.S.Enterprises", "Chennai", "30 KW 10 HP Electric Motor, 1500 rpm", "₹6,500/Piece"],
  ["Rathoud Enterprises", "", "BBL Electric Motor", "₹24,500/Piece"],
  ["Anubhuti (A Brand Of Anubhuti Power System)", "Ahmedabad", "Electric Motor Dealers", "₹17,800/Piece"],
  ["Manohar Electric & Machinery Store", "", "Single Phase Electric Motor", "₹7,000/Unit"],
  ["Jain Machine Tools & Electricals LLP", "", "Custom Designed Motors", "₹2,000/Piece"],
  ["N. K. Enterprise", "Kolkata", "Three Phase Ie5 Electric Motor, 2.2 kW (3 HP)", "₹20,000/Piece"],
  ["Techno Ohms Solution Private Limited", "Jaipur", "Three Phase Hindustan Electric Motor HEM IE2, 0.25Hp (0.18 KW)", "₹4,724/Piece"],
  ["Gennext Control", "Pune", "Gennext Up to 2000RPM Three Phase Electric Motor, Up To 380 V", "₹4,500/Piece"],
  ["Techno Scientific Instruments", "Ambala", "Single Phase ELECTRIC MOTOR (REGULAR), 1 HP (0.75 kW)", "₹999/Piece"],
  ["Yasin Polisher & Company", "New Delhi", "1.1 KW Electrical Motor", "₹4,500/Piece"],
  ["Anup Industries", "Ahmedabad", "1 kW Dual RPM Electric Motor", "₹7,300/Unit"],
  ["Green Star Aata Maker", "Ahmedabad", "Two phase 2 Hp Dholak Motor", "₹5,000/Piece"],
  ["Shree Vinayak Automation", "Ahmedabad", "0.25 HP Three Phase Electric Motor", "₹3,600/Piece"],
  ["Green Flames", "Umiam", "Electric Motor", "₹25,000/Piece"],
  ["Shree Jee Industrial Corporation", "Jaipur", "440V Heavy Duty Electric Motor, Three phase, 3 HP", "₹5,000/Piece"],
  ["Mohil Electricals", "Ahmedabad", "Electric Motor", "₹4,500/Piece"],
  ["Farm Tech Industries", "Ahmedabad", "Indotech 20Hp 1500Rpm 3Ph motor", "₹48,850/Piece"],
  ["Halcyon Motors Company", "Ahmedabad", "5 HP Electric Single Phase Motor", "₹14,000/Piece"],
  ["Ganesh Enterprise", "Rajkot", "AC Induction Motor, IP Rating: IP44", "₹4,990/Piece"],
  ["Pavan Industries", "Ahmedabad", "Single Phase Motors, 1 HP (0.75 kW)", "₹6,500/Piece"],
  ["Amee Electricals", "Ahmedabad", "Cast Iron 1 Phase Electric Variable Motor, Voltage: 230-66000 V", "₹35,000/Piece"],
  ["Aar Kay Associates", "Mandi Gobindgarh", "1440 rpm AC Wound Rotor Motors", null],
];

const CABLES_WIRES: Listing[] = [
  ["Rajasthan Electric Industries", "Jaipur", "Electronic Wire Cable", "₹50/Meter"],
  ["Nilang Wires & Cables Private Limited", "Ahmedabad", "Multi Core Cables", "₹60/Meter"],
  ["Aerolex Cables Private Limited", "Bavla", "AEROLEX Flexible Battery Cable To Supply High Current Necessary", "₹35/Meter"],
  ["Superlex Wire Industries", "New Delhi", "Round Copper PVC Insulated Electrical Cables, Packaging Type: Box", "₹60/Meter"],
  ["Mahadev Enterprise", "Bhayander West", "Electrical Wires And Cables", "₹22/Meter"],
  ["Larken Group LLP", "Morbi", "1 Core Electrical Cable, Copper, 1.5 Sq.mm", "₹18/Meter"],
  ["Paras Wires Private Limited", "Ramanagara", "Shielded Composite Cable", "₹35/Meter"],
  ["Setpal Wires & Cables Industries", "Vasai", "PVC Electric Lift Cables, Packaging Type: Roll, Insulation Thickness: 1.5 Mm", "₹10/Meter"],
  ["Gunina Engineers", "New Delhi", "Black Copper And Aluminium Electric Insulated Cables, 240 V, Wire Size: 6-8 Mtr", "₹35/Meter"],
  ["Ganpati Engineering Industries", "Jaipur", "4 Core Copper Armoured Cable, 4 sq mm", "₹1,100/Meter"],
  ["Tefloxx Products", "Ghaziabad", "100 Mtr Silver PT100 Cable Roll, Rubber, 220 V", "₹25/Meter"],
  ["Synergy Telecom Private Limited", "New Delhi", "1 Core 1-1/5\" Super Flex Cable, Copper, 50 Sq.mm", "₹180/Meter"],
  ["Arrob", "Secunderabad", "Speciality Electric Cable, For Industrial", "₹999/Meter"],
  ["Viral Wire LLP", "Nashik", "1 Sq Mm Viral Electric Cable", "₹15/Meter"],
  ["Bhuwal Insulation Cable Private Limited", "Umargam", "Wind Turbine Cables", "₹55/Meter"],
  ["Kei Industries Limited", "New Delhi", "KEI 4 Core Aluminium XLPE Armoured Electric Cable", "₹221/Meter"],
  ["Sanatan Cable Industries", "Ahmedabad", "Sanflex 1.5 Sqmm Ev Cable 125 Celcius Hv Copper Cable", "₹27/Meter"],
  ["Sagar Industries", "Jaipur", "3 Core Electric Power Cable, Copper", "₹50/Meter"],
  ["Electro Control Cables", "New Delhi", "Electrical Cable Wires", "₹60/Meter"],
  ["Vignesh Enterprise", "Coimbatore", "Snale Cable", null],
  ["Maple Exim Company", "Noida", "Electrical Cable", null],
  ["Tecmac India", "Kolkata", "Wire Cable", null],
  ["Vishala Engineers", "Ahmedabad", "ELEVATOR CABLE AND ELECTRICAL", null],
  ["Modern electronic", "Indore", "Cable", null],
  ["Jay Bhagwati Electric & AMP", "Navsari", "Electric Cables", null],
  ["Maa Laxmi Telecome Shop", "New Delhi", "Electric Cables", null],
  ["Ancient Exports", "Chennai", "Cable 60 MM", "₹260/meter"],
  ["ARV Engineering", "Mumbai", "Cables", null],
  ["Abhishek Trading Company", "Indore", "Cable", "₹100/Meter"],
  ["Shri Krishna Electricals", "Kalol", "Electric Cables", null],
  ["Vbmarine", "Bhavnagar", "Electrical Cable", null],
  ["Mahima Communications", "Bengaluru", "Electric Cables", null],
  ["Pinnacle Inc. India", "Mumbai", "Power Cables and Cable Accessories", null],
  ["Genmart Inc.", "Bengaluru", "Electric Cables", null],
  ["Simran Hardware", "Mohali", "Electric Cables", null],
  ["Yellow & Green Brightness Begins", "Tiruchirappalli", "Wire And Cables", null],
  ["Rajiv Enterprises", "Naugarh", "Power Wires And Cables", null],
  ["E. P. L. Technologies Private Limited", "Chennai", "Electrical Cables", null],
  ["Ambe Electric Palace", "", "2.5 mm HD Cable Electrical Wires Cables", "₹5,808/Roll"],
  ["B.S. International", "", "1.5 sq.mm Mescab Timeshield FR Electric Cable Roll", "₹4,000/Roll"],
  ["Alcop Cables Private Limited", "", "Flame Retardant PVC Electric Wire", "₹10/Meter"],
  ["S.S. Enterprises", "", "2.5 Sq Mm Cable", "₹3,549/Roll"],
  ["Vinayak Enterprises", "", "2 Pair RS485 Cable", "₹68/Meter"],
  ["Komal Cable", "", "Electric Wire Cable", "₹840/Meter"],
];

const POWER_DISTRIBUTION: Listing[] = [
  ["Thingslista Automation LLP", "Ahmedabad", "Intelligent Microcomputer Protection Device (Battery-Free)", "₹10,000", "manufacturer"],
  ["Vijay Kumar Sanjeev Kr Electric", "New Delhi", "Power Distribution System", "₹780"],
  ["SPB Industries", "Tiruppur", "Power Distribution Equipment", "₹78,000", "manufacturer"],
  ["Sapson Solar System", "Alwar", "Power Distribution Components", "₹9,500"],
  ["TKT Technology Services Private Limited", "Pune", "Power Distribution Systems", "₹10,00,000"],
  ["G S Trading Corporation", "Nagpur", "CS POWER DISTRIBUTION COMPONENTS", null, "trader"],
  ["Silvergate Engineering Private Limited", "Jamnagar", "9 Aluminum power distribution accessories", null, "manufacturer"],
  ["Techsential India", "New Delhi", "Suspended power distributor for F, B, PL, CZ, Type: 250AIR", "₹29,549"],
  ["Canara Lighting Industries Private Limited", "Badagaulipady", "Power Distribution Trolley", null, "manufacturer"],
  ["Shyam Electricals", "Secunderabad", "Power Distribution Equipment", "₹32,000"],
  ["Kamala Electrical", "Coimbatore", "Final Power Distribution Components", "₹450"],
  ["Mama Electrical Work Pro Sher Mohammed Shakh", "Pithampur", "Sub-Station Material Power Distribution Equipment", "₹5,000"],
  ["Connect System India", "Barwala", "One In Five Power Distributor", "₹2,000"],
  ["Chakraborty Electricals Pvt. Ltd.", "Kolkata", "Single Phase 1000A Main Emergency Panel, 415 V", "₹65,564"],
  ["Aditya Electronics", "Durg", "Power Distributor", "₹16,500"],
  ["E-Tech Power Engineers", "Noida", "Three Phase Power Distribution Equipment, Base, Output Voltage: 440VAC", null],
  ["Virak Switchgear", "Kanpur", "Power Distribution Equipment", null],
  ["India Electric Works", "Kolkata", "Energy System Power Distribution", null],
  ["Gotey Engineers", "Nagpur", "Power Distribution Components", null],
  ["Ganesh Computers", "Pune", "Power Distribution Rack", null],
  ["C & S Electric Limited", "Haridwar", "Power Distribution Components", null, "manufacturer"],
  ["Ravin Cables Limited", "Ahmedabad", "Power Distribution Equipment", null],
];

const UPS_SYSTEMS: Listing[] = [
  ["Beta Power Controls LLP", "Coimbatore", "Eaton 93T 120 kVA Industrial Online UPS", "₹2,25,000"],
  ["Maxxcom System Private Limited", "Ahmedabad", "SCHNEIDER EASY UPS, For Industrial", "₹2,40,000"],
  ["Maven Automation", "Ahmedabad", "Industrial UPS Systems", "₹51,000"],
  ["Enertech Ups Pvt. Ltd.", "Pune", "Enertech 40kVA 3-1Phase Industrial UPS", "₹3,82,789"],
  ["Sempra Electric Private Limited", "Ahmedabad", "Online Ups Systems, 4000kVA", "₹1,50,000"],
  ["Green Powers", "Madurai", "Industrial UPS Systems, 1kva to 500kva", "₹1,25,800"],
  ["Leanwork Solutions LLP", "Kalyan", "H X SERIES UPS : 1 KVA - 30 KVA", "₹2,80,000"],
  ["Numax Power Products", "Hyderabad", "NUMAX 3KVA UPS IN KERALA", "₹52,000"],
  ["GMDT Marine And Industrial Engineering Private Limited", "Ahmedabad", "Industrial UPS System", "₹15,000"],
  ["Shakti Power Solutions Private Limited", "Amritsar", "Eaton Dxrt-10kva With External Battery Model", "₹1,04,000"],
  ["Purevolt Products Private Limited", "New Delhi", "Industrial UPS Systems", "₹30,000"],
  ["Volt Control System", "Pune", "Industrial UPS Systems", "₹35,000"],
  ["Unicon Automation And Control", "Ahmedabad", "industrial ups systems", "₹24,000"],
  ["Chirag Techno Electricals Co.", "Mumbai", "UPS EATON VERTIV, 1 to 25 KVA", "₹69,999"],
  ["RS Automation", "Pune", "Industrial UPS Systems, 20 KVA", "₹3,00,000"],
  ["Ultra Power Mac", "Ahmedabad", "Industrial Ups Systems", "₹5,50,000"],
  ["Usha Power Tec", "Mohali", "Online Industrial UPS Systems, 200 kVA", "₹10,00,000"],
  ["Costa Power Industries Private Limited", "Thane", "Online UPS System", "₹25,000"],
  ["Protek Enterprises", "Ahmedabad", "10 kva Single Phase Industrial UPS Systems", "₹70,000"],
  ["Indo Powersys Private Limited", "Jaipur", "160kVA Industrial UPS with Isolation Supplier in Rajasthan", "₹9,93,600"],
  ["Powertronics Corporate Solution Private Limited", "Panvel", "Industrial Ups Systems", "₹1,61,200"],
  ["Sangam Electronics Co.", "Surat", "PowerValue LI Up / Pro", "₹2,50,000"],
  ["JDM Technologies Private Limited", "New Delhi", "Toshiba-Mitsubishi Electric Make 300 KVA 3:3 Phase Industrial On-Line UPS", "₹17,00,000"],
  ["Elnova Private Limited", "New Delhi", "Industrial UPS Systems, 20 kVA", "₹10,000"],
  ["ADS Automation And Control Systems", "New Delhi", "20 KVA Uninterruptible Power Supply System", "₹1,20,000"],
  ["Motoline Electronics", "Kolkata", "Industrial UPS Systems", "₹1,15,000"],
  ["R. P. S. Products", "Delhi", "Industrial UPS Systems", null],
  ["Shell Traders and Exporter", "Mumbai", "Commercial UPS", null],
  ["Esteem Innovative And Power Solutions", "Bengaluru", "Industrial UPS System", null],
  ["Zebra Enterprise", "", "Industrial UPS", "₹1,20,000"],
  ["Powertek Energy Systems", "", "Industrial UPS System", "₹30,000"],
  ["Power Solution Services", "", "20KVA Industrial UPS Systems", "₹1,58,000/Piece"],
  ["E Power Technologies", "", "E POWER 80 KVA 3Phase MRI Machine Online UPS System", "₹8,50,000"],
  ["DRM Technology Solutions", "", "10 KVA Industrial UPS Systems (Finch RT)", "₹91,003"],
];

const AUTOMATION_EQUIPMENT: Listing[] = [
  ["Ecosys Efficiencies Private Limited", "Mumbai", "Industrial Automation Plc", "₹40,000"],
  ["Tekglobal Technologies", "Chennai", "SIEMENS Distillery Automation System", "₹35,000"],
  ["Imatics", "Chennai", "Imatics Three Phase Industrial Automation System, 440V", "₹4,00,000"],
  ["Hi-Tech Combustion", "Ahmedabad", "Burner Automation System", "₹60,000"],
  ["Teczhar Private Limited", "Chhatrapati Sambhajinagar", "3 Industrial Automation Systems, 440, Model Name/Number: Siemens", "₹55,000"],
  ["Labh Projects Private Limited", "Ahmedabad", "Factory Automation for Plastic Processing Industry Plant", "₹2,00,000"],
  ["R.S. Enterprises", "Chennai", "R S Enter Industrial Automation System", "₹33,000"],
  ["Proflex Engineering", "Bandoda", "Industrial Automation System", "₹40,000"],
  ["Nexus Automech Private Limited", "Ahmedabad", "Industrial Automation Systems", "₹15,00,000"],
  ["Miranda Automation Private Limited", "Navi Mumbai", "Industrial Automation System", "₹17,40,000"],
  ["DVC Process Technologists", "Jejuri", "Tank Farm Automation Plant", "₹10,00,000"],
  ["Aumcontrols And Equipment", "Ahmedabad", "Industrial Automation System", "₹1,50,000"],
  ["Power Drives Enterprises (India) Private Limited", "Chennai", "Pick and Place Automation System", "₹1,75,000"],
  ["Hitech Automation", "Pune", "Industrial Automation Systems", "₹7,500"],
  ["Adatronix Private Limited", "Bengaluru", "Bpt Industrial Automation, 5V", "₹17,430"],
  ["Vision Automation & Robotic Solution", "Gurugram", "Nil Panasonic Industrial Automation Products", "₹10,000"],
  ["General Motion Control", "Ahmedabad", "Industrial Automation System", "₹60,000"],
  ["D. S. Industrial Solution", "Gurgaon", "Line Automation System, Wired", "₹3,00,000"],
  ["Dydac Controls", "New Delhi", "Industrial Automation Systems", "₹5,00,000"],
  ["B N Tecpack Automation Private Limited", "Pune", "BN Enterprises Three Phase Industrial Automation Systems", "₹12,35,000"],
  ["Technologics Global Pvt. Ltd.", "Bengaluru", "Single Phase Industrial Automation Control System, 220 V", "₹50,000"],
  ["Base Electronics & Systems", "Chennai", "Fuel Management System", "₹3,00,000"],
  ["Innovative Instruments And Controls", "Chennai", "Industrial Automation Panel Chennai", "₹65,000"],
  ["Auto Tronix Engineering Private Limited", "Pune", "Automation System for Packaging Industry", "₹70,000"],
  ["Urjatantra Automation", "Pune", "Plc Industrial Automation Systems", "₹50,000"],
  ["Variety Innovation Venture Private Limited", "Gurugram", "Spin Robotics Screw feeder OM-26R60 M6", "₹1,05,490"],
  ["Thermocool Engineering Private Limited", "South 24 Parganas", "PLC System Industrial Automation Systems", "₹5,00,000"],
  ["Impetus Prolific Private Limited", "Rajkot", "Corrugation Industry Automation", "₹10,00,000"],
  ["Ampper Controls And Automation", "Coimbatore", "Water Treatment Automation Systems", "₹6,00,000"],
  ["Get Automation And Services", "Ahmedabad", "Labeling Machine Automation System, Model AEABL-105", "₹80,000"],
  ["Technic Fluid System Private Limited", "Ahmedabad", "Industrial Pneumatic Automation System", "₹3,75,000"],
  ["Vasundhara IT Private Limited", "Pune", "Vasundhara IT Industry 4.0 Industrial Automation Systems", "₹1,00,000"],
  ["Kreative Technomation Private Limited", "Ahmedabad", "Industrial Automation Hmi, 5.7 inch, 3 Phase", "₹6,000"],
  ["Mech Space Automation", "Vadodara", "Industrial Automation Systems", "₹25,00,000"],
  ["Sewa Call", "New Delhi", "Sewa Call Warehouse Automation Systems", "₹11,000"],
];

const ALL_SUBCATEGORIES: { key: keyof typeof SOURCES; entries: Listing[] }[] = [
  { key: "switchgear", entries: SWITCHGEAR },
  { key: "transformers", entries: TRANSFORMERS },
  { key: "controlPanels", entries: CONTROL_PANELS },
  { key: "electricMotors", entries: ELECTRIC_MOTORS },
  { key: "cablesWires", entries: CABLES_WIRES },
  { key: "powerDistribution", entries: POWER_DISTRIBUTION },
  { key: "upsSystems", entries: UPS_SYSTEMS },
  { key: "automationEquipment", entries: AUTOMATION_EQUIPMENT },
];

// ---------------------------------------------------------------------
// Cross-subcategory merge — identical pattern to every prior batch's
// mergeSameCompanyAcrossSubcategories(). See file header for the
// cross-category consistency check that led to excluding two repeat
// generic resellers rather than relying on this merge step.
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
  let existingIds: number[] = [5999]; // seed just below the 6000-6999 block (see lib/supplier-store.ts)
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
      if (c === "Electrical Equipment") continue;
      bySubcategory.set(c, (bySubcategory.get(c) ?? 0) + 1);
    }
  }

  console.log(`Total raw listings across ${ALL_SUBCATEGORIES.length} IndiaMART subcategory pages: ${totalRawListings}`);
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

  const dataFile = path.join(process.cwd(), "data", "suppliers", "electrical-equipment.json");
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ suppliers }, null, 2), "utf-8");
  console.log(`\nWrote ${suppliers.length} suppliers to ${dataFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
