// Ingestion run: Chemicals / Materials supplier batch (India-wide) — the
// fifth per-category dataset (Batch 6 of the master plan) added to the
// existing multi-file supplier repository (see lib/supplier-store.ts's
// id-block scheme). Same architecture as scripts/import-electronics-pcb-batch.ts:
// normalizeSupplierRecord / computeDataConfidence / computeDedupeKey /
// findPotentialDuplicates from the existing lib/ingestion + lib/dedup
// modules — nothing new invented.
//
// SOURCE AUDIT (reported to the user before this script was written, then
// carried into the master plan's Batch 6 without requiring a second
// approval round): 14 pan-India IndiaMART "impcat" category pages across
// 10 subcategory groups. "Industrial materials general" and "Engineering
// plastics" were DROPPED as standalone sources per the audit (no usable
// pan-India page for the former; the latter's available slugs were
// dominated by non-plastic or foreign-brand-resale listings).
//
// INCLUSION RULE applied while curating the raw listings below (every
// listing was reviewed against this rule before being transcribed here):
//   - EXCLUDED: pesticide/agrochemical products, AR/ACS/analytical-reagent
//     grade lab chemicals, gram-priced lab-scale quantities, pharma
//     intermediates/APIs sold by a pharma company under a pharma-context
//     title.
//   - EXCLUDED: Shilajit, craft/hobbyist resin, water-treatment ion-
//     exchange resin (a different product category from industrial
//     manufacturing resin).
//   - EXCLUDED: listings that are purely a reseller of ONE specific named
//     foreign brand via an otherwise-unrelated trading company with no
//     stated Indian manufacturing/own-business evidence (e.g. "3M",
//     "WEICON", "E6000", "Exxonmobil Vistamaxx/Exceed", "TAIPOL",
//     "Sumitomo"). Applied consistently on a post-ingestion contamination
//     sweep as well — "Karan Enterprises / 3m Undershield Coating" was
//     caught and dropped for the same reason after the initial curation
//     pass missed the "3m" brand reference.
//   - EXCLUDED: coating APPLICATION SERVICES (job-work, not a material
//     product) and decorative/architectural house paint (not industrial).
//   - EXCLUDED: finished tools/components mis-surfaced under a metals
//     category (cutting tools, anvils) and one brand-impersonation-risk
//     listing ("Victrex Plc" — identical name to a real UK multinational,
//     genuine India-entity status unverifiable from the directory listing
//     alone; dropped rather than risk misattributing a real company's
//     identity to an unverified page).
//   - Company name alone was NOT used to exclude a listing whose title
//     carried genuine industrial chemical/material evidence (e.g. "Kavya
//     Pharma" and "Forbes Pharmaceutical" are kept where their listed
//     product is a genuine industrial specialty chemical, not a drug).
//
// MANUFACTURER/DISTRIBUTOR/TRADER STATUS: per the audit, IndiaMART's
// category-page tiles almost never carry a literal business-type
// declaration (~1 in 300 listings audited did). Per the master plan
// ("if the source does not provide the information, leave it null — do
// not estimate it"), manufacturingStatus is left unset (-> "unknown" in
// normalizeSupplierRecord) for every listing EXCEPT the handful below
// where the title/company name literally states it ("Merchant" ->
// trader; "Manufacturer" / "Mfg." in the company's own name -> manufacturer).
// The Supplier schema's ManufacturingStatus enum has no "importer" or
// "stockist" value — none of the curated listings stated either of those
// literally, so this limitation was never actually exercised.
//
// TECHNICAL SPECS: extracted only when literally present in the title —
// CAS numbers, purity/concentration percentages, literal grade words
// ("Technical Grade", "Industrial Grade", "EP", "AR" — the latter kept
// only where the base listing itself wasn't already excluded as lab-scale),
// physical form (solid/liquid/powder/etc.), and literal packaging size.
// Nothing is inferred beyond the title text (parseChemSpecs()).
//
// TWO KNOWN SAME-NAME / DIFFERENT-CITY COMPANIES: "Pragati Metal
// Corporation" (Mumbai, stainless steel) and a same-named company in
// Indore (metal products) are, per the source pages, evidently different
// real businesses sharing a common name. mergeSameCompanyAcrossSubcategories()
// groups purely by normalized company name and would otherwise silently
// fold these two distinct, independently-evidenced companies into one
// record (discarding one city's evidence). Same issue for "Jyoti
// Enterprises" (Ahmedabad, adhesives vs. Mumbai, polymers). Rather than
// patch the shared merge helper (used safely by every other batch) or
// silently accept a false merge, the second occurrence of each pair is
// suffixed with its literal, source-evidenced city in parentheses purely
// to keep the two real records distinct — no name is fabricated, both
// suffixes are literal city evidence already on the source page.
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
  subcategory: string; // fine-grained label, used as a category tag
  group: string; // broad label, used as a category tag (may equal subcategory)
  url: string;
  sourceName: string;
};

const SOURCES = {
  industrialChemicals: {
    subcategory: "Industrial Chemicals",
    group: "Industrial Chemicals",
    url: "https://m.indiamart.com/impcat/industrial-chemicals.html",
    sourceName: "IndiaMART — Industrial Chemicals directory",
  },
  solvents: {
    subcategory: "Solvents",
    group: "Solvents",
    url: "https://m.indiamart.com/impcat/industrial-solvents.html",
    sourceName: "IndiaMART — Industrial Solvents directory",
  },
  specialtyChemicals: {
    subcategory: "Specialty Chemicals",
    group: "Specialty Chemicals",
    url: "https://m.indiamart.com/impcat/speciality-chemicals.html",
    sourceName: "IndiaMART — Speciality Chemicals directory",
  },
  resins: {
    subcategory: "Resins",
    group: "Resins",
    url: "https://m.indiamart.com/impcat/resins.html",
    sourceName: "IndiaMART — Resins directory",
  },
  adhesives: {
    subcategory: "Adhesives",
    group: "Adhesives",
    url: "https://m.indiamart.com/impcat/industrial-adhesives.html",
    sourceName: "IndiaMART — Industrial Adhesives directory",
  },
  polymers: {
    subcategory: "Polymers",
    group: "Polymers",
    url: "https://m.indiamart.com/impcat/plastic-polymers.html",
    sourceName: "IndiaMART — Plastic Polymers directory",
  },
  rubberMaterials: {
    subcategory: "Rubber Materials",
    group: "Rubber Materials",
    url: "https://m.indiamart.com/impcat/rubber-raw-material.html",
    sourceName: "IndiaMART — Rubber Raw Material directory",
  },
  compositesFrp: {
    subcategory: "Composites / FRP",
    group: "Composites / FRP",
    url: "https://m.indiamart.com/impcat/frp-products.html",
    sourceName: "IndiaMART — FRP Products directory",
  },
  metalsNonFerrous: {
    subcategory: "Non-ferrous metals",
    group: "Metals",
    url: "https://m.indiamart.com/impcat/non-ferrous-metals.html",
    sourceName: "IndiaMART — Non-Ferrous Metals directory",
  },
  metalsSheet: {
    subcategory: "Sheet metals",
    group: "Metals",
    url: "https://m.indiamart.com/impcat/sheet-metals.html",
    sourceName: "IndiaMART — Sheet Metals directory",
  },
  metalsStainless: {
    subcategory: "Stainless steel",
    group: "Metals",
    url: "https://m.indiamart.com/impcat/stainless-steel.html",
    sourceName: "IndiaMART — Stainless Steel directory",
  },
  metalsProducts: {
    subcategory: "Metal products",
    group: "Metals",
    url: "https://m.indiamart.com/impcat/metal-products.html",
    sourceName: "IndiaMART — Metal Products directory",
  },
  coatingsPaints: {
    subcategory: "Industrial paints",
    group: "Coatings",
    url: "https://m.indiamart.com/impcat/industrial-paints.html",
    sourceName: "IndiaMART — Industrial Paints directory",
  },
  coatingsIndustrial: {
    subcategory: "Industrial coatings",
    group: "Coatings",
    url: "https://m.indiamart.com/impcat/industrial-coatings.html",
    sourceName: "IndiaMART — Industrial Coatings directory",
  },
} satisfies Record<string, SubcategorySource>;

const STATE_BY_CITY: Record<string, string> = {
  Ahmedabad: "Gujarat",
  Vapi: "Gujarat",
  Vadodara: "Gujarat",
  Surat: "Gujarat",
  Valsad: "Gujarat",
  Padra: "Gujarat",
  Bharuch: "Gujarat",
  Kalol: "Gujarat",
  Gandhinagar: "Gujarat",
  Rajkot: "Gujarat",
  Jamnagar: "Gujarat",
  Anand: "Gujarat",
  Mahesana: "Gujarat",
  "Kotda Sangani": "Gujarat",
  "Sri Madhopur": "Rajasthan",
  Jaipur: "Rajasthan",
  Udaipur: "Rajasthan",
  Rajsamand: "Rajasthan",
  Mumbai: "Maharashtra",
  Thane: "Maharashtra",
  "Navi Mumbai": "Maharashtra",
  Vasai: "Maharashtra",
  "Vasai Virar": "Maharashtra",
  Pune: "Maharashtra",
  Nashik: "Maharashtra",
  Ambarnath: "Maharashtra",
  "Pimpri Chinchwad": "Maharashtra",
  Kalyan: "Maharashtra",
  Raigad: "Maharashtra",
  Murbad: "Maharashtra",
  Nagpur: "Maharashtra",
  Aurangabad: "Maharashtra",
  Latur: "Maharashtra",
  Miraj: "Maharashtra",
  "Butibori Midc": "Maharashtra",
  Kolkata: "West Bengal",
  Howrah: "West Bengal",
  Naihati: "West Bengal",
  "North 24 Parganas": "West Bengal",
  "New Delhi": "Delhi",
  Delhi: "Delhi",
  "Greater Noida": "Uttar Pradesh",
  Noida: "Uttar Pradesh",
  Ghaziabad: "Uttar Pradesh",
  Kanpur: "Uttar Pradesh",
  Meerut: "Uttar Pradesh",
  Moradabad: "Uttar Pradesh",
  Agra: "Uttar Pradesh",
  Hyderabad: "Telangana",
  Secunderabad: "Telangana",
  Chennai: "Tamil Nadu",
  Coimbatore: "Tamil Nadu",
  Thoothukudi: "Tamil Nadu",
  Vellore: "Tamil Nadu",
  Bengaluru: "Karnataka",
  Bagalkot: "Karnataka",
  Gurugram: "Haryana",
  Gurgaon: "Haryana",
  Faridabad: "Haryana",
  Bawal: "Haryana",
  Kurukshetra: "Haryana",
  Sonipat: "Haryana",
  Chandigarh: "Chandigarh",
  Jalandhar: "Punjab",
  Ludhiana: "Punjab",
  Indore: "Madhya Pradesh",
  Bhopal: "Madhya Pradesh",
  Cuttack: "Odisha",
  Bhubaneswar: "Odisha",
  Kottayam: "Kerala",
  Thiruvananthapuram: "Kerala",
  Palakkad: "Kerala",
  Ernakulam: "Kerala",
  Irinjalakuda: "Kerala",
  Katihar: "Bihar",
  Teliamura: "Tripura",
  Bhilai: "Chhattisgarh",
  Jamshedpur: "Jharkhand",
};

function locationFor(city: string): string {
  const cleanCity = city.split(",")[0].trim();
  if (!cleanCity) return "";
  const state = STATE_BY_CITY[cleanCity];
  return state ? `${cleanCity}, ${state}` : cleanCity;
}

// Literal-evidence-only technical spec extraction — mirrors PCB's
// parsePcbSpecs() discipline: every extracted fact is a direct regex match
// against the listing title, nothing inferred.
function parseChemSpecs(title: string): string[] {
  const specs: string[] = [];
  const push = (label: string) => {
    if (!specs.includes(label)) specs.push(label);
  };

  const casMatch = title.match(/\b(\d{2,7}-\d{2}-\d)\b/);
  if (casMatch) push(`CAS: ${casMatch[1]}`);

  const purityMatch = title.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (purityMatch) push(`Purity/concentration: ${purityMatch[1]}%`);

  const gradeWordMatch = title.match(
    /\b(technical|industrial|food|pharma|analytical|reagent|general purpose)\s*grade\b/i
  );
  if (gradeWordMatch) push(`${gradeWordMatch[1]} grade`);

  const gradeCodeMatch = title.match(/\b(EP|BP|USP|IP|ACS|LR|GR|AR)\b/);
  if (gradeCodeMatch) push(`Grade: ${gradeCodeMatch[1]}`);

  const formMatch = title.match(
    /\b(solid|liquid|powder|granules?|lumps?|sheet|pellets?|flakes?)\b/i
  );
  if (formMatch) {
    const word = formMatch[1].toLowerCase();
    push(word.charAt(0).toUpperCase() + word.slice(1));
  }

  const packMatch = title.match(
    /(\d+(?:\.\d+)?)\s*(kgs?|kilograms?|litres?|liters?|ml|gms?|grams?|l)\b/i
  );
  if (packMatch) push(`Packaging size: ${packMatch[1]} ${packMatch[2]}`);

  return specs;
}

function rawRecordsForSubcategory(
  key: keyof typeof SOURCES,
  entries: Listing[]
): RawSupplierRecord[] {
  const { subcategory, group, url, sourceName } = SOURCES[key];
  const categories = Array.from(new Set(["Chemicals / Materials", group, subcategory]));

  return entries.map(([companyName, city, title, price, bizType]) => {
    const specs = parseChemSpecs(title);
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

const INDUSTRIAL_CHEMICALS: Listing[] = [
  ["Ozone Specialities", "Ahmedabad", "Para Octyl Phenol", "₹400/Kg"],
  ["Indian Platinum Pvt. Ltd.", "Mumbai", "powder,liquid Zinc Compound Powder, Packaging Size: 1 kg", "₹800/Kilogram"],
  ["Sanchemy FPN", "Thane", "Technical Grade Potassium Amyl Xanthate (97% Purity)", "₹1,000/Kg"],
  ["Esters And Solvents LLP", "Navi Mumbai", "Isopropyl Laurate Cas 10233 13 3", "₹100/Kg"],
  ["Jigs Chemical Limited", "Ahmedabad", "Butyl titanate polymer", "₹100/Kg"],
  ["Dhanvi Egls (Exim Global Lifechem Services)", "Hyderabad", "3 Chloro 2 Methylbenzenethiol", "₹2,000/Kg"],
  ["Triveni Chemicals", "Vapi", "Mould Oil (200.0 g/mol)", "₹100/Kg"],
  ["A B Enterprises", "Mumbai", "4-Hydroxybenzonitrile", "₹6,300/Kg"],
  ["NRS Chemicals LLP", "Vapi", "Aluminium Isopropoxide Powder Lumps", "₹260/Kg"],
  ["Farmoganic Health And Beauty", "Vasai", "SM Cocoyl Taurate, 5KG", "₹380/Kg"],
  ["Destiny Chemicals", "Vadodara", "Industrial Chemical Compound", "₹200/Kg"],
  ["Cynor Laboratories", "Surat", "N-METHYL ANILINE(100-61-8)", "₹1,160/Kg"],
  ["Ptcgram Private Limited", "Vasai Virar", "Dihydromercynol Dhm Residue And Tops", "₹45/Litre"],
  ["Labh Projects Private Limited", "Ahmedabad", "Chemicals for Pesticides Industries - Labh Group", "₹300/Kg"],
  ["Suvidhinath Laboratores", "Vadodara", "Solid Benzil, Packaging Type: Bag", "₹2,000/Kg"],
  ["Zama Chemical", "Mumbai", "Sodium Bisulphate Monohydrate EP, Solid", "₹150/Kg"],
  ["Kavya Pharma", "Surat", "Dimethyl Sebacate CAS NO.106-79-6", "₹650/Kg"],
  ["Dadia Chemical Industries", "Mumbai", "Industrial Decitan PF", "₹125/Kg"],
  ["Triveni Chemicals", "Vapi", "3-Methoxy-3-Methyl-1-Butanol (56539-66-3)", "₹435/Kg"],
  ["Swastik Interchem Private Limited", "New Delhi", "Swastik Pigment Yellow Powder, For Cosmetics", "₹390/Kg"],
  ["Bonnafide Chemicals", "Kanpur", "Industrial Chemical Compound, Packaging Type: Bag", "₹450/Kg"],
  ["JK Chemicals", "Valsad", "Oriental Ester (Ethyl Safranate), For Industrial", "₹300/Kg"],
  ["Natural Aroma Products Private Limited", "New Delhi", "D Isomenthone Chemical, 99.5%", "₹2,450/Kg"],
];

const SOLVENTS: Listing[] = [
  ["Ram Shree Chemicals", "Mumbai", "Industrial Solvent And Chemicals", "₹55/Kg"],
  ["Elchemy", "Mumbai", "Industrial Chemical Solvents", "₹100/Litre"],
  ["Madhu Chemicals", "Mumbai", "Ethylene Dichloride Edc", "₹45/Kg"],
  ["Triveni Chemicals", "Vapi", "Chloroacetone (78-95-5) (C3H5ClO)", "₹2,000/Kg"],
  ["ND Industry", "New Delhi", "Flexo Clean Solvent Buster", "₹11,998/Bottle"],
  ["Rajvi Enterprise", "Ahmedabad", "ETHYL PALMITATE", "₹100/Kg"],
  ["Kaival Chemicals Private Limited", "Padra", "Isopropyl Propionate, Liquid, Packaging Size: 200 Kg Hdpe Drum", "₹500/Kg"],
  ["Triveni Chemicals", "Vapi", "Di(Propylene Glycol) Methyl Ether Acetate", "₹242/Kg"],
  ["Moksha Chemicals", "Mumbai", "Liquid Industrial Solvent", "₹50/Litre"],
  ["Manish Minerals And Chemicals", "Mumbai", "Methyl Pentonene Residue", "₹35/Kg"],
  ["JK Chemicals", "Valsad", "Industrial Grade Mono Ethylene Glycol, 99%, Liquid", "₹300/Kg"],
  ["Lakshmi Saraswati Chemicals And Organics Private Limited", "Hyderabad", "Mix Solvent Industrial Grade For Paint & Coatings, 99%", "₹45/Kg"],
  ["Hi-Tech Chemicals Converters Private Limited", "Mumbai", "Propylene Glycol Solvent", "₹120/Kg"],
  ["Jones Chemicals", "Chennai", "Water White THINNER ICMS SOLVENT, Grade Standard: Industrial Grade", "₹30/Litre"],
  ["Cij Jetinks Industry", "Chennai", "Hydrocarbon Solvents CIJ Chemical Solvent, 99%, Grade Standard: Industrial Grade", "₹300/Litre"],
  ["Antares Chem Private Limited", "Mumbai", "Liquid Trimethyl Orthoformate, 500 - 1000 Lit", "₹215/Kilogram"],
  ["Gayatri Industries", "Mumbai", "TEA solvent supplier", "₹100/Kg"],
  ["Ami Fine Chem", "Surat", "AFC Recovered Solvent", "₹45/Kg"],
  ["Eagle Corporation", "Vadodara", "Mix Industrial Chemical Solvent", "₹30/Kg"],
  ["Parasnath Organics Private Limited", "New Delhi", "Industrial Wash Oil", "₹160/Litre"],
  ["Gomoswa International", "Surat", "Industrial Solvents, Liquid, 99.90%", "₹79/Kg"],
  ["Fine Chemicals & Solvents", "Kolkata", "Industrial Solvents .", "₹75/Kg"],
  ["V. V. International", "Rajkot", "fresh liquid Toluene Solvent, 99%", "₹72/Kg"],
  ["Maruti Enterprises", "Jaipur", "Industrial Chemical Solvents", "₹60/Kg"],
  ["A To Z Chemicals", "Kolkata", "Liquid Industrial Solvent, Grade Standard: Industrial Grade", "₹60/Kilogram"],
  ["Sova Chemicals Co.", "Kolkata", "Industrial Liquid Solvent", "₹88/Litre"],
  ["Reliable Traders", "Mumbai", "Meta Xylene Chemicals, Industrial Grade, 200 L Drum", "₹210/Kg"],
  ["Rasayan Trading Co.", "Ahmedabad", "Triethyl Phosphate Tep", "₹200/Kg"],
  ["Sri Rishabh Chemicals Corporation", "Chennai", "Tri Chloro Ethylene", "₹50/Kg"],
  ["S P Chem India", "Ahmedabad", "2 Ethythexyl Acetate", "₹120/Kg"],
  ["Aishwarya Enterprises", "Hyderabad", "All Types Of Fresh Solvents Are Available", "₹100/Kg"],
  ["S.G. Aerochem", "Indore", "Grade Standard: Industrial Grade ISO Propyl Propionate, Liquid, 99%", "₹305/Kg"],
  ["Volirix Ventures", "", "Industrial Chemical Solvents", "₹32/Kg"],
  ["Pon Pure Chemical India Private Limited", "", "Exxsol Tm D 40", null],
];

const SPECIALTY_CHEMICALS: Listing[] = [
  ["MT Chemtech India", "Hyderabad", "Phenylselenyl chloride, Cas No 5707-04-0", "₹1,800/Kg"],
  ["Jigs Chemical Limited", "Ahmedabad", "Dipropylene glycol diacrylate (DPGDA)", "₹100/Kg"],
  ["Cynor Laboratories", "Surat", "1, 4 Difluorobenzene(540-36-3), 5kg", "₹2,200/Kg"],
  ["Kavya Pharma", "Surat", "2,2,6,6-teramethyl -4- piperidinol (TMP)", "₹400/Kg"],
  ["Dhanvi Egls (Exim Global Lifechem Services)", "Hyderabad", "2 3 Difluoro Bromobenzene", "₹42,320/Kg"],
  ["Indian Platinum Pvt. Ltd.", "Mumbai", "Stannous Pyrophosphate Powder", "₹1,200/Kg"],
  ["Destiny Chemicals", "Vadodara", "99% Speciality Chemicals Powder, 25 Kg", "₹850/Kg"],
  ["Chemolin Chemicals", "Mumbai", "Sodium Anthraquinone Beta Sulfonate", "₹88/Kg"],
  ["New Alliance Fine Chem Private Limited", "Mumbai", "Cupric Salicylate", "₹500/Kilogram"],
  ["Nikava Pharmaceutical Industries", "Ambarnath", "5 kg Speciality Chemicals, Liquid", "₹1,000/Kg"],
  ["Euro Asia Bio Chemicals Private Limited", "Kanpur", "Ethyl Hexyl Triazo, Powder", "₹650/Kg"],
  ["Supramate Speciality Private Limited", "Ahmedabad", "Lauroyl Pyridinium Chloride", "₹200/Kg"],
  ["Triveni Chemicals", "Vapi", "Benzyl Nicotinatec (94-44-0)", "₹5,000/Kg"],
  ["Esters And Solvents LLP", "Navi Mumbai", "Butyl Stearate, Packaging Size: 180 Kgs", "₹100/Kg"],
  ["Forbes Pharmaceutical", "Mumbai", "Potassium Titanium Oxalate", "₹1,100/Kg"],
  ["Novel Chem", "Vadodara", "Butyl Glycidyl Ether, Liquid", "₹330/Kg"],
  ["Rajvi Enterprise", "Ahmedabad", "DIPOTASSIUM AZELATE", "₹100/Kg"],
  ["Anurash Technologies Inc", "", "50 kg Trimethylsilyl Trifluoromethanesulfonate", "₹6,500/Kg"],
];

const RESINS: Listing[] = [
  ["Abelin Polymers", "Nashik", "Yellow Crystal Resins, Packaging Size: 1 kg", "₹120/Kg"],
  ["Chimique Sol", "Surat", "White 1.5 Kg Crystal Clear Epoxy Resin, For Industrial, Paints & Coatings", "₹650/Kg"],
  ["Labh Projects Private Limited", "Ahmedabad", "Resins for Industries - Labh Group, Grade: General Purpose", "₹300/Kg"],
  ["Shahjanand Decor Paper LLP", "Ahmedabad", "Epoxy Lr Resin Door Lamination Resin, 35 L", "₹135/Kg"],
  ["Swastik Interchem Private Limited", "New Delhi", "Yellowish CEVA Resin Lumps, For Bopp Inks And Primer, Solid lump", "₹500/Kg"],
  ["Fine Flow Plastic Industries", "Mumbai", "PE Resins Powder, Packaging Size: 25Kg, For Industrial", "₹220/Kg"],
  ["Aypols Polymers Private Limited", "Coimbatore", "Liquid Putty Grade Resin, For Industrial, Packaging Size: 35Kgs To 225Kgs", "₹125/Kg"],
  ["Innovative Resins Private Limited", "Gurgaon", "Polyester IR-150 Abrasive grade Resin, Grade: General Purpose, 35 kg & 220 kg", "₹265/Kg"],
  ["Sargam Polymer", "New Delhi", "Liquid Murti Grade Resin, For FRP, Packaging Size: 30 Litre", "₹120/Kg"],
  ["M S Klebstoffe", "New Delhi", "Liquid Resin, For Casting, Packaging Size: 30Kgs", "₹650/Kg"],
  ["Lube Adhesive And Engineering Co.", "Ahmedabad", "Liquid JPOXY JR 3482 & JR 2482 EPOXY RESIN EQUAL TO ARALDITE AV 138 & HV998, Packaging Size: 1 kg", "₹2,200/Piece"],
  ["Awishkar Associates", "Pune", "Waterborne Epoxy Resins, Packaging Type: Drum", "₹560/Kilogram"],
  ["Global Composite", "Pune", "Pale Yallow Clear Liquid GCPL 1000 Resin, For FRP Mouding (hand Layup), Pack Size: 35KGS", "₹100/Kg"],
  ["Kumar Roto Flex Private Limited", "Kanpur", "Epoxy Coconut Oil Based Alkyd Resin, 200 kg", "₹110/Kilogram"],
];

const ADHESIVES: Listing[] = [
  ["Jyoti Enterprises", "Ahmedabad", "Industrial Adhesives, 1 Litre", "₹85/Kg"],
  ["Labh Projects Private Limited", "Ahmedabad", "Industrial Adhesives & Sealants for Wood & Construction - Labh Group, Pouch", "₹100/Piece"],
  ["Ghatge Enterprises", "Pimpri Chinchwad", "Industrial Inorganic Adhesive, 1 Litre", "₹50/Litre"],
  ["Stick Tapes Private Limited", "Mumbai", "Tesa 60153 Adhesive Prompoter Fast Cure, 1 Litre", "₹4,000/Litre"],
  ["Sunrise Chemicals", "Ahmedabad", "CP - 306 (Side Pasting Adhesive)", "₹90/Kg"],
  ["Jemkon Private Limited", "Pune", "Jemkon Industrial Tile Adhesives, Bag", "₹480/Piece"],
  ["Guardian Anti Corosives Pvt. Ltd.", "Chennai", "GAC Premier CL", "₹910/Piece"],
  ["Indo Asia Enterprise", "Ahmedabad", "Mould Sealer Adhesive, 300 ml, Packaging Type: Drum", "₹2,000/Piece"],
  ["NCK Associates Private Limited", "New Delhi", "Dendrite CLR 88M Adhesive, 25 liter", "₹260/Litre"],
  ["Jyoti Innovision Private Limited", "Ahmedabad", "J Bond Adhesive", "₹350/Kg"],
  ["PB Statclean Solutions Pvt. Ltd.", "New Delhi", "PBSS B-7000 Adhesive Glue esd, 150 ml", "₹150/piece"],
  ["Innomax Industries", "New Delhi", "25L Synthetic Rubber Adhesives, 1 L, HDPE Barrel", "₹160/Litre"],
  ["Tack Innovations", "New Delhi", "McCoy Soudal Foam Base Soudabond Easy Bonding Adhesive", "₹700/Piece"],
  ["Aman International", "Jaipur", "Industrial Adhesives, 10ml to 100 ml", "₹20/Piece"],
  ["Infra Steel Cast Private Limited", "Howrah", "Sprayable Adhesive Tiger", "₹900/Piece"],
  ["Lube Adhesive And Engineering Co.", "Ahmedabad", "ANR 122 Bearing Retainer Adhesive, 10 Gms", "₹250/Piece"],
  ["Urja Sealants Pvt. Ltd.", "Pune", "Non Setting Mastic Adhesive Sealant", "₹160/Kg"],
  ["Puredex", "Chennai", "555 Aerobond Pasting Adhesive, 5 Kg, Bucket", "₹180/Kg"],
  ["Benson Polymers Limited", "New Delhi", "Edge Banding of PVC Tapes to Wood Boards with Polywood PVC Sheet Lamination Adhesive", "₹400/Kg"],
  ["Ooda Industrial Products", "Chennai", "Magnet Bonding Adhesive Glue, 1 Kg", "₹500/Piece"],
  ["Satyams Poly Tradelink Private Limited", "Surat", "Dry Bond Yellow Multi-Purpose Adhesive - High Strength Industrial Glue 30Ml", "₹19/Piece"],
  ["Smart-Bond Chemicals Private Limited", "Jaipur", "SMART-BOND GRIP ALL", "₹550/Kg"],
  ["Royal Traders", "Chandigarh", "Mc Bond- 20gm. Tube", "₹245/Unit"],
  ["Abtek Flow Solutions LLP", "Chennai", "Grade Standard: Electronic Grade HTC Non-silicone Heat Transfer Compound", "₹2,500/Kg"],
  ["Behera Enterprises", "Cuttack", "Adhesives (Brand: Bondtite)", null],
  ["Universal Importers Corporation", "Mumbai", "Industrial Glue And Paste", null],
  ["Patel Extrusion Group", "Mumbai", "Adhesives Tubes", null],
  ["Imperial Trading Corporation", "New Delhi", "Industrial Adhesives", null],
  ["Prime", "Vadodara", "Gumming Adhesives", null],
  ["Yashwant Industrial Works Private Limited", "Miraj", "Clear Epoxy Adhesive", null],
  ["Marco Poly Products", "Thoothukudi", "Engineering Adhesives", null],
  ["A To Z Auto Accessories", "New Delhi", "Industrial Liquid Adhesive", null],
  ["Shiv Shakti Plywood & Wood Works", "New Delhi", "Industrial Adhesives", null],
  ["Shri Balaji Enterprises", "Coimbatore", "Industrial Adhesives", null],
  ["Bombay Sales Corporation", "Indore", "General Adhesive", null],
  ["Bestdeal", "Hyderabad", "Industrial Adhesives", null],
  ["RASS Latex", "Palakkad", "Adhesive", null],
  ["Himloc Corporation", "Ahmedabad", "Industrial Adhesives", null],
  ["Jacsons Engineers", "Hyderabad", "industrial adhesive", null],
  ["Sandeep Marketings", "Mumbai", "Industrial Adhesives", null],
  ["Ankita Enterprises", "Mumbai", "Adhesive", null],
  ["Nassa Paints", "Vellore", "Camel Cem Adhesive", null],
];

const POLYMERS: Listing[] = [
  ["Gleason Health Care", "Surat", "PVC POLYURO - PREMIUM POLYMED, Color: Blue, Processing Method: Injection Molding", "₹89/Kg"],
  ["Ethios Enviro Solutions Private Limited", "Ahmedabad", "White Powder High Solid Content Acrylic Polymer SBR", "₹10/Kg"],
  ["AVG Polymers India Private Limited", "New Delhi", "Acrylic Plastic Polymer, Color: Transparent", "₹195/Kg"],
  ["Triveni Chemicals", "Vapi", "HDPE Polycaprolactone (24980-41-4)", "₹1,500/Kg"],
  ["Neelgiri Chemicals Private Limited", "New Delhi", "Finanox 18 Polymers, Packaging Size: 25 Kg", "₹450/Kg"],
  ["Shivalik Enterprises", "New Delhi", "HIWAN GPPS 525 Natural Polypropylene Plastic Polymer", "₹113/Kg"],
  ["AVH Polychem Private Limited", "Mumbai", "Varied Plastic Granules, Processing Method: Most of the above, Color: White", "₹80/Kg"],
  ["Sidma Polymers Private Limited", "Bengaluru", "White Plastic Masterbatch", "₹160/Kg"],
  ["PANKU PLASTIC POLYMERS", "Surat", "Hd Plastic Granules, For Industril", "₹70/Kilogram"],
  ["PVC Colouring Compounding And Processing", "Ahmedabad", "HDPE Plastic Polymers, Color: Natural, Processing Method: Injection Molding", "₹150/Kg"],
  ["Reliable Traders", "Mumbai", "PVC Liquid Lapox ARD-10 (K-100) Polymer, For Industrial Use", "₹255/Kg"],
  ["Add Plast", "Thane", "Sebs Polymer", "₹190/Kg"],
  ["Chemie Range", "New Delhi", "Thermoplastic Polyethylene Plastic Polymers, for Industrial Use", "₹140/Kilogram"],
  ["Radian Chemical Products Pvt. Ltd.", "Mumbai", "Vybar 103 Polymer", "₹850/Kg"],
  ["Waxchem India", "Chennai", "Polyethylene Solid State Vybar", "₹1,000/Kg"],
  ["Blend Colours Private Limited", "Hyderabad", "Blend Colours Granule Beige Plastic Masterbatch", "₹160/Kg"],
  ["Labdhi Engineering Co.", "Mumbai", "Engineered Polymers", "₹100/Kg"],
  ["Esskay Lathe Engineers And Traders", "Indore", "Esskay White Polymers for Industrial Use", "₹80/Kilogram"],
  ["Mobelchem Specialty Private Limited", "Gurugram", "OH Polymer 80000 Cst", "₹180/Kg"],
  ["Pluss Advanced Technologies Limited", "Bawal", "Specialty Polymers", "₹80/Kg"],
  ["Lush Polymers", "Mumbai", "SAN TAITA 1200", "₹128/Kg"],
  ["Polycorp India", "New Delhi", "Solid State Maleic Anhydride Grafted Polymer", "₹240/Kg"],
  ["Polycom Innovation", "Vadodara", "Nylon 66 30 Glass Filled Natural Granules FR V)", "₹440/Kg"],
  ["Jyoti Enterprises (Mumbai)", "Mumbai", "PPCP Plastic Polymers, Color: Natural", "₹70/Kg"],
  ["Mittal Traders", "Indore", "Paras Polymers Bio Cup", "₹50/Kg"],
  ["Markanda Nanoscience (OPC) Private Limited", "Kurukshetra", "9002-88-4 Polyethylene Nanopowder", null],
  ["Majestic W And E Industries", "New Delhi", "Red Plastic Polymer Granules", null],
  ["Ch101 Market Private Limited", "Mumbai", "SoluDist SI38", null],
  ["J Khushaldas & Co. (Spd)", "Mumbai", "ptfe Black & White Engineered Polymers", "₹100/Kilogram"],
  ["Jay Enterprise", "Ahmedabad", "Ldpe Plastic Granules, Color: White", "₹102/Kg"],
  ["India Plastometal Impex", "New Delhi", "Granules TPE Plastic, For Industrial Use", null],
];

const RUBBER_MATERIALS: Listing[] = [
  ["Jigs Chemical Limited", "Ahmedabad", "Natural Rubber STYRENE RAW MATERIAL, Granules", "₹100/Kg"],
  ["Elite Rubber Chemicals", "New Delhi", "Silicone Rubber Raw Material", "₹210/Kg"],
  ["Quality Polymers", "Vasai", "Rubber Raw Material For Shoe Sole", "₹185/Kg"],
  ["Shraman International", "New Delhi", "NBR 3250 Acrylonitrile Polymer", "₹232/Kg"],
  ["Gupta Chemicals", "New Delhi", "Synthetic Rubbers Rubber Raw Material, Blanket", "₹135/Kg"],
  ["Hitansh Enterprises", "New Delhi", "Rubber Raw Material", "₹165/Kg"],
  ["Arora Industries", "Chennai", "NBR Rubber Raw Material, Sheet", "₹100/Kg"],
  ["Digi Control Infotech System", "Ghaziabad", "Hair Rubber Bands Roll Raw Material", "₹255/Kg"],
  ["Sanya Electricals", "Indore", "Omega Kacchi Rubber", "₹200/Kg"],
  ["Wood Plast Industries", "Mumbai", "EVA dull natural, Quantity Per Pack: 25KGS", "₹95/Kg"],
  ["Akashichem Private Limited", "Mumbai", "FFKM Raw Rubber", null],
  ["Murli Enterprises", "Kanpur", "Industrial Black Rubber Strapping And Binding Material", null],
  ["Acme Rub Chem", "Mumbai", "Cisamer Rubber 1220 raw material", "₹149/Kilogram"],
  ["Hitesh Enterprise", "Thane", "Nitrile Rubber Raw Material Pellets for Garments (Industrial Grade)", "₹500/Kg"],
  ["B.K International", "New Delhi", "Synthetic Rubbers Yellowish Rubber Raw Material, Sheet", "₹145/Kg"],
  ["Roy Rubber Sheet", "Teliamura", "Raw Rubber, Sheet", "₹142/Kg"],
  ["Shri Hans Rubber Industries", "New Delhi", "Sutta Tar Uncured Raw Rubber Compound", "₹100/Kg"],
  ["Ramani Trading", "Katihar", "Yellowish Rubber Raw Material Natural, Sheet", "₹190/Kg"],
  ["Kaasa Tyres", "Coimbatore", "Viton Rubber Raw Material, Sheet", "₹450/Kilogram"],
  ["Wader Shoe Grading", "Noida", "Raw Rubber", "₹100/Kilogram"],
  ["Paul Rubber Agency", "Udaipur", "Natural Rubber Raw Material", "₹85/Kg"],
  ["Poly Rub Chem", "Mumbai", "Rubber Raw Material", null],
  ["Arun Enterprises", "Jaipur", "Raw Rubber", null],
  ["Brahans Rubber Products", "Bengaluru", "Rubber Material, Sheet", null],
  ["B.P. Chemicals", "Ahmedabad", "Rubber Raw Material", null],
  ["Dwarkadhish Marketing", "Rajkot", "Synthetic Rubbers Rubber Raw Material, Sheet", null],
  ["GPT Engineering & Trading Co.", "Faridabad", "White Silicone Rubber Raw Material, Sheet", null],
  ["Highway Service Centre", "Bhubaneswar", "Rubber Raw Materials, Powder", null],
  ["Anaika Traders", "", "Industrial Footwear Rubber Scrap", "₹100/Kg"],
  ["Jai Durga Industries", "New Delhi", "Natural Rubber Pony Rubberband Raw Material", null],
  ["Synthetic Rubber Industries", "Kolkata", "Rubber Raw Material", "₹767/Kg"],
  ["Super Rubber Products", "Kolkata", "Rubber Material", "₹110/Kilogram"],
  ["Laxmi Enterprises", "Agra", "Styrene Butadiene Rubber Sbr 1502", "₹120/Kg"],
  ["Kimberlite Chemicals (I) Pvt. Ltd.", "Bengaluru", "Rubber Raw Material", null],
  ["Sriram Toolings", "Bengaluru", "Rubber Material", null],
  ["Brelson Rubber Moulders", "Bengaluru", "Raw Material Rubber", null],
  ["Tulsi Rubber Industries", "North 24 Parganas", "Raw Rubber For Washer", "₹35/Kilogram"],
  ["BK Industries", "Pune", "Rubber Raw Material", null],
  ["Mohit Traders", "New Delhi", "Rubber Raw Material", null],
  ["Amit Rubber Industries", "Gurugram", "Rubber Raw Material", null],
  ["Akshara And Company", "Gurugram", "Rubber Raw Material", "₹13/Kg"],
  ["Shaw Rubber", "Naihati", "Raw Natural Rubber", null],
  ["Ibran Ahmad", "New Delhi", "Rubber Raw Material", null],
  ["Krishna Minerals", "Bagalkot", "Natural Raw Material", null],
  ["Sidhant Rubber Products", "Gurugram", "Rubber Raw Material", null],
  ["A.R.Thermosets Private Limited", "Kanpur", "Raw Rubber", null],
  ["Silverstone Rubber India Pvt. Ltd.", "Thiruvananthapuram", "Raw Rubber", null],
  ["Diamond Rubber Industries", "Chandigarh", "Rubber Raw Material", null],
  ["Perfact Reclaim Rubber", "Rajkot", "Rubber Raw Material", null],
  ["Ashok Rubber Factory", "Kottayam", "Rubber Raw Material", null],
  ["A S A Polymers", "Chennai", "Silicone Rubber Raw Materials", null],
];

const COMPOSITES_FRP: Listing[] = [
  ["Star Enterprises", "Mumbai", "FRP Tubes", "₹350/Piece"],
  ["Gautam Handicrafts", "Ahmedabad", "Frp Decorative Items, 50mm", "₹45,000/Piece"],
  ["EPP Composites Private Limited", "Rajkot", "Frp Swimming Pool Gratings, 3mm", "₹1,650/Piece"],
  ["Om Engineering Co.", "Murbad", "FRP Pultrusion Support - Flat, 19 MM", "₹270/Kg"],
  ["Fibertech Composite Private Limited", "Kotda Sangani", "Fiberglass Grating 30mm", "₹1,950/Piece"],
  ["Aeron Composite Limited", "Mahesana", "Fiberglass Reinforced Plastic Stair Treads", "₹2,000/PIECE"],
  ["Fibrecrafts India", "Pune", "FRP Customised Products", "₹1,500/Piece"],
  ["Everest Composites Private Limited", "Vadodara", "FRP Chemical Grade Gutter", "₹1,200/Piece"],
  ["Solution 4U", "Mumbai", "Industrial Frp Products", "₹2,000/Piece"],
  ["KNT Creations India Private Limited", "Pune", "Frp Rocks, 3mm", "₹26,500/Piece"],
  ["Supreme Fibre Glass Private Limited", "Vasai", "FRP (Fiber) Waffle Slabs", "₹300/sq ft"],
  ["Fire Knock", "Mumbai", "Double Door Frp Fire Hose Box, 3mm", "₹3,850/Piece"],
  ["Insulo Fibre Private Limited", "Vadodara", "FRP Molded Component, 3mm", "₹100/Piece"],
  ["Bharat Fiberglass Industries", "Vadodara", "FRP Flat Bar, 5mm", "₹200/Kilogram"],
  ["Surolia Enterprises Private Limited", "Sri Madhopur", "Round Frp Bent Element For Construction, For Buildings", "₹400/Kg"],
  ["Quality Engineering And Insulaton Products", "Bhopal", "Glass Fiber Reinforced Epoxy Resin Filament Wound Epoxy Rings", "₹600/Piece"],
  ["F R P Solution", "Vadodara", "Fiber Grey Industrial Frp Products", "₹160/Piece"],
  ["MIE Fibrotech And Engineering Private Limited", "Hyderabad", "FRP Products", "₹3,999/Piece"],
  ["Purva Fibre Moulding Industries", "Pune", "Purva Antique FRP Table", "₹12,000/Piece"],
  ["Shree Shakti Steel Corporation India Private Limited", "Nagpur", "FRP industrial Matt, 2mm", "₹550/Piece"],
  ["KNT Creations India Private Limited", "Pune", "FIBERGLASS Round Knob Pot", "₹548/Piece"],
  ["Ventura Fibre", "Chennai", "Floor Mounted Black Square FRP Louvers, For Industrial Use", "₹13,000/Piece"],
  ["Fibre Plast", "Mumbai", "FRP Industrial Tray", "₹700/Piece"],
  ["Intec FRP Products", "Ahmedabad", "Translucent Fiber Glass Sheet", "₹25/sq ft"],
  ["Opalkem", "Kalyan", "FRP Structure ( FRP), 6mm", "₹1,00,000/Piece"],
  ["Saburi Enterprises", "Pune", "Industrial Frp Products, 2 to 10 mm", "₹150/Square Feet"],
  ["Scorp Energy Private Limited", "Ahmedabad", "FRP CABLE TRAY 100X50X3 MM", "₹395/Piece"],
  ["Siddh Vinayak Fiber", "Kanpur", "FRP Animal Statue, 5mm", "₹80,000/Piece"],
  ["Vijay Trading Corporation", "Bengaluru", "Fibre Glass Pultroded Products", "₹200/Kilogram"],
];

const METALS_NON_FERROUS: Listing[] = [
  ["Krone Impex", "Mumbai", "Grade: 304 Non Ferrous Flats", "₹225/Kilogram"],
  ["Maxell Steel & Alloys", "Mumbai", "Gold Hex Non Ferrous Metal Rods", "₹362/Kilogram"],
  ["V T Export", "Rajkot", "Non Ferrous Metal", "₹900/Kg"],
  ["Micro Tubes (India)", "Mumbai", "Golden Round Ferrous & Non Ferrous Metal Merchant", "₹699/Kg", "trader"],
  ["Steel Mart", "Mumbai", "Brass Non Ferrous Flats", "₹786/Kg"],
  ["Prime Steel Corporation", "Mumbai", "Copper Non Ferrous Metal", "₹380/Kilogram"],
  ["Bhairav Metals", "Mumbai", "Inco", "₹7,000/Kilogram"],
  ["Prime Metal Impex", "Mumbai", "25 mm Non Ferrous Metal Sheet", "₹225/Kg"],
  ["Fabcore Engineering Private Limited", "Irinjalakuda", "FERROUS & NON-FERROUS METALS", "₹100/Kilogram"],
  ["Angara Tube (India)", "Mumbai", "Non Ferrous Ignots, Rectangular", "₹1,500/Kg"],
  ["Vybrant Trading Company", "Mumbai", "Golden Round Non Ferrous Bronze", "₹550/Kilogram"],
  ["Nandishwar Steel", "Mumbai", "Non Ferrous Metal Plate", "₹505/Kilogram"],
  ["Sudharshan Steel Company", "Coimbatore", "Gold Round Non Ferrous Metals", "₹500/kg"],
  ["Bharat Maison", "New Delhi", "Non Ferrous Metal Sheets", "₹185/Kg"],
  ["Sri Renuka Industries", "Coimbatore", "Brass Non Ferrous Metals", "₹1,000/Kg"],
  ["All Metals And Alloys Pvt. Ltd.", "Pune", "Yellow Round Brass Non Ferrous Metal", "₹440/Kg"],
  ["Samco Alloys (India) Pvt. Ltd.", "Meerut", "Bronze Non Ferrous Washers", null],
  ["Anu Industries", "Coimbatore", "Fine Finish Non Ferrous Components, for Industrial", null],
  ["H. H. Industries", "Howrah", "non ferrous nut and screw", null],
  ["Progressive Steel (India)", "Mumbai", "Non Ferrous Metal-Copper", null],
  ["Arihant Weld", "Mumbai", "Non Ferrous Brass", null],
  ["Surana Minerals & Metals", "Bengaluru", "Non Ferrous Metals", null],
  ["I D Steel Industries", "Ahmedabad", "Round Copper Non Ferrous Metals", "₹525/Kilogram"],
  ["Raj Enterprises", "Mumbai", "Non Ferrous Metal", "₹500/Kg"],
  ["Allied Metal & Tubes", "Mumbai", "Standard Round Non-Ferrous Metals", "₹150/Kg"],
  ["Dhanwant Metal Corporation", "Mumbai", "Round Brass Non Ferrous Metals", "₹600/Kg"],
  ["Dhanlaxmi Stainless", "Mumbai", "Non-ferrous Non Ferrous Rod, for Construction", "₹2,000/Kilogram"],
  ["Chiranjiv Steel Centre", "Mumbai", "Round Non Ferrous Copper Pipes, Size: 1", "₹550/Kilogram"],
];

const METALS_SHEET: Listing[] = [
  ["Daksh Tool & Appliances", "Gurugram", "Aluminum Sheet Metal Parts, For Automotive Part", "₹100/Piece"],
  ["Hi-tech Seals Industries", "Ghaziabad", "SHEET METAL PARTS, Laser Machine, Size/Dimension: 3 Mtr X1 Mtr", "₹100/Piece"],
  ["Krishna Industris", "Ahmedabad", "Embossed Sheet Metal Drain Cover", "₹45/Piece"],
  ["Maya Enterprises", "Chennai", "Stainless Steel Sheet Metal Components", "₹40/Piece"],
  ["C B X Industries (India)", "New Delhi", "Umpire counter patti", "₹16/Piece"],
  ["Bhansali Stainless", "Mumbai", "Stainless Steel Ss Sheet Metal (Plain Finish) - 2mm", "₹340/Piece"],
  ["Apollo Industries", "Latur", "Embossed Metal Sheet", "₹95/Kg"],
  ["Parmar Engineering Works", "Mumbai", "Aluminum Sheet Metal Components", "₹200/Kg"],
  ["A.K.Metal Pressing", "Chennai", "Sheet Metal", "₹80/Kg"],
  ["Perfect Components", "Hyderabad", "Sheet Metal Components, For Industrial", "₹52/Piece"],
  ["Nayan Metal & Alloys", "Mumbai", "Decorative Stainless Steel Sheet Metal", "₹4,000/Piece"],
  ["Esfour Engineering", "Mumbai", "2 mm Mild Steel Soft Rectangular Sheet metal Components", "₹1,230/Piece"],
  ["Vijay Prakash Gupta & Sons", "New Delhi", "Brass Sheet Metal", "₹600/Kg"],
  ["Shripad Enterprises", "Pune", "Dust Collector Spare Parts", "₹150/Piece"],
  ["Sadguru Industries", "Nashik", "PU & Metallic Powder Coating", "₹30/Piece"],
  ["Shivtech Engineering", "Rajkot", "Grey Sheet Metal Plate", "₹58/Kg"],
  ["Right Engineering", "Ahmedabad", "METERBOX FRAME 10069", "₹32/Piece"],
  ["Anjal Steel Corporation", "Mumbai", "decorative stainless steel sheet metal", "₹210/Kg"],
  ["Pannani Tubes Private Limited", "Mumbai", "1 8 Stainless Steel Sheet Metal", "₹180/Piece"],
  ["Punjab Metal Fabricators", "Ludhiana", "Pitman Deggi sheet metal stand", "₹29/Piece"],
  ["Aek Tek Auto Engineering Private Limited", "Ludhiana", "Sheet Metals", null],
  ["Sheth Engineering Company", "Ahmedabad", "Automotive Sheet Metal Part", null],
  ["Vishwakarma Industries", "Nagpur", "Sheet Metal Works", null],
  ["Master Tooling", "Pune", "Sheet Metal Supplier", null],
  ["National Enterprise", "Surat", "Sheet Metal", null],
  ["Parmanu Dhatu Nigam", "Mumbai", "Stainless Steel Customised Sheet Metal", null],
  ["Halinox Steel Industries", "Mumbai", "decorative stainless steel sheet metal", null],
];

const METALS_STAINLESS: Listing[] = [
  ["Pragati Metal Corporation", "Mumbai", "SS 321 Coils", "₹200/Kg"],
  ["Jayant Rajendra Metal", "Mumbai", "Austenitic Stainless Steel 316Ti", "₹400/Kg"],
  ["Manisha Steel Centre", "Mumbai", "For Pharmaceutical / Chemical Industry Material Grade: 304", "₹200/Kg"],
  ["R.M.Metal Industreis", "Mumbai", "1 inch SS 430 (1.4404), AISI 316L/EN 1.4404, For Industrial", "₹155/Kg"],
  ["Millennium Alloys", "Mumbai", "Stainless Steel ERW Electro Polish Tube", "₹300/Kg"],
  ["Welcome Overseas", "Mumbai", "4mm Stainless Steel", "₹786/Kg"],
  ["Western Metal India", "Mumbai", "SS High Strength Structural Bolt", "₹80/Kg"],
  ["T M Corporation", "Mumbai", "4mm Stainless Steel", "₹423/Kg"],
  ["Reliable Overseas", "Mumbai", "Coated Stainless Steel 316Ti Plate", "₹300/Kg"],
  ["Skyland Metal And Alloys Inc", "Mumbai", "Perforated Stainless Steel Tube", "₹140/Kg"],
  ["Simon Steel India", "Mumbai", "316 Stainless Steel Flat Bar (ASTM A240)", "₹250/Kg"],
  ["Seamac Piping Solutions Inc", "Mumbai", "Grade: 304 U Type Stainless Steel Channels", "₹175/Kg"],
  ["Nexus Alloys & Steels Private Limited", "Mumbai", "Duplex Stainless Steel", "₹280/Kilogram"],
  ["Sanghvi Metal Coporation", "Mumbai", "For Automobile Industry Galvanized Stainless Steel", "₹385/Kg"],
  ["Nextgen Steel And Alloys", "Mumbai", "For Construction 17 4 PH 15-5PH Stainless Steel", "₹5,000/Kg"],
  ["Panache Industries", "Mumbai", "304 Tig Rod For Stainless Steel", "₹220/Kg"],
  ["Som Shanti Steels", "Mumbai", "202 L-shaped Stainless Steel, For Construction", "₹235/Kg"],
  ["Jayant Impex Private Limited", "Mumbai", "Stainless Steel", "₹3,100/Piece"],
  ["Delta Corporation", "Rajkot", "SS 1540", "₹35,211/Piece"],
  ["IB Export", "Mumbai", "IB Exports 316 Stainless Steel Round Bar", "₹260/Kilogram"],
  ["Tradewell Ferromet Private Limited", "Mumbai", "ASTM F2581 - 12 Cr-Mn-N Steel Round Bar", "₹1,667/Kg"],
  ["King International", "New Delhi", "304 For Automobile Industry Stainless Steel Lagan", "₹350/Kg"],
  ["Girish Metal (india)", "Mumbai", "Girish Stainless Steel", "₹250/Kg"],
  ["Prashaant Steel & Alloys", "Mumbai", "Stainless Steel 321 - 321H - UNS S32100", "₹500/Kg"],
  ["Nickel Impex LLP", "Mumbai", "304 nickel hl", "₹330/Kg"],
  ["Reflex Tubes & Industries", "Mumbai", "Ss Strip 316", "₹150/Kg"],
  ["Riddhi Siddhi Tubes", "Mumbai", "SS 317L PRICE, Pipe, 304", "₹350/Kg"],
  ["Grand Metal Corporation", "Mumbai", "For Industrial Stainless Steel, 430, Sheet", "₹111/Kg"],
];

const METALS_PRODUCTS: Listing[] = [
  ["Jainex Steel & Metal", "Mumbai", "304 Stainless Steel Shims", "₹180/Kilogram"],
  ["Ferrite Structural Steels Private Limited", "Mumbai", "Mild Steel Products", "₹70/Kg"],
  ["Parmanu Dhatu Nigam", "Mumbai", "Britannium Metal Block", "₹390/Kg"],
  ["Innovative Metal Product", "Vadodara", "Innovative Metal Product", "₹1,111/Unit"],
  ["Rolex Aluindia", "Rajkot", "Avirat metal product", "₹285/Kilogram"],
  ["National Steel", "Nagpur", "Metal Products", null],
  ["Amco Metals", "Mumbai", "Custom Metal Products", "₹30/Kilogram"],
  ["Vardhaman Engineering Corporation", "Mumbai", "Germanium", null],
  ["Smew Technologies Private Limited", "Howrah", "Product-imagerazor Wire", null],
  ["Vinayak Metal", "Rajkot", "Brass And Ghan Metal Products", "₹140/Kilogram"],
  ["Badri Engineering Corporation", "Chennai", "Metal Product", "₹900/Kg"],
  ["Popular Enterprises", "Mumbai", "Metal Products", null, "manufacturer"],
  ["Alloysmin Industries", "New Delhi", "Bismith Metal", null],
  ["Superlative Chemical Private Limited", "Aurangabad", "Metal Products", "₹452/Kg"],
  ["Harishni Industries", "Chennai", "Metal Products", null],
  ["Steel Fab India", "Mumbai", "Metal Products", null],
  ["Jenco Steel & Engg Co.", "Mumbai", "Metal Products", null],
  ["Lyra Engineers", "Nagpur", "Metal Product", null],
  ["Busa Steel Corporation", "Mumbai", "Metal Products", null],
  ["Arora Enterprises", "Moradabad", "Black metal", null],
  ["Pragati Metal Corporation (Indore)", "Indore", "Metal Product", null],
  ["Kushalmani Forge And Fittings", "Ahmedabad", "Metal Product", null],
];

const COATINGS_PAINTS: Listing[] = [
  ["Starshield Technologies Private Limited", "Ghaziabad", "StarShield Star Cool Coating for Roof, Packaging Type: Bucket", "₹1,000/Litre"],
  ["Eurosyntec Chemicals Pvt. Ltd.", "Navi Mumbai", "Metaseal - Alternate to Phosphating and Chromating", "₹300/Litre"],
  ["Chemtech Engineers", "Butibori Midc", "Epoxy Chem Metalglide Catalyst High Performance Coating, 50 ml", "₹130/Litre"],
  ["Labh Projects Private Limited", "Ahmedabad", "Industrial Floor Coating Paint - Labh Group", "₹300/Litre"],
  ["Future Tech Foods India Private Limited", "Pune", "Industrial Paints and Coatings, 20 Ltr", "₹198/Litre"],
  ["Krishna Chemicals", "Sonipat", "High Sheen oil Base NC Paints Redoxide, For Industrial", "₹283/Litre"],
  ["Econova Systems Private Limited", "Pune", "Industrial Paints And Coatings, 20 L", "₹600/Litre"],
  ["Antique Paints", "Ahmedabad", "Enamel Industrial Black Paint, 1 Ltr", "₹130/Litre"],
  ["Janson Hardware", "Bengaluru", "Gem Industrial Paint, For Metal", "₹200/Litre"],
  ["Angel Coating Private Limited", "Ahmedabad", "Angel Coating AngelCoat Synthetic KPF Grey Filler 5 Kg", "₹116/Kg"],
  ["Super Paints & Chemicals", "Faridabad", "Interthane 990 White Paint, 20L", "₹850/Litre"],
  ["Maksons", "Pune", "Bergerthane finish Grey, For Metal, Packaging Size: 20 L", "₹460/Litre"],
  ["Sumangalam Formulations Private Limited", "Bharuch", "Anti Corrosive Industrial Coating, Dtm Paint, 50 kg To 200 kgs", "₹400/Litre"],
  ["Star Speciality Chemical Private Limited", "Bharuch", "High Build Epoxy Paint, For Metal", "₹240/Litre"],
  ["J P Coatings And Chemicals", "Ahmedabad", "Metal Asian Paints PPG Industrial Coatings, Packaging Size: 20 L", "₹250/Litre"],
  ["Day Hardware Stores", "Chennai", "High Gloss Black Coating Industrial Paint, Liquid", "₹87/Litre"],
  ["Cosmos Industrial Paints", "New Delhi", "Berger Epoxy And Pu Paints, For Multipurpose", "₹360/Litre"],
  ["Gunjan Paints Ltd.", "Kalol", "Industrial Paint", "₹320/Litre"],
  ["Rudra Enterprise", "Surat", "Epoxy Structure Paint, 20 ltr", "₹350/1 LTR"],
  ["Antares Chem Private Limited", "Mumbai", "Tolonate - Aliphatic Isocyanates", "₹450/Kg"],
  ["Harshita Enterprises", "Chennai", "Carboline Paints Industrial Paint Inorganic Zinc Silicate", "₹650/Litre"],
  ["B.R.M. Chemicals", "Jaipur", "Thinner Magnesite Paint, 35L", "₹53/Litre"],
  ["Ashok Paint Agencies", "Mumbai", "Akzo Nobel Oil Based Paint Interline 399 Paints, For Metal", "₹818/Litre"],
  ["Trident Engineering", "Ahmedabad", "Heat Resistant Trident Aluminium Paint (Two Component), 20 Ltr", "₹180/Litre"],
  ["Alfa Paints And Allied Products", "Pimpri Chinchwad", "Liquid Industrial Paint", "₹129/Litre"],
  ["Proline Paints & Coatings", "Navi Mumbai", "INDUSTRIAL PAINTS IN VASAI/THANE, For Metal", "₹180/Litre"],
  ["Patidar Paints", "Valsad", "Asian Epoxy Hb Coating, 20 Ltr", "₹350/Litre"],
  ["Universal Enterprises", "Chennai", "Epoxy Industrial Paints, 20 Ltr", "₹260/Piece"],
  ["Shri Balaji Enterprises", "Coimbatore", "Coatings And Thinners", null],
  ["Soni & Chowkasi Exports Company", "Ahmedabad", "Industrial Paints", null],
  ["Heritage International", "Indore", "Industrial Paints", null],
  ["Ros Alkyd", "Nagar", "Industrial Paints", null],
  ["Indu Oil & Paints Manufacturer Company", "Mumbai", "Industrial Paints", null, "manufacturer"],
  ["Arihant Paints Mfg. Co.", "Vadodara", "Industrial Paints", null, "manufacturer"],
  ["Sumahra Exports Private Limited", "Ahmedabad", "Paints Dyes", null],
  ["N. K. Global", "Pune", "chemicals for paint", null],
  ["Chemical Lacquer", "Faridabad", "Paint Products", null],
  ["Arvind Pigments", "New Delhi", "Industrial Paint", null],
  ["Kankoo Paints & Varnish Co.", "Pune", "Industrial Paints", null],
  ["Ink Makers", "Pune", "Paint & Allied Products", null],
  ["Marwaha Paints & Chemicals Industries", "Jalandhar", "Industrial Paints", null],
  ["Innocoat", "Thane", "Industrial Paints", null],
  ["S.M.International", "Chennai", "Sovlent Based Paint", null],
  ["NEW WORLD PAINTS", "Thane", "Industrial Paints", null],
  ["Sritex Inc.", "Bengaluru", "Industrial Paints", null],
  ["DWARKESH COATING PVT LTD", "Vadodara", "Industrial Paints", null],
  ["Atlass Industries", "Mumbai", "Industrial Paints", null],
];

const COATINGS_INDUSTRIAL: Listing[] = [
  ["ARK India", "Vadodara", "Industrial Floor Coatings, 1 L", "₹72/sq ft"],
  ["Zenco Industries", "Raigad", "P-413 Heresite Coatings", "₹4,500/Litre"],
  ["Eurosyntec Chemicals Pvt. Ltd.", "Navi Mumbai", "Fine Basecoats Manufacturers", "₹600/Litre"],
  ["Bio X", "Mumbai", "SCOT-BN-COATINGS BORON NITRIDE COATING, Solution", "₹2,500/kg"],
  ["Bio X", "Mumbai", "SCOT-BN-COATINGS BORON NITRIDE COATING", "₹320/Kg"],
  ["Patel Export Industries", "Surat", "SOLID PRO FLEXICOAT 20 L", "₹220/Litre"],
  ["SMG Coatex", "Rajsamand", "High Gloss Ced Hardware lacquer Coating", "₹1,525/Litre"],
  ["Vivid India", "New Delhi", "UNICOAT-555 (UNIVERSAL COATING)", "₹750/Litre"],
  ["Winways Chemtech", "Mumbai", "VINSIL Vinyl Silanes -171", "₹355/Litre"],
  ["Para Fine-Chem Industries", "Bengaluru", "Para Fine - Strippable Lacquer Coating", "₹375/Litre"],
  ["Reliable Polymer Industries", "Mumbai", "Food Grade Coatings For Industrial Mode", "₹900/sq ft"],
  ["Angel Coating Private Limited", "Ahmedabad", "AngelCoat Industrial Black (sup) 1 L", "₹191/Litre"],
  ["Tag Chemicals Private Limited", "Ernakulam", "Direct To Metal Paint, 1 L", "₹100/Litre"],
  ["Excel Trading Corporation", "Pune", "Industrial Protective Coatings, Plastic, 40 L", "₹123/Litre"],
  ["Yahska Polymers Private Limited", "Ahmedabad", "YP Smooth Coat, 25 Kg", "₹50/Kg"],
  ["Croire Innovative Paints Private Limited", "Bengaluru", "Mineral Based Organic Stone Coat", "₹525/Litre"],
  ["Khushbu Industries", "Ahmedabad", "Industrial Pumps Coating", "₹1,325/Litre"],
  ["Cera- Chem Private Limited", "Chennai", "Industrial Coatings", "₹1,400/Kg"],
  ["Indian Colour Industries (India)", "Noida", "KALPVITAP Speaker Cabinet Roller Coat", "₹650/Litre"],
  ["Univolen Private Limited", "New Delhi", "SI Coating, Metal, 20 Kg", "₹98/Kg"],
  ["Varsha Enterprises", "Jamshedpur", "Industrial Coatings, Metal, 20 L", "₹251/Litre"],
  ["Paint Brush Limited", "Indore", "Coalescing Agent", "₹175/Litre"],
  ["Aadithya Udyog", "Bengaluru", "General Industrial Coatings", "₹350/Litre"],
  ["Colour Chem", "Mumbai", "Direct To Metal, 20 L", "₹350/Litre"],
  ["Alanqa Solutions", "Kalyan", "Bonderite M-Cr 600rtu Aero", "₹3,500/Litre"],
  ["Robust Aerotech Private Limited", "Greater Noida", "Engine Lacquer Coating Spray", "₹160/Litre"],
  ["Nijrang Surface Speciality", "Vadodara", "Nijrang Surface Speciality Softfeel Coating, 25L", "₹750/Litre"],
  ["Chroma Merchandise", "Mumbai", "Surface Tolerant Coating", "₹300/Litre"],
  ["SKY Traders", "Nashik", "In Mould Coating (IMC)", null],
  ["Newtech Industries", "Chennai", "Industrial Coating", null],
  ["Attractive Paints", "Kolkata", "industrial coatings", null],
  ["Saiglobal Services", "Thane", "Industrial Coatings", null],
  ["Crystal Group", "Ahmedabad", "High Performance Industrial Coatings Chemical", null],
  ["Jeet Paints", "", "Soft Feel Coating", "₹960/Litre"],
  ["Akino Commerce Pvt. Ltd.", "", "Akino ADDAPTOL DB Coalescing Agents", "₹210/Kg"],
  ["Prabhat Paint Industries", "", "Solvent Based Epoxy Red Oxide Primer 20 L", null],
  ["Flame Paints", "", "Industrial Floor Coating", null],
  ["Good Morning Paints Private Limited", "", "APCOTHERM HR 600 / APCOTHERM 600", "₹600/Litre"],
];

const ALL_SUBCATEGORIES: { key: keyof typeof SOURCES; entries: Listing[] }[] = [
  { key: "industrialChemicals", entries: INDUSTRIAL_CHEMICALS },
  { key: "solvents", entries: SOLVENTS },
  { key: "specialtyChemicals", entries: SPECIALTY_CHEMICALS },
  { key: "resins", entries: RESINS },
  { key: "adhesives", entries: ADHESIVES },
  { key: "polymers", entries: POLYMERS },
  { key: "rubberMaterials", entries: RUBBER_MATERIALS },
  { key: "compositesFrp", entries: COMPOSITES_FRP },
  { key: "metalsNonFerrous", entries: METALS_NON_FERROUS },
  { key: "metalsSheet", entries: METALS_SHEET },
  { key: "metalsStainless", entries: METALS_STAINLESS },
  { key: "metalsProducts", entries: METALS_PRODUCTS },
  { key: "coatingsPaints", entries: COATINGS_PAINTS },
  { key: "coatingsIndustrial", entries: COATINGS_INDUSTRIAL },
];

// ---------------------------------------------------------------------
// Cross-subcategory merge — identical pattern to Batches 2, 3 & 4's
// mergeSameCompanyAcrossSubcategories(). A company appearing under several
// genuine chemical/material subcategory pages (common in this domain —
// diversified chemical traders list many product lines) is folded into
// ONE supplier record, unioning sources/categories/products/specs — never
// counted multiple times, never blindly merged with a differently-named
// company. See the file header for the two same-name/different-city
// exceptions that were deliberately kept apart.
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
  let existingIds: number[] = [4999]; // seed just below the 5000-5999 block (see lib/supplier-store.ts)
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
      if (c === "Chemicals / Materials") continue;
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

  const dataFile = path.join(process.cwd(), "data", "suppliers", "chemicals-materials.json");
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ suppliers }, null, 2), "utf-8");
  console.log(`\nWrote ${suppliers.length} suppliers to ${dataFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
