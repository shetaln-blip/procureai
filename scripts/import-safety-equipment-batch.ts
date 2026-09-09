// Ingestion run: Safety Equipment supplier batch (India-wide) — Batch 9 of
// the master plan, eighth per-category dataset added to the existing
// multi-file supplier repository (see lib/supplier-store.ts's id-block
// scheme). Same architecture as every prior batch: normalizeSupplierRecord
// / computeDataConfidence / computeDedupeKey / findPotentialDuplicates from
// the existing lib/ingestion + lib/dedup modules — nothing new invented.
//
// SOURCES: 14 pan-India IndiaMART "impcat" category pages spanning 4
// natural groups — Personal Protective Equipment (safety helmets, safety
// shoes, safety gloves, safety goggles), Fire Safety (fire extinguishers,
// fire hose/hydrant equipment, fire suppression systems), Signage &
// Barriers (safety signage, plastic barricades, reflective traffic cones,
// safety nets), and Instruments & Specialized PPE (gas detectors,
// respiratory protection / industrial safety masks, fall protection /
// safety harnesses).
//
// RESEARCH NOTE: raw listing data was gathered via two parallel research
// passes, each WebFetching every subcategory's base URL and its "?pg=2"
// variant and transcribing every listing verbatim. The curated Listing[]
// arrays below apply one additional manual pass on top of the agents' own
// GENUINE/EXCLUDED classification, per the same discipline as every prior
// batch.
//
// INCLUSION RULE applied while curating the raw listings below:
//   - EXCLUDED: foreign companies not based in India.
//   - EXCLUDED: listings that are purely a reseller of ONE specific named
//     foreign brand via an otherwise-unrelated trading company with no
//     stated Indian own-business evidence. A company name that plausibly
//     indicates a genuine relevant technical/safety business was NOT
//     auto-excluded for listing one foreign brand (e.g. Alvi Automation
//     reselling MSR/Germany, Max LT Technologies reselling Drager/Det-
//     tronics) — judged case-by-case, consistent with every prior batch.
//   - EXCLUDED: spare-parts/component-only listings (a bare extinguisher
//     body/shell, a harness buckle, a gas-sensor component) rather than a
//     complete safety product.
//   - EXCLUDED: repair/service/inspection/calibration-only listings and
//     training/certification services (not products).
//   - EXCLUDED: consumer-only/toy/costume/recreational items with no
//     plausible workplace/industrial use (adventure-sports climbing
//     helmets, camouflage/hunting nets, animal-deterrent nets, residential
//     balcony/child-safety nets).
//   - EXCLUDED: medical/surgical/hospital-only PPE (gynaecological exam
//     gloves) — this category is workplace/industrial safety, not medical
//     supplies. Industrial dust/gas respirator masks (including those
//     marked "for pharma industry" manufacturing use) were kept.
//   - EXCLUDED: listings for a clearly unrelated business that surfaced by
//     keyword coincidence.
//   - A company name alone was NOT used to exclude a listing whose title
//     carried genuine safety-equipment evidence — same rule as every prior
//     batch (e.g. "Apex Medev"/"Aventiq Health" selling genuine fall-
//     protection harness systems were kept; "Source India Shoes" selling a
//     genuine half-body harness was kept).
//   - CONSISTENCY NOTE: "Stepin Adventure" appears twice in this batch's
//     source data — an adventure-sports/mountaineering climbing helmet
//     (excluded under PPE, as it's recreational climbing gear, not
//     workplace safety equipment) and a "Vertical Life Safety Harness
//     Tourist" (excluded under Fall Protection for the same reason —
//     explicitly tourism/recreational use, not workplace fall protection).
//   - CROSS-BATCH CONSISTENCY CHECK: checked this batch's company names
//     against the repeat generic-reseller companies excluded in prior
//     batches ("Spot India Group"/"Spot India Company", "Econtrol Devices
//     Private Limited") — neither appears anywhere in this batch's data.
//
// MANUFACTURER/DISTRIBUTOR/TRADER STATUS: left unset ("unknown") unless a
// literal, unambiguous business-type word appears on the listing itself.
// Two listings literally say "Manufacturer" in the title ("Fire
// Extinguisher Bodies Manufacturer" — but that listing is itself EXCLUDED
// as a spare-parts/component listing; "Traffic Safety Signage
// Manufacturers" — kept, mapped to "manufacturer"). Every other listing in
// this batch is left unset.
//
// TECHNICAL SPECS: extracted only when literally present in the title —
// weight/capacity in kg, size in mm/inch, FFP respirator rating, EN388 cut
// level, fire-extinguisher class (A/B/C/D), literal IS/EN standard codes,
// net layer count — via parseSafetySpecs(). Nothing is inferred beyond the
// title text.
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
  safetyHelmets: {
    subcategory: "Safety helmets",
    group: "Personal Protective Equipment",
    url: "https://m.indiamart.com/impcat/safety-helmets.html",
    sourceName: "IndiaMART — Safety Helmets directory",
  },
  safetyShoes: {
    subcategory: "Safety shoes",
    group: "Personal Protective Equipment",
    url: "https://m.indiamart.com/impcat/safety-shoes.html",
    sourceName: "IndiaMART — Safety Shoes directory",
  },
  safetyGloves: {
    subcategory: "Safety gloves",
    group: "Personal Protective Equipment",
    url: "https://m.indiamart.com/impcat/safety-gloves.html",
    sourceName: "IndiaMART — Safety Gloves directory",
  },
  safetyGoggles: {
    subcategory: "Safety goggles",
    group: "Personal Protective Equipment",
    url: "https://m.indiamart.com/impcat/safety-goggles.html",
    sourceName: "IndiaMART — Safety Goggles directory",
  },
  fireExtinguishers: {
    subcategory: "Fire extinguishers",
    group: "Fire Safety",
    url: "https://m.indiamart.com/impcat/fire-extinguishers.html",
    sourceName: "IndiaMART — Fire Extinguishers directory",
  },
  fireHose: {
    subcategory: "Fire hose / hydrant equipment",
    group: "Fire Safety",
    url: "https://m.indiamart.com/impcat/fire-hose.html",
    sourceName: "IndiaMART — Fire Hose directory",
  },
  fireSuppression: {
    subcategory: "Fire suppression systems",
    group: "Fire Safety",
    url: "https://m.indiamart.com/impcat/fire-suppression-systems.html",
    sourceName: "IndiaMART — Fire Suppression Systems directory",
  },
  safetySignage: {
    subcategory: "Safety signage",
    group: "Signage & Barriers",
    url: "https://m.indiamart.com/impcat/safety-signage.html",
    sourceName: "IndiaMART — Safety Signage directory",
  },
  barricades: {
    subcategory: "Barricades",
    group: "Signage & Barriers",
    url: "https://m.indiamart.com/impcat/plastic-barricade.html",
    sourceName: "IndiaMART — Plastic Barricade directory",
  },
  safetyCones: {
    subcategory: "Safety cones",
    group: "Signage & Barriers",
    url: "https://m.indiamart.com/impcat/reflective-traffic-cone.html",
    sourceName: "IndiaMART — Reflective Traffic Cone directory",
  },
  safetyNets: {
    subcategory: "Safety nets",
    group: "Signage & Barriers",
    url: "https://m.indiamart.com/impcat/safety-net.html",
    sourceName: "IndiaMART — Safety Net directory",
  },
  gasDetection: {
    subcategory: "Gas detection & safety instruments",
    group: "Instruments & Specialized PPE",
    url: "https://m.indiamart.com/impcat/gas-detectors.html",
    sourceName: "IndiaMART — Gas Detectors directory",
  },
  respiratoryProtection: {
    subcategory: "Respiratory protection",
    group: "Instruments & Specialized PPE",
    url: "https://m.indiamart.com/impcat/safety-mask.html",
    sourceName: "IndiaMART — Safety Mask directory",
  },
  fallProtection: {
    subcategory: "Fall protection & confined space safety",
    group: "Instruments & Specialized PPE",
    url: "https://m.indiamart.com/impcat/safety-harnesses.html",
    sourceName: "IndiaMART — Safety Harnesses directory",
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
  Sanand: "Gujarat",
  Chhatral: "Gujarat",
  // Rajasthan
  Jaipur: "Rajasthan",
  Jodhpur: "Rajasthan",
  Dholpur: "Rajasthan",
  Alwar: "Rajasthan",
  Bharatpur: "Rajasthan",
  Kota: "Rajasthan",
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
  Raigad: "Maharashtra",
  Boisar: "Maharashtra",
  Saphale: "Maharashtra",
  Chandgad: "Maharashtra",
  // Delhi
  "New Delhi": "Delhi",
  Delhi: "Delhi",
  // Uttar Pradesh
  Noida: "Uttar Pradesh",
  "Greater Noida": "Uttar Pradesh",
  Ghaziabad: "Uttar Pradesh",
  Kanpur: "Uttar Pradesh",
  Naugarh: "Uttar Pradesh",
  Lucknow: "Uttar Pradesh",
  Agra: "Uttar Pradesh",
  Unnao: "Uttar Pradesh",
  Meerut: "Uttar Pradesh",
  Prayagraj: "Uttar Pradesh",
  Bareilly: "Uttar Pradesh",
  // Telangana
  Hyderabad: "Telangana",
  Secunderabad: "Telangana",
  Koratla: "Telangana",
  // Tamil Nadu
  Chennai: "Tamil Nadu",
  Coimbatore: "Tamil Nadu",
  Madurai: "Tamil Nadu",
  Tiruchirappalli: "Tamil Nadu",
  Tiruppur: "Tamil Nadu",
  Salem: "Tamil Nadu",
  Avinashi: "Tamil Nadu",
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
  Bahadurgarh: "Haryana",
  Karnal: "Haryana",
  Bhiwani: "Haryana",
  Bhiwadi: "Haryana",
  Panipat: "Haryana",
  Palwal: "Haryana",
  // Punjab
  Mohali: "Punjab",
  Amritsar: "Punjab",
  "Mandi Gobindgarh": "Punjab",
  Ludhiana: "Punjab",
  Jalandhar: "Punjab",
  // Madhya Pradesh
  Indore: "Madhya Pradesh",
  Pithampur: "Madhya Pradesh",
  Rewa: "Madhya Pradesh",
  // West Bengal
  Kolkata: "West Bengal",
  "South 24 Parganas": "West Bengal",
  Bansbaria: "West Bengal",
  Siliguri: "West Bengal",
  Bardhaman: "West Bengal",
  Serampore: "West Bengal",
  "Jala Kendua": "West Bengal",
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
  Raipur: "Chhattisgarh",
  // Uttarakhand
  Haridwar: "Uttarakhand",
  // Andhra Pradesh
  Tirupati: "Andhra Pradesh",
  // Bihar
  Patna: "Bihar",
  Madhubani: "Bihar",
  // Kerala
  Thrissur: "Kerala",
  Ernakulam: "Kerala",
  // Dadra and Nagar Haveli
  Silvassa: "Dadra and Nagar Haveli",
  // Himachal Pradesh
  Nadaun: "Himachal Pradesh",
};

function locationFor(city: string): string {
  const cleanCity = city.split(",")[0].trim();
  if (!cleanCity) return "";
  const state = STATE_BY_CITY[cleanCity];
  return state ? `${cleanCity}, ${state}` : cleanCity;
}

// Literal-evidence-only technical spec extraction — same discipline as
// every prior batch's spec parser.
function parseSafetySpecs(title: string): string[] {
  const specs: string[] = [];
  const push = (label: string) => {
    if (!specs.includes(label)) specs.push(label);
  };

  const kgMatch = title.match(/(\d+(?:\.\d+)?)\s*[Kk]g\b/);
  if (kgMatch) push(`${kgMatch[1]} kg`);

  const mmMatch = title.match(/(\d+(?:\.\d+)?)\s*mm\b/i);
  if (mmMatch) push(`${mmMatch[1]}mm`);

  const inchMatch = title.match(/(\d+(?:\.\d+)?)\s*inch(?:es)?\b/i);
  if (inchMatch) push(`${inchMatch[1]} inch`);

  const ffpMatch = title.match(/\bFFP\s?([123])\b/i);
  if (ffpMatch) push(`FFP${ffpMatch[1]}`);

  const cutLevelMatch = title.match(/Cut\s*Level:?\s*(A[1-5])/i);
  if (cutLevelMatch) push(`Cut Level ${cutLevelMatch[1].toUpperCase()}`);

  const classMatch = title.match(/\bClass\s?([A-D])\b/);
  if (classMatch) push(`Class ${classMatch[1]}`);

  const isMatch = title.match(/\bIS\s?(\d{3,5})\b/);
  if (isMatch) push(`IS ${isMatch[1]}`);

  const enMatch = title.match(/\bEN\s?(\d{2,4})\b/);
  if (enMatch) push(`EN ${enMatch[1]}`);

  const layerMatch = title.match(/\b(single|double|triple)[\s-]*layer\b/i);
  if (layerMatch) {
    const l = layerMatch[1].toLowerCase();
    push(`${l.charAt(0).toUpperCase() + l.slice(1)} layer`);
  }

  return specs;
}

function rawRecordsForSubcategory(
  key: keyof typeof SOURCES,
  entries: Listing[]
): RawSupplierRecord[] {
  const { subcategory, group, url, sourceName } = SOURCES[key];
  const categories = Array.from(new Set(["Safety Equipment", group, subcategory]));

  return entries.map(([companyName, city, title, price, bizType]) => {
    const specs = parseSafetySpecs(title);
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

const SAFETY_HELMETS: Listing[] = [
  ["A1 Industry", "Mumbai", "Safety Helmet", "₹150/Piece"],
  ["Samarth Industries", "Kalyan", "Headlamp Safety Helmets", "₹3,000/Piece"],
  ["Hesham Industrial Solutions", "Vadodara", "Safety Helmet With Headlight", "₹950/Piece"],
  ["Jiya Engineering Company", "New Delhi", "Red Nap Allen Cooper Safety Helmet Model No 701", "₹115/Piece"],
  ["Milan Safety", "Mumbai", "Plastic Ventra Safety Helmet With Ventilation", "₹132/Piece"],
  ["DSK International", "Nadaun", "Orange HDPE Vista 8000 Safety Helmet for Construction", "₹110/Piece"],
  ["Taheri Enterprises", "Mumbai", "Plastic Udyogi Safety Helmet", "₹110/Piece"],
  ["Gravitech Industries", "Noida", "Gravitech Ratchet type Safety Helmet", "₹140/Piece"],
  ["UNM India", "Mumbai", "FRP Black and Yellow Alexandria Fireman Helmet", "₹500/Piece"],
  ["Shinde Fire Safety Products", "Navi Mumbai", "Yellow Ear Muffs Helmet, For Construction Sites", "₹525/Piece"],
  ["Imperial World Trade Private Limited", "Rajkot", "PVC Head Protection Hats, For Safety", "₹101/Piece"],
  ["Krishna Welding House", "New Delhi", "PVC LABOUR SAFETY HELMET", "₹28/Piece"],
  ["Ilika Inc", "Surat", "Plastic Nape Type Helmet", "₹99/Piece"],
  ["Vatsa Enterprises", "Agra", "Safety Helmet With Protective Peak And Slide Adjustment", "₹200/Piece"],
  ["Fidus India Automation Private Limited", "Gurugram", "PVC Toyo Safety Helmets", "₹7,050/Piece"],
  ["R. J. Electricals Private Limited", "New Delhi", "SAFETY HELMET WITH NAPE STRAP BAND ADJUSTMENT", "₹170/Piece"],
  ["Feetsmart Solutions", "Karnal", "PE Yellow Pvc Safety Helmet, Size: Small", "₹110/Piece"],
  ["Kewalson", "New Delhi", "ABS White H700 Series Industrial Safety Helmet", "₹545/Piece"],
  ["Safety Solutions", "New Delhi", "BLACK+DECKER BXHP0221IN-Y White Industrial Safety Helmet", "₹475/Piece"],
  ["ABM Corp", "Pimpri Chinchwad", "ABS Deltaplus Diamond V Baseball Cap Type Safety Helmet", "₹700/Piece"],
  ["Adinath Equipments Private Limited", "Ahmedabad", "Karam Safety Helmet", "₹50/Piece"],
  ["Safety Plus Engineering", "Mumbai", "Plastic Safety Helmet", "₹70/Piece"],
  ["Siddhi Vinayak Enterprise", "Ahmedabad", "APS-51 ALKO Plus Safety Helmet, PE", "₹85/Piece"],
  ["Siya Industries", "New Delhi", "Yellow Plastic Safety Helmet With Visor, Size: Large", "₹700/Piece"],
  ["JMD Helmets Private Limited", "New Delhi", "Unisex Safety Helmet", "₹45/Piece"],
  ["Jay Agenciez", "Surat", "White ABS Plastic Plastic Safety Helmets", "₹369/Piece"],
  ["SRV Corporation", "Ghaziabad", "PVC Yellow Karam Safety Helmet, Size: Medium", "₹240/Piece"],
];

const SAFETY_SHOES: Listing[] = [
  ["Sajid International", "Kanpur", "Industrial Safety Shoes", "₹600/pair"],
  ["Rose International", "Unnao", "safety shoes", "₹225/pair"],
  ["KNR Uniforms", "New Delhi", "Men's Safety Shoes", "₹290/pair"],
  ["Super Safety Services", "Mumbai", "Leather Antistatic Safety Shoes", "₹1,000/Pair"],
  ["Mangla Plastic Industries", "Bahadurgarh", "Mangla Tracy Ladies Safety Shoes", "₹1,199/pair"],
  ["R. J. Electricals Private Limited", "New Delhi", "TAISOR SFETY SHOES", "₹1,200/pair"],
  ["ABM Corp", "Pimpri Chinchwad", "Lemaitre Oxygen Safety Shoes", "₹1,600/pair"],
  ["Yaqoob Tanners", "Kanpur", "Zain Safety Shoes (SAND)", "₹1,342/pair"],
  ["Kinetic Polymers", "Hyderabad", "Static control shoes for explosive zones", "₹1,000/pair"],
  ["Hillson Footwear Private Limited", "Bahadurgarh", "We Fly -04 Safety Shoes", "₹1,099/pair"],
  ["Shashi India Private Limited", "New Delhi", "Safety Shoes", "₹800/pair"],
  ["Model Exims (India) Private Limited", "Kanpur", "Fiji", "₹900/Piece"],
  ["Unistar Footwears Private Limited", "Bahadurgarh", "Unistar ANTA 02(ISI) DD Black Grey Steel Toe PU Leather Safety Shoe", "₹1,369/pair"],
  ["Rehann Marine Services", "Mumbai", "Aura SD Safety Shoes", "₹1,999/pair"],
  ["Technocrat Polymers", "Bahadurgarh", "8 Inch Leather Safety Shoes", "₹350/pair"],
  ["Garg Footwear", "Bahadurgarh", "Labour Safety Shoes", "₹150/pair"],
  ["Mahadev Trading Co.", "New Delhi", "Landway Safety Shoe", "₹275/pair"],
  ["M/s Rajan Leather Store", "Agra", "House keeping / facility management Shoes", "₹275/pair"],
  ["Source India Shoes", "Noida", "Liberty Sporty Look Safety Shoes", "₹650/pair"],
  ["Safe Dot International", "New Delhi", "Industrial Safety Shoes Rexine", "₹200/pair"],
  ["MRK Engineering", "Chennai", "Coffer safety M-1013 High ankle", "₹900/pair"],
  ["Safehawk Workwear Private Limited", "Bahadurgarh", "Safehawk Black Safety Shoe", "₹449/pair"],
  ["Geekay Safety Products", "New Delhi", "Tiger Safety Shoes", "₹950/pair"],
  ["Metro Safety India Private Limited", "New Delhi", "Safetyrun S1P Industrial Safety Shoes", "₹1,000/pair"],
  ["Ram Industries", "Agra", "safety shoes", "₹249/pair"],
  ["Pradeep Shoes", "Agra", "Nitrile Safety Shoes", "₹490/pair"],
  ["Delhi Safety House", "New Delhi", "Leather Flourite Abrigo Safety Shoes", "₹750/pair"],
  ["Waltzer India", "Indore", "Power Safety Shoe", "₹398/pair"],
  ["Gujarat Safety", "", "Safety Shoes", "₹190/pair"],
  ["HK Fire And Safety System", "", "IS 15298 Safety Shoe", "₹220/pair"],
  ["Relex Footcare", "", "ISI Marked Safety Shoes", "₹450/pair"],
  ["Demax Ventures", "", "PG MAXX SAFETY SHOES", "₹790/pair"],
  ["Comfort Shoes", "", "Article 2005 Metal Free Coffer Safety Shoes", "₹1,000/Pair"],
  ["Safe Work Industry Private Limited", "", "Industrial Safety Shoes", "₹180/pair"],
  ["Buying Industries", "", "Hillson Safety Shoes", "₹500/pair"],
];

const SAFETY_GLOVES: Listing[] = [
  ["Saijee Impex", "Thane", "Safety Hand Gloves, For Industrial", "₹300/pair"],
  ["Shri Jagannath Industries", "Indore", "Nitrile Coated NNC1310 BB Safety Gloves, Free Size, Protection Type: Cut Resistant", "₹30/pair"],
  ["Gravitech Industries", "Noida", "Honeywell Workeasy Cut Protective Gloves 13G PU A2/B", "₹200/Pair"],
  ["Milan Safety", "Mumbai", "Jayco Cut Level 5 PU Coated Palm Coated Knit Wrist Hand Gloves (Size L)", "₹160/pair"],
  ["Chris Merchant Private Limited", "Chennai", "Cotton Knitted Hand Gloves", "₹9.35/pair"],
  ["Bombay Tools Center Bombay Pvt Ltd", "Mumbai", "Class 0 Electrical Insulating Gloves with ARC Flash Protection", "₹2,550/pair"],
  ["Shri Madhav Engineers", "Ghaziabad", "Latex Yellow Electrical Shockproof Safety Gloves", "₹400/pair"],
  ["Super Safety Services", "Mumbai", "Black & White Nitrile Palm Coated Knit Lined Safety Cuff Gloves, For Industrial, Size: 10", "₹35/Pair"],
  ["Redvie Projects", "New Delhi", "Seamless Knit PolyKor Blend Glove with Acrylic Liner Code 41-1415", "₹438/pair"],
  ["Samarth Industries", "Kalyan", "Nitrile Coated Chemical Resistant Glove, L (Large), Cut Level: A1", "₹40/Pair"],
  ["A I Sales Corporation", "Pune", "Latex / Rubber Fire Silver Gloves, Size: Free Size", "₹400/Pair"],
  ["Jiya Engineering Company", "New Delhi", "For Industrial Safety Hand Gloves", "₹45/Pair"],
  ["A S Enterprises", "Surat", "For Industrial Udyogi Gloves NNC 1310", "₹40/pair"],
  ["Balaji Industries", "Mumbai", "silver & Yellow Aluminised Aramid Hand Gloves with aramid Palm", "₹2,000/pair"],
  ["Ppe Brothers Industrial Supply", "New Delhi", "Anti Vibration Gloves", "₹1,200/pair"],
  ["Vatsa Enterprises", "Agra", "Safety Hand Gloves, For Construction", "₹42/pair"],
  ["Kabir Overseas", "Meerut", "Multicolor Latex / Rubber Safety Leather Gloves", "₹55/pair"],
  ["Unique Safety Services", "Mumbai", "Anti Vibration Gloves", "₹450/pair"],
  ["Haas Engineering Systems And Solutions Pvt. Ltd.", "Chennai", "For Industrial Anti Vibration Gloves", "₹1,450/Pair"],
  ["Add-On Safety & Surgicals Private Limited", "Mumbai", "Anti Puncture Gloves, Cut Level: A2", "₹2,999/Piece"],
  ["Taheri Enterprises", "Mumbai", "Kong Male Impact Resistance Gloves", "₹3,750/pair"],
  ["UNM India", "Mumbai", "White Colour Leather Hand Gloves, For Industrial, Size: Large", "₹19/Pair"],
  ["Labh Projects Private Limited", "Ahmedabad", "Industrial Safety Fabric Gloves for Hand Protection - Labh Group, S to XXL", "₹100/pair"],
  ["Byahut Scientico", "Jaipur", "BLACK Rexine Safe Well Gloves", "₹500/pair"],
  ["Enersafe Industry", "Ahmedabad", "Cotton Safety Hand Gloves, 14 inch", "₹22/pair"],
];

const SAFETY_GOGGLES: Listing[] = [
  ["Zymeck India Private Limited", "Ahmedabad", "Unisex Safety Goggles, Clear", "₹17.80/Piece"],
  ["Optical Traders", "Mumbai", "Protective Eye Glasses, Clear, Prescription Goggle", "₹18/Piece"],
  ["Super Safety Services", "Mumbai", "Sole Safe Rubber Goggles", "₹50/Piece"],
  ["Gravitech Industries", "Noida", "Honeywell 1005507 LG20 Indirect Vent Clear Polycarbonate Lens", "₹140/Piece"],
  ["Krishna Scientific", "New Delhi", "Elastic Band Transparent 3M 1621 Goggles, Ansi Z87.1-2003", "₹250/Piece"],
  ["Taheri Enterprises", "Mumbai", "Fiber White MSA Goggles, Thickness (millimetre): 1.5mm", "₹175/Piece"],
  ["Milan Safety", "Mumbai", "U D 91- udyogi Safety Goggles", "₹65/Piece"],
  ["Samarth Industries", "Kalyan", "Protective Safety Goggles, Transparent", "₹25/Piece"],
  ["Redvie Projects", "New Delhi", "Indirect Vent Goggle with Light Blue Body Code 251-5300-400-RHB", "₹630/Piece"],
  ["UNM India", "Mumbai", "Polycarbonate Construction Worker Goggle, Frame Type: Plastic", "₹90/Piece"],
  ["Haas Engineering Systems And Solutions Pvt. Ltd.", "Chennai", "Industrial Safety Glasses", "₹498/Piece"],
  ["Unique Safety Services", "Mumbai", "Polycarbonate Msa Safety Goggles, Frame Type: Plastic", "₹175/Piece"],
  ["Shri Jagannath Industries", "Indore", "Udyogi UD90 Anti Fog Goggle, Clear", "₹60/Piece"],
  ["DSK International", "Nadaun", "Anti Fog Clear Safety Goggles, Spectacle", "₹590/Piece"],
  ["Ilika Inc", "Surat", "1mm Polycarbonate Safety Goggles Clear Lens", "₹444/Piece"],
  ["Jiya Engineering Company", "New Delhi", "Suntech Polycarbonate Surgical Safety Goggles", "₹12/Piece"],
  ["A K Corp", "Mumbai", "Polycarbonate Safety Goggles", "₹20/Piece"],
  ["Royal International", "Jalandhar", "Safety Goggles", "₹68/Piece"],
  ["Arvind Industries", "Jaipur", "Polycarbonate Safety Gogle, Over The Glass (OTG)", "₹88/Piece"],
  ["A.S. International", "Ambala", "Clear Fiber Eye Protection Visor Goggles", "₹168/Piece"],
  ["Sharvik Impex India Private Limited", "Nagpur", "GOGGLES 1'S Zymeck", "₹38/Piece"],
  ["Kewalson", "New Delhi", "3M Polycarbonate Protective Eyewear, For Safety", "₹220/Piece"],
  ["Royal Traders", "Chandigarh", "Industrial Safety Goggle", "₹150/Piece"],
  ["Jaiswal Opticals", "Bengaluru", "Coronavirus Safety Goggles", "₹55/Piece"],
  ["Glass Agencies", "Ambala", "EROSE Safety Goggles", "₹45/Piece"],
  ["Shri Harihar LR", "Palwal", "Honeywell IESAFC10 - Safety Goggle A300 Clear Frame", "₹58/Piece"],
  ["Safety Solutions", "New Delhi", "Polycarbonate Honeywell S99 Anti Fog Goggles, ANSI", "₹70/Piece"],
  ["Poornarth Solutions", "New Delhi", "Chemical Splash Protection Eyewear, Kleenguard V80", "₹246/Piece"],
  ["Shiva Industries", "New Delhi", "SPROTECTION Clear Anti Fog Safety Goggles", "₹59/Piece"],
  ["Oriental Enterprises", "Thane", "3M Polycarbonate Smoke Lens Safety Eye Wear", "₹65/Piece"],
  ["Baroda Safety House", "Vadodara", "BSH V100 CL Industrial Safety Goggles, Clear", "₹24/Piece"],
  ["Taha International", "Mumbai", "Anti Fog Eye Wear Goggles", "₹50/Piece"],
  ["City Hardware & Welding Corporation", "Mumbai", "WELDMORE Unisex Gas Welding Safety Goggles", "₹22/Piece"],
  ["Prajesh Impex", "Hyderabad", "Karam Splash Goggles - ES009ECO, Clear", "₹140/Piece"],
  ["Shreenathji Welding And Safety Private Limited", "Ahmedabad", "3M 1611 SAFETY GOGGLES", "₹128/Piece"],
  ["Safe Hands Industrial Products", "Bengaluru", "Sunlite Safety Goggle, Clear", "₹25/Piece"],
  ["Riyanshi Fusion", "", "Udyogi UD 71 Safety Goggles", "₹600/Piece"],
  ["Optimus Safety Gear And Tools", "", "Udyogi UD 71 Safety Goggles", "₹35/Piece"],
  ["Garg Safety Products", "", "Perfect Safety Goggles", "₹16/Piece"],
  ["Golden Plastic Works", "", "Innovision Safety Goggles", "₹14/Piece"],
  ["Safety House India", "", "Industrial Safety Goggle", "₹125/Piece"],
  ["D.D.K Industries", "", "Industrial Safety Glasses", "₹10/Piece"],
  ["D K Safety And Welding Goods", "", "Sunrise Safety Goggles", "₹16/Piece"],
];

const FIRE_EXTINGUISHERS: Listing[] = [
  ["Fire Safety Devices Pvt. Ltd.", "Faridabad", "Class A 5 Kg Clean Agent Fire Extinguisher", "₹10,600/Piece"],
  ["A1 Industry", "Mumbai", "D Class Metal Fire Extinguisher, Capacity: 5 Kg", "₹9,500/Piece"],
  ["Kalpataru Industries", "Loni", "Carbon Di-Oxide Portable Fire Extinguisher, Capacity: 2Kg", "₹5,500/Piece"],
  ["Milan Safety", "Mumbai", "6 Kg Abc Dry Powder Fire Extinguisher", "₹1,085/Piece"],
  ["Super Safety Services", "Mumbai", "Fire Ball Extinguisher", "₹1,000/Piece"],
  ["Surinder And Company", "Ambala", "OEM Mild Steel Fire Extinguisher For Lab", "₹6,800/Piece"],
  ["Safe Pro Fire Services Private Limited", "Mumbai", "Safety Fire Extinguisher", "₹1,900/Piece"],
  ["Fire Engineering Technology", "New Delhi", "2 Kg ABC Powder Fire Extinguisher", "₹800/Piece"],
  ["Capital Fire.Com", "Gurgaon", "4 Kg Fire Extinguishers", "₹8,500/Piece"],
  ["Fire Knock", "Mumbai", "Fire Extinguisher - DCP Type 4 KG", "₹1,350/Unit"],
  ["SRV Corporation", "Ghaziabad", "4 Kg Fire Squad Fire Extinguisher", "₹5,800/Piece"],
  ["Siya Industries", "New Delhi", "Fire Extinguishers", "₹5,000/Piece"],
  ["Advanced Marketing", "Rajkot", "50 Ltr Mechanical Foam Fire Extinguisher, Type: m-foam", "₹5,200/Piece"],
  ["Athreya Enterprises", "Bengaluru", "Fire Extinguishers", "₹1,650/Kg"],
  ["Qutak Security Devices", "New Delhi", "Agni Dry Powder Type, 2 Kg", "₹899/Piece"],
  ["Pipla Safety Private Limited", "Noida", "Class C WET CHEMICAL TYPE FIRE EXTINGUISHER-9KG", "₹12,000/Piece"],
  ["Global Industries", "Greater Noida", "Impact Class D Fire Extinguisher (FOR METAL FIRES)", "₹11,500/Piece"],
  ["Florida International", "Mumbai", "Fire Extinguisher For All Types Of Fire", "₹850/Piece"],
  ["Mitras Technocrafts Private Limited", "New Delhi", "Mitras B,C CO2 Fire Extinguisher", "₹5,325/Piece"],
  ["Goyal Electric Works", "New Delhi", "Mild Steel Portable Fire Extinguisher", "₹750/Piece"],
  ["Fire Oxine Safety Industries", "Mumbai", "5kg Modular Clean Agent Fire Extinguisher", "₹8,000/Piece"],
  ["Rajpati Enterprise", "Kolkata", "Fyrax Water CO2 Type Fire Extinguisher, For Industrial Use, Capacity: 9 Kg", "₹1,200/Unit"],
  ["ILP Safety & Security Services Private Limited", "Chennai", "Co2 Fire Extinguisher (6Kg)", "₹2,200/Piece"],
  ["Swatantra Enterprises", "Kolkata", "4Kg 60 Degree Celcius Fire Extinguisher", "₹1,000/Piece"],
  ["Hussaini Sales Corporation", "Chennai", "Class A EXTINGUISHER ABC 6 KG SAFEPRO SP6000", "₹665/Piece"],
  ["K.K. Industries", "New Delhi", "6kg B Fire Extinguisher", "₹1,800/Piece"],
];

const FIRE_HOSE: Listing[] = [
  ["Jaideo Automation India Private Limited", "Jaipur", "Fire Hose Pipe", "₹4,900/Piece"],
  ["Kalpataru Industries", "Loni", "KalpEX CP Fire Hose", "₹6,000/Roll"],
  ["JB Pumps India Private Limited", "Ahmedabad", "Fire Hose Pipe", "₹85/Meter"],
  ["Excel Metal & Engg Industries", "Mumbai", "Fire Hose", "₹1,000/Piece"],
  ["A1 Industry", "Mumbai", "Rrl Hose Pipe With S S Coupling", "₹3,200/Piece"],
  ["UNM India", "Mumbai", "Orange Fire Hose", "₹1,150/Unit"],
  ["Unique Safety Services", "Mumbai", "Fire Fighting Hose", "₹3,050/Piece"],
  ["Super Safety Services", "Mumbai", "Fire Hoses Type A", "₹3,500/Piece"],
  ["Varuney Manufacturing Industries", "Ahmedabad", "Fire Hose Pipe", "₹98/Meter"],
  ["Capital Fire.Com", "Gurgaon", "FIRE HOSE REEL PIPE TYPE 1 30MTR", "₹1,250/Piece"],
  ["Safety Plus Engineering", "Mumbai", "Rrl Fire Hose Type A", "₹2,300/Unit"],
  ["Advanced Marketing", "Rajkot", "25mm Thermoplastic Hose", "₹45/Meter"],
  ["Qutak Security Devices", "New Delhi", "Length: 30 mtr RRL Hose Pipe Red", "₹7,550/Piece"],
  ["Qutak Security Devices", "New Delhi", "Length: 30 mtr RRL Fire Hose Pipe white", "₹6,500/Piece"],
  ["Siya Industries", "New Delhi", "Fire Hose Pipe", "₹6,200/Piece"],
  ["Milin Tubes", "Chhatral", "Fire Hose Pipe", "₹41/Meter"],
  ["Add Mechatronics", "Ahmedabad", "Fire Fighting RRL Hose Pipes Type A as per IS 636", "₹3,500/Piece"],
  ["RR Incorporation", "New Delhi", "38mm Synthetic Fire Hose Pipe", "₹60/Meter"],
  ["RR Incorporation", "New Delhi", "200mm PVC Lined Canvas Hose Pipe", "₹145/Meter"],
  ["Mitras Technocrafts Private Limited", "New Delhi", "High Pressure Fire Hose", "₹490/Meter"],
  ["Divya Jyot Pipe Stores", "Mumbai", "Fire Hose Pipe", "₹150/Meter"],
  ["Hiren Industrial Corporation", "Mumbai", "Fire Hose Pipe With Ss Coupling", "₹1,500/Piece"],
  ["Fire Oxine Safety Industries", "Mumbai", "63mm Dia 15 Mtr Long Rrl Hose Pipe", "₹4,850/Piece"],
  ["DT Engineering Solutions", "New Delhi", "Reinforced Rubber Lined (RRL) Fire Hose Type A ISI Marked", "₹3,050/Piece"],
  ["Jagit India Private Limited", "Pune", "Canvas Fire Fighting Hose Pipe", "₹110/Meter"],
  ["First Fire Solutions", "Bengaluru", "Fire Canvas Hose Pipe", "₹3,500/Piece"],
  ["Shah Bhogilal Jethalal And Brothers", "Kalol", "Fire Delivery Hose Pipe Type _A", "₹3,200/Piece"],
  ["Juzer Sales Corporation", "Chennai", "7.5 Mtr Rrl Fire Hose", "₹2,900/Piece"],
  ["City Industrial Traders", "Chennai", "RRL Hose, For Fire Fighting", "₹3,100/Piece"],
  ["Hosexperts", "Greater Noida", "Fire Hose Canvas", "₹1,430/Piece"],
  ["Vantage Rubber Co.", "New Delhi", "Fire Hose Pipe", "₹50/Meter"],
  ["Grooj Enterprises", "Pune", "Fire Hose Pipe", "₹3,000/Piece"],
  ["Global Industrial Solutions", "Ghaziabad", "Canvas Hose Pipe, For Water Delivery", "₹32/Meter"],
  ["Feurite Fire And Safty Private Limited", "Ernakulam", "24 Bar Fire Hose", "₹2,993/Unit"],
  ["Tiger Rubber Co.", "New Delhi", "Fire Hose Pipe", "₹30/Meter"],
  ["Parsv Enterprises", "New Delhi", "PU And PVC Fire Fighting Hoses", "₹85/Meter"],
  ["Swatantra Enterprises", "Kolkata", "30m RRL Hose Pipe", "₹5,200/Meter"],
  ["Real Value Safety Consultants", "New Delhi", "Length: 15 mtr Newage RRL Premier Fire Hose", "₹3,200/Piece"],
  ["Raj Pipe Industries", "Chennai", "10 - 30 M Rubber Fire Hose, 1.6 Mpa", "₹3,600/Piece"],
  ["Archies Fire Safety Services", "Rewa", "4 inches Ms Fire Fighting Pipe", "₹2,000/Meter"],
  ["The Fire Wala", "New Delhi", "Hose reel pipe ( Only pipe )", "₹999/Piece"],
  ["The UP2 Marc Solution Sales Division", "Indore", "Fire Fighting Hose Pipe", "₹5,200/Piece"],
  ["Labdhi Engineering Co.", "Mumbai", "PVC CP Fire Hose, Size: 20-40 M", "₹2,211/Piece"],
  ["Vedant Corporation", "Mumbai", "Nitrile Synthetic Rubber 10-30 M B Type Fire Hose", "₹75/Meter"],
  ["Manx Impex", "New Delhi", "MANXPOWER Fire Hose", "₹200/Meter"],
];

const FIRE_SUPPRESSION: Listing[] = [
  ["Manlon Engineers Private Limited", "Ahmedabad", "Fire Suppression Tubes", "₹12,500/Piece"],
  ["Fire Safety Devices Pvt. Ltd.", "Faridabad", "40L Novec 1230 Total Flooding System, 10-Sec Discharge - Server Room", "₹1,62,000/Piece"],
  ["Kalpataru Industries", "Loni", "Fm 200 Fire Suppression", "₹95,000/Piece"],
  ["Kalpataru Industries", "Loni", "GAS SUPPRESSION SYSTEM FOR UPS ROOM", "₹1,95,000/Piece"],
  ["Ameen Ehs Hub", "Surat", "Hospital Clean Agent Flooding Suppression System", "₹50,000/Piece"],
  ["Evarson Alarm And Automation", "Rajkot", "Evarson Fire Suppression System Tube", "₹52,000/System"],
  ["Milan Safety", "Mumbai", "Fire Suppression Systems, For Commercial", "₹10,000/Piece"],
  ["Myport Services India Private Limited", "Mumbai", "Automatic Fire Suppression System", "₹1,50,000/Piece"],
  ["Logix Safety Engineers", "New Delhi", "Fm 200 Gas Suppression System", "₹90,000/Set"],
  ["Glyptic", "Bardhaman", "Fipron Cord-Type Electrical Panel Suppression", "₹10,000/Piece"],
  ["A1 Industry", "Mumbai", "Fire Suppression Systems", "₹45,000/Piece"],
  ["Supremex Equipments", "Mumbai", "Electrical Cabinet Fire Suppression System, Capacity: 9 Kg", "₹70,000/Set"],
  ["Haas Engineering Systems And Solutions Pvt. Ltd.", "Chennai", "UL Listed Mild Steel Fire Suppression System", "₹1,50,000/Piece"],
  ["Accruepole Private Limited", "Mumbai", "Fire Suppression Systems", "₹1,80,000/Piece"],
  ["Fitech Engineers Private Limited", "Navi Mumbai", "Inergen Fire Suppression System", "₹1,20,000/Set"],
  ["Sri Venkateshwara Engineering", "Bengaluru", "Inert Gas Inergen Ig 541 55 100 01 Based Systems, For Industrial", "₹5,000/Piece"],
  ["Ensave Energy Private Limited", "Ahmedabad", "HFC236fa Class A Nasa Tubing Based Automatic Fire Suppression", "₹1,00,000/Piece"],
  ["Fire Engineering Technology", "New Delhi", "Fire Suppression Systems", "₹45,000/Piece"],
  ["Fire Engineering Technology", "New Delhi", "Automatic Fire Suppression System", "₹2,50,000/Piece"],
  ["Delux Industrial Gases", "Pune", "Carbon Steel Novec 1230 Fire Suppression System", "₹29,901/Set"],
  ["Safe Pro Fire Services Private Limited", "Mumbai", "Tubing Fire Suppression System", "₹30,000/Set"],
  ["Goldline Security Systems", "New Delhi", "Bus Fire Suppression System Automatic Gas Fire Safety Set", "₹2,62,435/Piece"],
  ["Star Electronic Concepts", "Thane", "NAFS125 Fire Suppression System", "₹1,00,000/Unit"],
  ["Vighnaharta Technologies Private Limited", "Pune", "TrueSafe TSGR22S Gas Release Panel with 2 Sequential RACs", "₹23,800/Piece"],
  ["J3 Technology", "Navi Mumbai", "Fire Suppression Systems", "₹80,000/Set"],
  ["SRV Corporation", "Ghaziabad", "23 V Gas Fire Suppression System, For Electrical Panel", "₹5,000/Piece"],
  ["Safety Plus Engineering", "Mumbai", "Fire Detection Tube Suppression System, For Commercial", "₹50,000/Piece"],
  ["Pipla Safety Private Limited", "Noida", "AUTOMATIC DIRECT FIRE SUPPRESSION SYSTEM FOR EFFECTIVE FIRE", "₹3,00,000/Piece"],
  ["Global Industries", "Greater Noida", "Firetarce type Fire Suppression System", "₹90,000/Piece"],
  ["K.K. Industries", "New Delhi", "Dry Chemical Fire Suppression System", "₹4,30,000/Piece"],
  ["K.K. Industries", "New Delhi", "HFC Tube base System", "₹1,50,000/Piece"],
  ["Mars Fire & Security", "Secunderabad", "Automatic Fire Suppression System", null],
  ["Nesus Fire", "Delhi", "Argonite Systems", null],
  ["Allied Fire Protection", "", "Automatic Fire Suppression System", "₹5,550/Piece"],
  ["MAYA FIRE PROTECTION SYSTEMS", "", "Gaseous Fire Suppression System", null],
  ["Quick Flameprotect Technologies Private Limited", "", "Micro Environment Fire Suppression", "₹42,500/Piece"],
  ["UK Fire Solutions", "", "FK5112 Gas Fire Suppression System", "₹15,000/Unit"],
];

const SAFETY_SIGNAGE: Listing[] = [
  ["AMPS Process", "Mumbai", "Industry Safety Signages", "₹30/Piece"],
  ["Hesham Industrial Solutions", "Vadodara", "Aluminium Green/Red Double Side Emergency Exit Signage", "₹4,000/Piece"],
  ["C B M Industrie Private Limited", "New Delhi", "Reflective Industrial Road Traffic Safety Signage", "₹1,200/Piece"],
  ["Super Safety Services", "Mumbai", "Vinyl Red & Yellow Mandatory Cautionary Signages, For Industrial", "₹230/Piece"],
  ["Saijee Impex", "Thane", "Industrial Safety Signage", "₹400/Piece"],
  ["Shinde Fire Safety Products", "Navi Mumbai", "Red PVC Fire Safety Signage", "₹5,500/Piece"],
  ["National Process Private Limited", "Ahmedabad", "Square White,Black & Red 160052 Spontaneously Combustible Signs Sticker", "₹130/Piece"],
  ["Supremex Equipments", "Mumbai", "Green Acrylic First Aid Safety Signs, For Hospital, Guide Sign", "₹750/Piece"],
  ["UNM India", "Mumbai", "Red Safety Signage Board, For Industrial, Aluminium", "₹85/Piece"],
  ["Milan Safety", "Mumbai", "Safety Signage Know the Signs, Stay Protected", "₹220/Piece"],
  ["Shree Enterprise", "Mumbai", "Night Glow Foam Sign Boards / Signage Board", "₹50/sq ft"],
  ["CMAD Engineering Solution", "New Delhi", "Rectangular Green Assembly Area Safety Signage", "₹3/Square Inch"],
  ["Unique Safety Services", "Mumbai", "Mandatory Signage System", "₹45/Piece"],
  ["SKP Automation Systems", "Greater Noida", "Safety Signage", "₹1,500/Piece"],
  ["Finetech Systems", "Tiruppur", "FINE Edge Light Signage - 4016", "₹3,800/Piece"],
  ["Asian Loto Corporation", "Faridabad", "Multicolor Ladder Safety Banner Do Not Climb", "₹200/Piece"],
  ["LTS Road Safety", "New Delhi", "Rectangular Safety Signage Board", "₹600/Piece"],
  ["Amba Chem", "New Delhi", "ACP Sheet Triangle Photoluminescent Safety Signage", "₹4/Square Inch"],
  ["Sarita Enterprises", "Panipat", "Zuzu Safety Sign Gobo Projection Light", "₹9,500/Piece"],
  ["Fine Tech Systems", "Avinashi", "Red And Green Aluminum Fine LED Exit Light Edge Lite 4016", "₹2,600/Piece"],
  ["Royal Traders", "Chandigarh", "Metal Flex Sign - Board", "₹550/Piece"],
  ["Sunrise Overseas", "New Delhi", "Traffic Safety Signage Manufacturers", "₹975/piece", "manufacturer"],
  ["Eshark Digital World Private Limited", "Chennai", "Zeera crossing safty sign in junction", "₹24,500/Piece"],
  ["YNM Pan Global Trade Pvt. Ltd.", "Secunderabad", "Informatory Sign Boards", "₹30,000/Piece"],
  ["Illumination India", "Vasai", "Fire Exit Sign Board - Acrylic 200 x 300 mm", "₹2,400/Piece"],
  ["Siya Industries", "New Delhi", "Rectangular Multicolor Safety Sign Boards", "₹180/Piece"],
  ["K T Automation India", "Vadodara", "KTI Customized Safety Signages", "₹25/Piece"],
  ["R R Engineers", "Raipur", "Safety Signage Board", "₹8,600/Piece"],
  ["Nisarg", "Ahmedabad", "Safety Signage", null],
  ["Super Co.", "Kalyan", "Safety Signs", null],
  ["Atco Mart", "Mumbai", "Safety Signage", null],
  ["Cyber Zone", "", "Aluminium Safety Signage", "₹400/Piece"],
  ["Sanjeet Graphics", "", "10mm Sun Board Safety Signage", "₹120/sq ft"],
  ["Siddhi Vinayak Enterprises", "", "Safety Sign Board", "₹180/Square Feet"],
  ["Suman Sinages", "", "Signages for Traffic Areas", "₹250/Piece"],
  ["Saurabh Enterprise", "", "Industrial Safety Sign Board", "₹216/Piece"],
  ["Ashirwad Corporation", "", "Fire Safety Signage Board", "₹124/Piece"],
  ["B.K. Advertising", "", "Safety Sign Board", "₹200/sq ft"],
];

const BARRICADES: Listing[] = [
  ["Milan Safety", "Mumbai", "Orange Baricates Plastic Road Barricade", "₹3,250"],
  ["Axnoy Industries LLP", "Mumbai", "AXNOY 2 Mtr Water Fillable Traffic Barrier (Heavy Duty)", "₹4,500"],
  ["UNM India", "Mumbai", "Yellow Plastic Traffic Barrier", "₹4,500"],
  ["Swift Technoplast Private Limited", "Navi Mumbai", "Yellow LLDPE Road Safety Bullnose Barricade, Traffic Barrier", "₹18,035"],
  ["Taheri Enterprises", "Mumbai", "Road Safety Plastic Barricade", "₹2,750"],
  ["Fibrecrafts India", "Pune", "A Frame Barricade Red Crash Barrier Barricades", "₹3,000"],
  ["Krishnavi India", "New Delhi", "KRISHNAVI Red Plastic Road Barricade", "₹599"],
  ["Labh Projects Private Limited", "Ahmedabad", "Plastic Road Safety Barricade - Labh Group", "₹2,500"],
  ["Amba Chem", "New Delhi", "Plastic Barricade", "₹2,400"],
  ["DKNV Engineering Pvt. Ltd.", "Silvassa", "DKNV Red And Yellow Plastic Traffic Barrier, 10 Kg", "₹2,500"],
  ["YNM Pan Global Trade Pvt. Ltd.", "Secunderabad", "Plain Top Plastic Road Barricade (Water Filled)", "₹1,350"],
  ["LTS Road Safety", "New Delhi", "Yellow Plastic Road Barricade", "₹1,850"],
  ["Sunrise Overseas", "New Delhi", "Water Filled Red Plastic Road Barricade", "₹1,000"],
  ["H2 Safety India Private Limited", "New Delhi", "H2EB2 Red Plastic Expandable Barrier, 6.5kg", "₹4,500"],
  ["Safeness Quotient Limited", "Mumbai", "Yellow And Black Plastic Checkpost Barricade", "₹2,500"],
  ["Seyon Industries", "New Delhi", "Water Filled Red Plastic Barricade", "₹1,700"],
  ["Jamdagni Safety India Co.", "New Delhi", "Water Filled Red Plastic Road Barricade", "₹1,700"],
  ["Vedant Corporation", "Mumbai", "Road Safety Plastic Checkpost Barricade", "₹2,700"],
  ["Shiv Safety Solutions LLP", "Mumbai", "L Type Jersey Barricade", "₹2,500"],
  ["HDSAFE Industrial Solutions LLP", "Chennai", "Road Safety Plastic Barricade", "₹1,750"],
  ["Futurvista", "Kalyan", "Plastic Road Barricade", "₹600"],
  ["M.A. Trading Corporation", "Kolkata", "Road Safety Red Plastic Barricade, 7KGS", "₹2,553"],
  ["Pioneer Enterprises", "New Delhi", "Plastic Barricade Portable Barricades With Print", "₹3,999"],
  ["Oriental Enterprises", "Thane", "Three Piece Barricade", "₹3,950"],
  ["Speciality Safety Engineers", "Mumbai", "Airport Interlocking Barricade", "₹5,000"],
  ["Taha International", "Mumbai", "Red Plastic Road Barricade", "₹1,775"],
  ["Avnte India", "Bengaluru", "flat type Red Plastic Road Barricade", "₹4,200"],
  ["Aakash Safety Technologies", "New Delhi", "Road Safety Plastic Barricade", "₹2,850"],
  ["National Safety Products", "New Delhi", "Water Filled Plastic Road Barricade", "₹2,850"],
  ["IB Monotaro Private Limited", "New Delhi", "Ladwa 8.3 Feet Foldable & Expandable Red Barricade", "₹2,740"],
  ["Parth System Repair And Fire", "Indore", "BDI Plastic Barricade 2 mtr", "₹4,200"],
  ["Gravium Enterprises", "Mumbai", "2 Mtr 3 PC LLDPE Fence Barrier", "₹2,850"],
  ["Shree Vinayak Enterprise", "Ahmedabad", "Road Safety Plastic Barricade", "₹1,300"],
  ["Araa Industrial Products", "Mumbai", "Water Filled 2 Meter Plastic Barricade", "₹6,800"],
  ["Preksha Polymers And Safety Industries", "Ghaziabad", "Red Plastic Check Post Barricade ACE ARB-3", "₹7,000"],
  ["Advanced Techno Engineers", "Kota", "Plastic Barricade", "₹4,000"],
  ["Kalyani Enterprises", "Navi Mumbai", "Plastic Fence Barricade with Sign Board and Wheels", "₹2,200"],
  ["Big Essentials", "Bengaluru", "Red Plastic Barricade", "₹1,000"],
  ["Steel Centre", "Boisar", "Road Plastic Barricade", "₹2,000"],
  ["Vihan Solutions", "Saphale", "2 Meter Barricade", "₹3,400"],
  ["Amit Road Safety", "New Delhi", "Plastic Barricade", "₹2,800"],
  ["Ganeshchhaya Enterprise", "Vadodara", "Plastic Barricade", "₹2,950"],
  ["R.C.Ventures", "Bengaluru", "Water Filled Full Height Metro Cover Barricade", "₹7,500"],
  ["U Force Enterprises", "Chennai", "Plastic Barricade Low Price In Chennai", "₹2,450"],
  ["Paramide Safety Solutions", "Mumbai", "Llpde Plastic Checkpost Barricade", "₹3,000"],
  ["Shree Safety Services", "Mumbai", "Durable Plastic Expandable Road Barrier 2.5 Mtr", "₹1,965"],
  ["Glorious Enterprises", "New Delhi", "Plastic Fence Barricade", "₹5,100"],
  ["Suraksha Suppliers", "Bengaluru", "Plastic Fence Barricade, For Road Safety", "₹3,250"],
  ["Vinayaka Safety Equipments", "Hyderabad", "Plastic Barricade", "₹3,000"],
  ["Nexson Lifecare", "Chandgad", "Road Safety Plastic Barricade", "₹2,400"],
  ["Kavya Enterprises", "Meerut", "Red Plastic Road Barricade", "₹2,200"],
];

const SAFETY_CONES: Listing[] = [
  ["Fibrecrafts India", "Pune", "Fiberglass FRP Road Safety Cone, 750 mm,1000 mm", "₹600"],
  ["Vin Dip India Pvt. Ltd.", "Hyderabad", "Reflective Traffic Cone", "₹190"],
  ["Swan Machine Tools Private Limited", "Ahmedabad", "Reflective Traffic Cone", "₹700"],
  ["Jiya Engineering Company", "New Delhi", "PVC Road Safety Cone", "₹120"],
  ["Taheri Enterprises", "Mumbai", "Reflective Traffic Cones, 8 inch", "₹650"],
  ["Milan Safety", "Mumbai", "750mm Rubber Traffic Cone with Reflective Tape", "₹200"],
  ["A I Sales Corporation", "Pune", "Plastic Retractable Traffic Cone Topper", "₹350"],
  ["LTS Road Safety", "New Delhi", "Orange,Black and White 750mm Rubber Base Traffic Cone", "₹150"],
  ["Amba Chem", "New Delhi", "Plastic Orange Reflective Traffic Cones, 30 inch", "₹150"],
  ["Siya Industries", "New Delhi", "Conical Red Road Safety Traffic Cone", "₹225"],
  ["Krishna Enterprises", "Madhubani", "Conical Red,Silver and Black Road Safety Cones", "₹400"],
  ["Sunrise Overseas", "New Delhi", "ABS Plastic Traffic Safety Cones", "₹580"],
  ["YNM Pan Global Trade Pvt. Ltd.", "Secunderabad", "Road Safety Cone", "₹360"],
  ["SRV Corporation", "Ghaziabad", "Orange Plastic 12 Inch Reflective Safety Cones", "₹510"],
  ["H2 Safety India Private Limited", "New Delhi", "Square Base Orange FLEXIBLE TRAFFIC CONE", "₹600"],
  ["Eagle Eye Traffic Safety Products", "New Delhi", "2 Kg Plastic Cone With Rubber Base", "₹130"],
  ["Safeness Quotient Limited", "Mumbai", "Hexagonal Traffic Cones, 4.2 Kg", "₹400"],
  ["Pravina Enterprises", "New Delhi", "Conical red/orange full flexible cone", "₹330"],
  ["Jamdagni Safety India Co.", "New Delhi", "Red Plastic Hexagonal Reflective Safety Cone", "₹400"],
  ["Scope Chemicals Private Limited", "Mumbai", "TRAFFIC CONE: PE PLASTIC- 1000mm", "₹400"],
  ["Metro Safety India Private Limited", "New Delhi", "Red LDPE Metro Roto Cones Traffic Cone Road Safety Cone", "₹200"],
  ["Seyon Industries", "New Delhi", "Reflective Traffic Cone", "₹450"],
  ["Eben Stones Private Limited", "Bengaluru", "Orange Plastic Road Safety Reflective Traffic Cone", "₹250"],
  ["Treadsafe Engineers India Private Limited", "Bahadurgarh", "Retractable Traffic Cones", "₹550"],
  ["Waltzer India", "Indore", "Orange Pvc Road Safety Cone", "₹200"],
  ["Shiv Safety Solutions LLP", "Mumbai", "Road Safety Cones", "₹525"],
  ["Onkar Nath Rajeev Gupta", "Prayagraj", "Reflective Traffic Cone, 0.550 Kg", "₹300"],
  ["Balaji Enterprises", "Pune", "REFLECTIVE TRAFFIC CONE", "₹600"],
];

const SAFETY_NETS: Listing[] = [
  ["S M Enterprise", "Mumbai", "Yellow Salamah Safety Net, Polypropylene", "₹5/sq ft"],
  ["S M Enterprise", "Mumbai", "Green Garware 2.5Mm Triple Layer Safety Net", "₹34/Sq Ft"],
  ["Milan Safety", "Mumbai", "HDPE Braided Safety Net, For Construction", "₹110/sq ft"],
  ["Aardor Ventures LLP", "New Delhi", "Construction Scaffolding Debris Net, 2.5 mm", "₹70/sq ft"],
  ["Energy Solutions", "Ambala", "Plastic Safety Nets", "₹1,200/Unit"],
  ["Shri Jagannath Industries", "Indore", "Udyogi SAFETY NET DOUBLE LAYER SIZE 10 X 5 MTR", "₹5,000/Piece"],
  ["D.D.International", "Ambala", "D.D. International White Safety Net", "₹100/sq ft"],
  ["Unique Safety Services", "Mumbai", "Safety Net", "₹65/sq ft"],
  ["Unique Safety Services", "Mumbai", "U-Safe Yellow Gangway Safety Net", "₹250/Sq ft"],
  ["Vatsa Enterprises", "Agra", "SAFETY NET 1 roll approx. 40mtr x 1mtr", "₹1,152/sq ft"],
  ["Super Safety Services", "Mumbai", "Yellow Construction Safety Nets", "₹75/sq meter"],
  ["Hi Bro Product", "New Delhi", "5 mm Nylon Rope Net", "₹13/sq ft"],
  ["ABM Corp", "Pimpri Chinchwad", "High Strength Polymer Udyogi SN-003 Safety Net", "₹75/sq ft"],
  ["Rajsons Marketing Private Limited", "Ahmedabad", "HDPE Container Safety Net (Knotted, Single Layer, 6mm)", "₹1,100/sq ft"],
  ["Siya Industries", "New Delhi", "Safety Net", "₹75/sq ft"],
  ["Supreme In Safety Services", "Mumbai", "Polypropylene,Nylon Construction Safety Nets", "₹80/sq ft"],
  ["Shiva Industries", "New Delhi", "Braided Safety Net", "₹125/sq meter"],
  ["S. S. International", "New Delhi", "Plain Pp Human Rescue Net", "₹14/sq ft"],
  ["Hussaini Sales Corporation", "Chennai", "3 Layer Safety Net, 100 mm (4 inch), 12mm", "₹60/sq meter"],
  ["Sonu Sports Co.", "Meerut", "Blue Construction Sefty Net, Nylon", "₹7/sq ft"],
  ["Patel Safety Nets", "Mumbai", "Single Layer Double Cord Safety Net", "₹9/sq ft"],
  ["Balaji Safety Projects", "Mumbai", "Passing Type Safety Nets", "₹100/sq meter"],
  ["Umiya Polymers", "Bhavnagar", "Umiya Plain Safety Net, For Industrial, HDPE,PP", "₹225/sq ft"],
  ["Kay Enn Enterprises", "New Delhi", "HDPE Construction Safety Nets, 30 Sq Meter", "₹60/sq meter"],
  ["AMZ Nylon Nets", "New Delhi", "50x50 Feet Yellow Nylon Safety Net", "₹45/sq ft"],
  ["Nuovafil & Infoteck Pvt. Ltd.", "Coimbatore", "Container Cargo Safety Net", "₹12,500/Piece"],
  ["Mahima Industries", "Kolkata", "4 mm Safety Net, Net Layer: Double Layer", "₹60/Square Meter"],
  ["Amit Agroplast", "Ahmedabad", "HDPE Green Polypropylene Safety Net", "₹70/Square Meter"],
  ["Mehta Safety Products", "Surat", "Black Polyester Fall Protection Safety Net", "₹75/Square Meter"],
  ["Barkaat Packaging", "Mumbai", "Industrial Use 6 MM Knotted Double Layer Safety Nets", "₹13/sq ft"],
  ["Anand Safety House", "Ahmedabad", "Blue and Yellow HDPE Safety / Industrial Net", "₹58/Piece"],
  ["Prajesh Impex", "Hyderabad", "Safety Net s", "₹55/Square Meter"],
  ["True Value Safety Solution", "Salem", "Blue Nylon Safety Net", "₹145/sq ft"],
  ["Triplex Poly Rope Industries", "New Delhi", "Green Braided Rope Safety Net", "₹125/Square Meter"],
  ["Onkar Nath Rajeev Gupta", "Prayagraj", "Safety Net", "₹140/sq ft"],
  ["Bell View Enterprises", "Mumbai", "YASMEE HDPE Double Cord Net", "₹6.50/sq ft"],
  ["R.S. Enterprise", "Guwahati", "HDPE Construction Safety Nets, Packaging Type: Roll", "₹8/Square Feet"],
  ["Sri Vallabh Enterprises", "Mumbai", "Nylon Gangway Safety Net", "₹25/Piece"],
  ["Shree Enterprises", "Vadodara", "White Nylon Safety Net", "₹10/Square Feet"],
  ["Sahil Net Maker", "Meerut", "Safety net", "₹899/Square Meter"],
  ["SK Road Safety Industries", "Ghaziabad", "Double lair Safety Net", "₹55/Square Meter"],
  ["P.P. Plastic & Packaging & Material Supplier", "Indore", "Blue PP Construction Safety Nets, Polypropylene", "₹9/Sq ft"],
  ["Kaalbhairav Enterprises", "", "2mm Double Cord Single Layer Safety Net", "₹38/Square Meter"],
  ["Rainbow Tarpaulins Industries", "", "Nylon Construction Safety Nets", "₹120/Square Meter"],
  ["Vidhata Netting Solutions", "", "Construction 3 Leyar Safety Net Rope Net", "₹110/Square Meter"],
  ["GSR India", "", "Safety Net", "₹10/sq ft"],
  ["Bhagwati Enterprises", "", "Navpoly Safety Net Triple Layer", "₹30/sq ft"],
  ["Ajwa Net Polyfils", "", "Container Safety Net", "₹800/Piece"],
  ["True Alliance", "", "4MM KNOTTED DOUBLE LAYER SAFETY NETS", "₹5.50/sq ft"],
];

const GAS_DETECTION: Listing[] = [
  ["Instrumentation", "Coimbatore", "Smart Gas Detector SF00001396", "₹21,840"],
  ["Global Electrical & Automation (Naarvi Group Company)", "New Delhi", "Industrial Gas Detector", "₹28,000"],
  ["Unitech Technocrats Private Limited", "Vadodara", "Hydrogen Sulphide Gas Detector", "₹25,000"],
  ["Applied Techno Engineers Private Limited", "Vasai", "Wall Mounted Ethylene Oxide (C2H4O) Gas Detector Model ATS 109TD", "₹28,500"],
  ["Adrija Scientific Instrument Company", "Kolkata", "Portable Multi Gas Detector Environmental Benzene Monitor", "₹5,50,000"],
  ["Alvi Automation (India) Private Limited", "Jaipur", "50 MSR Germany Single Point Controller", "₹70,000"],
  ["Max LT Technologies LLP", "Gurugram", "Det-tronics Opgd Line-of-sight (Los) Infrared Hydrocarbon Gas Detector", "₹4,00,000"],
  ["Tekglobal Technologies", "Chennai", "Olct 100 C Fixed Gas Detector", "₹75,000"],
  ["Nunes Instrumentation", "Coimbatore", "Sulfur Dioxide Gas Sensor Transmitter SF00001993", "₹58,000"],
  ["Alfa Engineering Solutions", "Panvel", "Bedfont 0-500ppb Gastrolyzer Breath Hydrogen Monitor", "₹3,00,000"],
  ["Qands Services & Technologies LLP", "Faridabad", "MX 43 Gas Detection Controller", "₹1,60,000"],
  ["XTech Lab Supplies", "New Delhi", "GD-02 Portable Combustible Gas Detector Color Screen Methane Propane Isobutane Monitor", "₹4,650"],
  ["Veena Industrial Automation & Control Co.", "Thane", "Riken Keiki Gas Detectors", "₹20,000"],
  ["Pci Analytics Private Limited", "Thane", "Gas Detection", "₹83,000"],
  ["Ace Instruments", "Hyderabad", "Portable Single Gas Detector Bosean BH-90A LEL (Catalytic)", "₹16,531"],
  ["Super Safety Services", "Mumbai", "Portable Gas Detector, Semi-conductor Pressure Sensor", "₹25,000"],
  ["Unique Safety Services", "Mumbai", "Crowcon Gas Detector", "₹41,500"],
  ["Vidhyut Engineering", "Bhavnagar", "GG CL2 B CTI Gas Detector", "₹65,000"],
  ["Manish Tradelink", "Vapi", "Gas Detection System", "₹50,000"],
  ["Swastik Scientific Instruments Private Limited", "Thane", "Gas Detector", "₹4,840"],
  ["Haas Engineering Systems And Solutions Pvt. Ltd.", "Chennai", "Gas Leak Detector", "₹21,000"],
  ["Shalvi Engineering Corporation", "Navi Mumbai", "Infrared Gas Detector", "₹5,000"],
  ["UNM India", "Mumbai", "Digital Battery Gas Detector", "₹49,500"],
  ["Ambetronics Engineers Private Limited", "Mumbai", "Wireless Gas Detector WGD-100-FLP", "₹89,750"],
  ["Lambda Technologies", "Gurugram", "Msa Altair 4x Multi Gas Detector", "₹39,800"],
];

const RESPIRATORY_PROTECTION: Listing[] = [
  ["Milan Safety", "Mumbai", "Milan Safety N95 Mask", "₹30/Piece"],
  ["Samarth Industries", "Kalyan", "FFP2 Industrial Safety Masks", "₹25/Piece"],
  ["Super Safety Services", "Mumbai", "Plastic Cup Mask with Valve for Pharma Industry", "₹25/Unit"],
  ["Max LT Technologies LLP", "Gurugram", "Drager X-plore 1300 Particle Filtering Face Piece", "₹1,650/Piece"],
  ["Jiya Engineering Company", "New Delhi", "Non-Woven Safety Mask 9004 IN 3M, For Traffic Police, Large", "₹15/Piece"],
  ["Shri Jagannath Industries", "Indore", "Pn205 Udyogi Safety Face Mask", "₹7/Piece"],
  ["Balaji Industries", "Mumbai", "Non-Woven FFP1 Airofresh A-410 Grey Colour Exhalation Valve Mask", "₹250/Piece"],
  ["Siddhi Vinayak Enterprise", "Ahmedabad", "Venus Nose Mask", "₹7.25/Piece"],
  ["Shreenath Sales", "Ahmedabad", "Industrial Safety Masks", "₹5,500/Piece"],
  ["Aura Credentials", "New Delhi", "PVC Blue Safety Full Face Mask, For Pharma Industry", "₹350/Piece"],
  ["Modern Safety Enterprises", "Mumbai", "Industrial Safety Masks", "₹105/Piece"],
  ["Oriental Enterprises", "Thane", "Non-woven+cotton Chemical Protected Mask", "₹100/Unit"],
  ["Shiva Industries", "New Delhi", "Venus V410 Mask", "₹19.50/Piece"],
  ["Voltech, India", "New Delhi", "Industrial Safety Masks", "₹850/Piece"],
  ["Real Value Safety Consultants", "New Delhi", "Promask Positive Pressure face mask", "₹8,000/Piece"],
  ["S.M. Industries", "Bhiwani", "Industrial Safety Yellow Dust Masks", "₹5/Piece"],
  ["AG Associates", "Vadodara", "Reusable FFP1 Venus V44 Mask", "₹6/Piece"],
  ["Vanguard Doors & Ironmongeries LLP", "Thrissur", "Double Cartridge Half Face Safety Mask - EN 140", "₹1,000/Piece"],
  ["Delight Industrial Solutions", "Bhiwadi", "Venus V420V FFP2 Flat Fold Respirator Safety Mask", "₹30/Piece"],
  ["Z Plus Disposable Private Limited", "Ahmedabad", "Z Plus Non-Woven Cup Mask With Valve, For Pharma Industry", "₹45/pcs"],
  ["Saumya Meditech", "Rajkot", "All Industrial Face Mask Safety Products", "₹2,500/Piece"],
  ["Shri Balajee Industrial Solution", "Ghaziabad", "Dust Protection Safety Mask", "₹15/Piece"],
  ["Grooj Enterprises", "Pune", "Venus V 410 V Safety Mask", "₹25/Piece"],
  ["ILP Safety & Security Services Private Limited", "Chennai", "KINGFA Industrial Safety Masks", "₹4.50/Piece"],
  ["Jain Safeweld Private Limited", "Kolkata", "Karam Industrial Smoke Safety Face Mask", "₹16/Piece"],
  ["Fire Safe Solutions & Consultants", "", "Industrial Safety Mask", "₹10/Piece"],
  ["ARN Enterprises", "", "Industrial Safety Masks", "₹10/Piece"],
  ["Shree Samarth Enterprises", "", "Venus V-414 SLOV-V FFP2 NR D Mask", "₹40/Piece"],
  ["Salus Products", "Ahmedabad", "Salus Safety Dust Mask", "₹80/Piece"],
  ["Fycca International Private Limited", "Gurgaon", "Cotton Venus Safety Face Mask V-2426", "₹68/Piece"],
  ["Safetywala Equipments LLP", "Ahmedabad", "Full Face Mask Venus, With Valve", "₹4,800/Piece"],
  ["Anand Safety House", "Ahmedabad", "Reusable Venus V420V FFP2 Face Mask, With Valve", "₹20.12/Piece"],
];

const FALL_PROTECTION: Listing[] = [
  ["Milan Safety", "Mumbai", "Black Fall Arrest Rescue Evacuation Triangle", "₹2,800/Piece"],
  ["UNM India", "Mumbai", "Karam Revolta Climbers Harness", "₹2,450/Piece"],
  ["Taheri Enterprises", "Mumbai", "Yellow Industrial Safety Harness", "₹1,450/Piece"],
  ["Kabir Overseas", "Meerut", "Black Safety Belt And Harness", "₹6,000/Piece"],
  ["J.P.Fibres", "New Delhi", "Full Body Harness Safety Harnesses", "₹2,250/Piece"],
  ["A I Sales Corporation", "Pune", "Full Body Safety Belt Udyogi UB102", "₹1,350/Piece"],
  ["Gravitech Industries", "Noida", "Red & Black Polyestar Gravitech GI-7051, For Fall Protection", "₹999/Piece"],
  ["Jiya Engineering Company", "New Delhi", "Black Allen cooper safety harness", "₹1,150/Piece"],
  ["Precision Components", "Kanpur", "Gravitas Safety Full Body Harness/Safety Belt (FBH-041)", "₹2,100/Piece"],
  ["Apex Medev", "New Delhi", "Polyster Orange Safety Harness System, For Fall Protection", "₹16,500/Piece"],
  ["Aventiq Health", "New Delhi", "Orange Safety Harness System", "₹17,500/Piece"],
  ["Siddhi Vinayak Enterprise", "Ahmedabad", "Safety Belt Udyogi Eco 4 Full Body Harness", "₹1,100/Piece"],
  ["Siya Industries", "New Delhi", "Green Nylon Full Body Safety Harness Double Lanyard", "₹1,501/Piece"],
  ["Safety Solutions", "New Delhi", "Karam Safety Harness PN-21", "₹1,000/Piece"],
  ["Adinath Equipments Private Limited", "Ahmedabad", "Multi Purpose Harness Ultratek Harness Udyogi", "₹6,150/Piece"],
  ["Oscar Enterprises", "New Delhi", "Oscar Enterprises 4-point Off-road Safety Harness", "₹1,400/Piece"],
  ["Kewalson", "New Delhi", "Black Full Body Harness Safety Belts Harnesses, For Industrial", "₹1,150/Piece"],
  ["Shri Harihar LR", "Palwal", "Karam Full Body Harness for Fall Arrest, Rope Access Work", "₹5,500/Piece"],
  ["Textrades Associates", "Noida", "Black Safety Harness, For Fall Protection", "₹45,000/Piece"],
  ["Safiya Global Corporation", "Chennai", "Full Body Safety Harness", "₹800/Piece"],
  ["MRK Engineering", "Chennai", "Karam PN44 Safety Harness With Energy Absorbing Double", "₹3,670/Unit"],
  ["Saansafe Protects LLP", "Pune", "Black And Green Nylon And Polyster Karam PN56 Tower", "₹4,600/Piece"],
  ["Onkar Nath Rajeev Gupta", "Prayagraj", "Karam Safety Harness Pn 12", "₹1,900/Piece"],
  ["Protecc Plus", "New Delhi", "Karam Safety Harnes KI 01 PN351", "₹1,350/Piece"],
  ["Shri Balajee Industrial Solution", "Ghaziabad", "Polister Double Hook Safety Harness Safety Belt", "₹800/Piece"],
  ["Unisource Corporation", "Chennai", "Denim Jacket Harness, For Fall Protection, Size: Universal", "₹2,500/Piece"],
  ["Jain Safeweld Private Limited", "Kolkata", "Karam PN-61 Full Body Safety Harness", "₹4,999/Piece"],
  ["Safe Dot International", "New Delhi", "Half Body Safety Harness", "₹200/Piece"],
  ["Balaji Safety Projects", "Mumbai", "Safety Belt Work Position Sit Harness, Model Name/Number: West Belt", "₹1,050/Piece"],
  ["Raju Safety Products", "Mumbai", "Safety Harness", "₹225/Piece"],
  ["Safehawk Workwear Private Limited", "Bahadurgarh", "Double Lanyard Safety Harness Belt", "₹649/Piece"],
  ["HRG Industries", "New Delhi", "Full Body Safety Harness", "₹2,250/Piece"],
  ["Source India Shoes", "Noida", "Half Body Harness", "₹250/Piece"],
  ["Mahadev Trading Co.", "New Delhi", "Polyester Full Body Harness Safety Belt, for Industrial", "₹350/Piece"],
  ["Jarsh Innovations Private Limited", "Secunderabad", "Jarsh Essentia D Ring Harness", "₹780/Piece"],
  ["Sahas Global Safety Private Limited", "Ghaziabad", "Sahas EYH1030 Chest Harness Belt", "₹1,650/Piece"],
  ["Safe Work Industry Private Limited", "New Delhi", "Green Safework Gold Safety Harness", "₹515/Piece"],
  ["Mahadev Industries", "Jala Kendua", "Yellow Safety Belt Half Body Harness", "₹5,850/Piece"],
  ["Neo Safety Products Private Limited", "Serampore", "Full Body Harness Class D", "₹3,000/Piece"],
  ["Core Safety Group", "Mumbai", "Multicolor Full Body Safety Harness", "₹500/Piece"],
  ["Amar Industries", "Bareilly", "Standard Green and Black Safety Harness", "₹800/Piece"],
  ["Japsin Instrumentation", "Mumbai", "Nylon Full Body Safety Harness Class A", "₹1,500/Piece"],
  ["Pooja Sales Corporation", "Ghaziabad", "Nylon Full Body Harnesses, For Construction", "₹9,000/Piece"],
  ["Aktion Safety Solutions Pvt. Ltd.", "New Delhi", "Fall Protection Full Body Safety Harness", "₹1,200/Piece"],
  ["Smith Industries", "Navi Mumbai", "Black Full Body Safety Harness", "₹790/Piece"],
  ["Kanvya Tools And Technology", "New Delhi", "Green Polyester Full Body Safety Belt", "₹1,450/Piece"],
  ["Utkal Engineers", "Ahmedabad", "Polyester Safety Harness", "₹1,375/Piece"],
  ["Prenav India Private Limited", "New Delhi", "Full Body Harness Safety Belts Harnesses", "₹240/Unit"],
  ["Best Mount Tents", "New Delhi", "Green Nylon Safety Harness Belt", "₹3,450/Piece"],
  ["Smit Enterprise", "Ahmedabad", "Full Body Safety Harness", "₹800/Piece"],
  ["D.D.K Industries", "New Delhi", "Polyester Black Full Body Harness", "₹295/Piece"],
];

const ALL_SUBCATEGORIES: { key: keyof typeof SOURCES; entries: Listing[] }[] = [
  { key: "safetyHelmets", entries: SAFETY_HELMETS },
  { key: "safetyShoes", entries: SAFETY_SHOES },
  { key: "safetyGloves", entries: SAFETY_GLOVES },
  { key: "safetyGoggles", entries: SAFETY_GOGGLES },
  { key: "fireExtinguishers", entries: FIRE_EXTINGUISHERS },
  { key: "fireHose", entries: FIRE_HOSE },
  { key: "fireSuppression", entries: FIRE_SUPPRESSION },
  { key: "safetySignage", entries: SAFETY_SIGNAGE },
  { key: "barricades", entries: BARRICADES },
  { key: "safetyCones", entries: SAFETY_CONES },
  { key: "safetyNets", entries: SAFETY_NETS },
  { key: "gasDetection", entries: GAS_DETECTION },
  { key: "respiratoryProtection", entries: RESPIRATORY_PROTECTION },
  { key: "fallProtection", entries: FALL_PROTECTION },
];

// ---------------------------------------------------------------------
// Cross-subcategory merge — identical pattern to every prior batch's
// mergeSameCompanyAcrossSubcategories().
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
  let existingIds: number[] = [7999]; // seed just below the 8000-8999 block (see lib/supplier-store.ts)
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
      if (c === "Safety Equipment") continue;
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

  const dataFile = path.join(process.cwd(), "data", "suppliers", "safety-equipment.json");
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ suppliers }, null, 2), "utf-8");
  console.log(`\nWrote ${suppliers.length} suppliers to ${dataFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
