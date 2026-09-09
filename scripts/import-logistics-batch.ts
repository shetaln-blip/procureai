// Ingestion run: Logistics supplier batch (India-wide) — Batch 10 of the
// master plan, ninth per-category dataset added to the existing multi-file
// supplier repository (see lib/supplier-store.ts's id-block scheme). Same
// architecture as every prior batch: normalizeSupplierRecord /
// computeDataConfidence / computeDedupeKey / findPotentialDuplicates from
// the existing lib/ingestion + lib/dedup modules — nothing new invented.
//
// SCOPE: this category covers companies that supply logistics/material-
// handling EQUIPMENT to businesses (forklifts, pallets, racking, trolleys,
// conveyors, refrigerated/cold-chain equipment) — not e-commerce parcel
// shipping or freight-forwarding SERVICES, which are a different kind of
// listing IndiaMART does not catalog the same way.
//
// SOURCES: 8 pan-India IndiaMART "impcat" category pages spanning 6 natural
// groups — Material Handling Equipment (forklifts), Packaging & Crating
// (wooden pallets), Warehouse Racking & Storage Systems (industrial storage
// racks), Industrial Trolleys & Trucks (hand trolleys, platform trolleys,
// hydraulic lifting trolleys), Conveyor Systems (belt conveyors, roller
// conveyors), Cold Chain & Refrigerated Logistics Equipment (refrigerated
// containers, cold storage equipment).
//
// RESEARCH NOTE: raw listing data was gathered via two parallel research
// passes, each WebFetching every subcategory's base URL and its "?pg=2"
// variant (which for several categories redirected to a business-type-
// filtered "?biz=NN" view — treated as the union per the established
// technique) and transcribing every listing verbatim.
//
// INCLUSION RULE applied while curating the raw listings below:
//   - EXCLUDED: foreign companies not based in India.
//   - EXCLUDED: listings that are purely a reseller of ONE specific named
//     foreign brand via an otherwise-unrelated trading company with no
//     stated Indian own-business evidence (e.g. "M-Tech Solutions"
//     reselling Emerson cold-storage units under a generic trading name).
//     A company name that plausibly indicates a genuine relevant business
//     was NOT auto-excluded for listing one foreign brand (e.g. "Divine
//     Cooling System" naming Thermo King reefer containers) — judged
//     case-by-case, consistent with every prior batch.
//   - EXCLUDED: spare-parts/component-only listings (a bare forklift
//     steering unit, a conveyor roller, a coldroom compressor, a reefer-
//     container generator or monitoring accessory) rather than a complete
//     product.
//   - EXCLUDED: rental/hire-only listings (not products for sale) —
//     "Diesel Forklift Rental", "Refrigerated Container Rental Service",
//     "Refrigerated Reefer Container on Hire".
//   - EXCLUDED: listings for a clearly unrelated business that surfaced by
//     keyword coincidence (a weighing-scale company's "forklift scale", a
//     furniture company's pallet-style bed, a mortuary equipment company's
//     body-lifting trolley, a dance academy, kitchen-equipment companies'
//     generic "food storage equipment" with no literal cold/refrigeration
//     wording, an IT data-center "cold aisle containment" unit, a pizza-
//     prep unit, an industrial-fasteners company, a lighting-technology
//     company, an office-solutions company).
//   - A company name alone was NOT used to exclude a listing whose title
//     carried genuine logistics-equipment evidence — same rule as every
//     prior batch.
//
// MANUFACTURER/DISTRIBUTOR/TRADER STATUS: left unset ("unknown") unless a
// literal, unambiguous business-type word appears on the listing itself.
// One listing literally says "Manufacturer" in the title ("Excel Stainless
// Steel Belt Conveyors Manufacturer") — mapped to "manufacturer". Every
// other listing in this batch is left unset.
//
// TECHNICAL SPECS: extracted only when literally present in the title —
// load capacity in tons/kg, size in feet/mm/meters — via
// parseLogisticsSpecs(). Nothing is inferred beyond the title text.
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
  forklifts: {
    subcategory: "Forklifts & material handling equipment",
    group: "Material Handling Equipment",
    url: "https://m.indiamart.com/impcat/forklift.html",
    sourceName: "IndiaMART — Forklift directory",
  },
  woodenPallets: {
    subcategory: "Wooden pallets & crating",
    group: "Packaging & Crating",
    url: "https://m.indiamart.com/impcat/wooden-pallets.html",
    sourceName: "IndiaMART — Wooden Pallets directory",
  },
  storageRacks: {
    subcategory: "Warehouse storage racks",
    group: "Warehouse Racking & Storage Systems",
    url: "https://m.indiamart.com/impcat/storage-racks.html",
    sourceName: "IndiaMART — Storage Racks directory",
  },
  trolleys: {
    subcategory: "Industrial trolleys & hydraulic lifting trucks",
    group: "Industrial Trolleys & Trucks",
    url: "https://m.indiamart.com/impcat/hand-trolley.html",
    sourceName: "IndiaMART — Hand Trolley / Platform Trolley / Hydraulic Lifting Trolley directories",
  },
  conveyors: {
    subcategory: "Belt & roller conveyor systems",
    group: "Conveyor Systems",
    url: "https://m.indiamart.com/impcat/conveyor-system.html",
    sourceName: "IndiaMART — Conveyor System / Belt Conveyors / Roller Conveyor directories",
  },
  coldChain: {
    subcategory: "Refrigerated containers & cold storage equipment",
    group: "Cold Chain & Refrigerated Logistics Equipment",
    url: "https://m.indiamart.com/impcat/refrigerated-containers.html",
    sourceName: "IndiaMART — Refrigerated Containers / Cold Storage Equipment directories",
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
  Bhuj: "Gujarat",
  Dewas: "Madhya Pradesh",
  Anand: "Gujarat",
  Mahesana: "Gujarat",
  Nadiad: "Gujarat",
  Padra: "Gujarat",
  Borsad: "Gujarat",
  Valsad: "Gujarat",
  Kagal: "Maharashtra",
  Sangamner: "Maharashtra",
  // Rajasthan
  Jaipur: "Rajasthan",
  // Maharashtra
  Mumbai: "Maharashtra",
  Thane: "Maharashtra",
  "Navi Mumbai": "Maharashtra",
  Pune: "Maharashtra",
  "Pimpri Chinchwad": "Maharashtra",
  Nashik: "Maharashtra",
  Kalyan: "Maharashtra",
  Vasai: "Maharashtra",
  Bhiwandi: "Maharashtra",
  Aurangabad: "Maharashtra",
  Kolhapur: "Maharashtra",
  Sangli: "Maharashtra",
  // Delhi
  "New Delhi": "Delhi",
  Delhi: "Delhi",
  // Uttar Pradesh
  Noida: "Uttar Pradesh",
  "Greater Noida": "Uttar Pradesh",
  Ghaziabad: "Uttar Pradesh",
  Meerut: "Uttar Pradesh",
  Muradnagar: "Uttar Pradesh",
  Lucknow: "Uttar Pradesh",
  Agra: "Uttar Pradesh",
  Bulandshahr: "Uttar Pradesh",
  // Telangana
  Hyderabad: "Telangana",
  Secunderabad: "Telangana",
  // Tamil Nadu
  Chennai: "Tamil Nadu",
  Coimbatore: "Tamil Nadu",
  Kancheepuram: "Tamil Nadu",
  Vellore: "Tamil Nadu",
  Tiruvallur: "Tamil Nadu",
  Tiruppur: "Tamil Nadu",
  Kunnathur: "Tamil Nadu",
  Hosur: "Tamil Nadu",
  Vellaravalli: "Tamil Nadu",
  Krishnagiri: "Tamil Nadu",
  Chettipalayam: "Tamil Nadu",
  // Karnataka
  Bengaluru: "Karnataka",
  Mysore: "Karnataka",
  Mangalore: "Karnataka",
  // Haryana
  Gurugram: "Haryana",
  Gurgaon: "Haryana",
  Faridabad: "Haryana",
  Manesar: "Haryana",
  Kharkhoda: "Haryana",
  // Punjab
  Ludhiana: "Punjab",
  Jalandhar: "Punjab",
  "Dera Bassi": "Punjab",
  // Madhya Pradesh
  Indore: "Madhya Pradesh",
  // West Bengal
  Kolkata: "West Bengal",
  Howrah: "West Bengal",
  "South 24 Parganas": "West Bengal",
  Tamluk: "West Bengal",
  Belghoria: "West Bengal",
  Tarakeswar: "West Bengal",
  // Chandigarh
  Chandigarh: "Chandigarh",
  // Assam
  Guwahati: "Assam",
  // Chhattisgarh
  Raipur: "Chhattisgarh",
  Abhanpur: "Chhattisgarh",
  // Kerala
  Ernakulam: "Kerala",
  // Goa
  Mapusa: "Goa",
  // Bihar
  Patna: "Bihar",
  // Jammu and Kashmir
  Kathua: "Jammu and Kashmir",
  // Haryana (additional)
  Sonipat: "Haryana",
  // Rajasthan (additional)
  Udaipur: "Rajasthan",
  Bhiwadi: "Rajasthan",
  // Haryana (additional)
  Karnal: "Haryana",
  Ambala: "Haryana",
  // Uttar Pradesh (additional)
  Dadri: "Uttar Pradesh",
  Kanpur: "Uttar Pradesh",
  // West Bengal (additional)
  Naiti: "West Bengal",
};

function locationFor(city: string): string {
  const cleanCity = city.split(",")[0].trim();
  if (!cleanCity) return "";
  const state = STATE_BY_CITY[cleanCity];
  return state ? `${cleanCity}, ${state}` : cleanCity;
}

// Literal-evidence-only technical spec extraction — same discipline as
// every prior batch's spec parser.
function parseLogisticsSpecs(title: string): string[] {
  const specs: string[] = [];
  const push = (label: string) => {
    if (!specs.includes(label)) specs.push(label);
  };

  const tonMatch = title.match(/(\d+(?:\.\d+)?)\s*[Tt]on(?:s)?\b/);
  if (tonMatch) push(`${tonMatch[1]} ton`);

  const kgMatch = title.match(/(\d+(?:\.\d+)?)\s*[Kk]g\b/);
  if (kgMatch) push(`${kgMatch[1]} kg`);

  const feetMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:feet|ft|foot)\b/i);
  if (feetMatch) push(`${feetMatch[1]} ft`);

  const mmMatch = title.match(/(\d+(?:\.\d+)?)\s*mm\b/i);
  if (mmMatch) push(`${mmMatch[1]}mm`);

  const mtrMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:mtr|meters?|metres?)\b/i);
  if (mtrMatch) push(`${mtrMatch[1]} m`);

  return specs;
}

function rawRecordsForSubcategory(
  key: keyof typeof SOURCES,
  entries: Listing[]
): RawSupplierRecord[] {
  const { subcategory, group, url, sourceName } = SOURCES[key];
  const categories = Array.from(new Set(["Logistics", group, subcategory]));

  return entries.map(([companyName, city, title, price, bizType]) => {
    const specs = parseLogisticsSpecs(title);
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

const FORKLIFTS: Listing[] = [
  ["QT Services", "Sangamner", "QTS Forklifts, Capacity: 1", "₹1,00,000"],
  ["Stackers & Movers India Manufacturing Company", "Ahmedabad", "MS Industrial Forklifts", "₹9,50,000"],
  ["Nandhi Technologies", "Bengaluru", "Nandhi Heavy Forklift 12T to 45T, Model Name/Number: CPCD 120-450", "₹22,00,000"],
  ["M. N. Engineering Solutions", "Gurugram", "BYD ECB40 Counterbalanced Forklift", "₹45,00,000"],
  ["Jain Sales Corporation", "Mumbai", "Diesel Forklift (4 Ton and 5 Ton)", "₹13,99,999"],
  ["Urja Systems", "Greater Noida", "Godrej 3000-5000 mm Electric Forklift Truck, Side Loader, Capacity: 4.0", "₹13,95,000"],
  ["Shree Modi Material Handling Co.", "Surat", "Electric Pallet Stackers., DC", "₹5,50,000"],
  ["New National Hydraulics", "Noida", "V-Series Three Wheel Forklift, Order Picker", "₹9,50,000"],
  ["Vimal Industries", "Pune", "Vimal Fork lift vehicle, For Industrial, Pallet Lifter", "₹15,00,000"],
  ["Stacker S And Mover S (I) Mfg. Co.", "Ahmedabad", "Engine Powered Forklift - 3 Ton Lift Capacity (3000-5000 mm)", "₹9,70,000"],
  ["Indian Lifters", "Pune", "Material Handling Forklift", "₹40,000"],
  ["Githa Equipments Private Limited", "Bengaluru", "4Ton Electric Forklift, For Industrial, Pallet Lifter", "₹51,50,000"],
  ["The Kovai Forklifts", "Coimbatore", "ACE Electric Forklift", "₹10,50,000"],
  ["Shaktiman Equipments Private Limited", "Chennai", "Forklifts, For Lifting", "₹1,00,000"],
  ["Swastik Manufacturing Solutions", "Chennai", "YALE SIT ON REACH TRUCKS", "₹24,00,000"],
  ["Shree Balaji Equipments Private Limited", "Kolkata", "2 Ton GX 200 E Godrej Forklift, For Warehouse", "₹12,12,000"],
  ["Digital Automation", "Vadodara", "5 Ton Forklift Dvx 50 Fc For Sale, Pallet Lifter,", "₹3,10,000"],
  ["Bharat Lifter", "Mumbai", "32 TON HYSTER FORKLIFT WITH COILRAM ATTACHMENT, COIL LIFTER, Model Name/Number: 2013", "₹4,50,000"],
  ["Sendhamarai Engineering Private Limited", "Chennai", "Red Lotus Forklift, Side Loader, For Lifting", "₹15,00,000"],
  ["DSK Sales & Services", "Mumbai", "Kion Om Forklift, For Lifting", "₹10,12,000"],
  ["Vedant Lift", "Pune", "Forklift Battery Operated", "₹45,95,000"],
  ["New Thai Pack Technologies", "Coimbatore", "Diesel Forklift Suppliers, Pallet Lifter, For Industrial", "₹8,60,000"],
  ["Trans Cargo Services", "Kolkata", "5 ton Forklift, For Lifting", "₹9,50,000"],
  ["Haul Material Handling", "Coimbatore", "4 Ton Battery Operated Forklift, For Lifting", "₹15,50,000"],
  ["Hi Tech Industries", "Kunnathur", "Forklift Loader, Pallet Lifter, For Lifting", "₹4,12,000"],
  ["National Fork Lifters", "Hosur", "Ace Forklift Af30d - Diesel Forklift - 3 Ton lifting Capacity - 3.6mtr Height", "₹11,50,000"],
  ["Hefty Industrial Equipments", "Chennai", "Hefty Electric Forklift In Chennai", "₹18,00,000"],
  ["Omlift India Private Limited", "Pune", "Forklift kej, For Industrial", "₹31,500"],
  ["Gomadhi Engineering Service", "Vellaravalli", "Gomadhi Tractor Mounted Forklift, For Lifting", "₹8,26,000"],
  ["Siddhapura Engineering Works", "Rajkot", "CPDS18 Three Wheels Battery Powered Forklift", "₹8,25,000"],
  ["Agromec", "Meerut", "Hydraulic Fork Lifter, For Lifting", "₹58,000"],
  ["Prompt Packways", "Faridabad", "Battery Operated Forklift, 3 Ton", "₹13,00,000"],
  ["Sitaram Engineering Works", "Pimpri Chinchwad", "Godrej Diesel Forklift, For Lifting, Pallet Lifter", "₹3,50,000"],
  ["Newgen Lifts India Private Limited", "Bengaluru", "Newgenlifts Diesel Forklift Truck", "₹12,00,000"],
  ["Sca Heavy Equipment Pvt. Ltd.", "Bengaluru", "12 Ton Forklifting", null],
  ["D.K.Industries", "Abhanpur", "Tractor Mounted Forklift, Wheel Loader, For Industrial", null],
  ["FB Varuna Industries", "Vapi", "3.5 Ton Premium OM Electric Forklifts", null],
  ["Rishwa Engineering And Rentals Pvt. Ltd.", "Chennai", "Jac Forklift, For Industry", "₹8,90,000"],
  ["Jost'S Engineering Company Limited", "Thane", "Josts JFDH20 Diesel Forklift", "₹8,25,000"],
];

const WOODEN_PALLETS: Listing[] = [
  ["Rajratan Industries Private Limited", "Indore", "Wooden Pallets .", "₹1,400/Piece"],
  ["Micropack Ventures Private Limited", "Ahmedabad", "Brown Wooden Pallets, 800mm X 1200mm", "₹800/Piece"],
  ["Shree Krishna Saw Mill", "Ahmedabad", "Euro Pallet Rubber Wood Wooden Pallets Skids, For Packaging / Shipping", "₹550/Cubic Feet"],
  ["Mapac Technology", "Bhuj", "1300x1200mm Wooden Pallet", "₹980/Piece"],
  ["Packsafe Industries", "Bhiwadi", "Wooden Pallets Heat Treatment", "₹700/Piece"],
  ["Industrial Thermal Engineers", "Ahmedabad", "Wooden Pallets, 800mm X 1200mm", "₹1,450/Piece"],
  ["Accurate Box Manufacturers", "Rajkot", "Jungle Wooden Pallets", "₹880/Piece"],
  ["Suresh Timber Company", "Vadodara", "Neem & Babool wood Yellow Wooden Pallets For Domestic Storage", "₹1,600/Piece"],
  ["Vijay Wood Industries", "Bengaluru", "Heat Treated Wooden Pallet", "₹1,010/Piece"],
  ["Esteem Lumbers Private Limited", "Kancheepuram", "Rack System Wooden Pallet, 800 mm X 1200 mm", "₹1,000/Piece"],
  ["Jagtat Wood Packsafe", "Rajkot", "1000 X 1000 Euro Wooden Pallets", "₹1,700/Piece"],
  ["Atlanta Global", "Kalyan", "Export And Warehouse Compresses wooden pallets Molded Wood Pallets", "₹1,000/Cubic Feet"],
  ["Ambica Patterns India Pvt. Ltd.", "Bengaluru", "Single Wing Wooden Pallet", "₹1,200/Piece"],
  ["Hindustan Packaging System", "Ghaziabad", "CP3 Wooden Pallet (1200mm X 1000mm)", "₹950/Piece"],
  ["Trinity Packaging Company Private Limited", "Mumbai", "Brown Rectangular Wooden Pallet", "₹1,200/Piece"],
  ["Gourashi Company", "Dewas", "Industrial Wooden Pallets", "₹950/Piece"],
  ["Balasubramaniam Industries", "Chennai", "1 Ton Pine Wooden Pallet", "₹1,000/Piece"],
  ["Sharma Timber Works", "Kolkata", "Mixed Color Jungle Wood Wooden Pallets", "₹850/Piece"],
  ["Surindra Business & Contracting", "Karnal", "Jungle Wood Pallet", "₹805/piece"],
  ["Pavnai Industries", "Mapusa", "Soft Wood 2 Way Wooden Pallet", "₹750/Piece"],
  ["Foofishin", "Ernakulam", "wooden pallets for shipping", "₹1,200/Piece"],
  ["Royal Packs Industries", "Navi Mumbai", "Pine Wood Pallets ., 1200mm X 1000mm", "₹750/Piece"],
  ["Bubble Pacage Private Limited", "Chennai", "Wooden Pallet", "₹80/Piece"],
  ["Export Cargo Packaging", "Hyderabad", "Fumigated Wooden Pallets, 1000 mm X 1000 mm", "₹1,200/Piece"],
  ["Shri Krishna Vijay Saw Mill", "Aurangabad", "Heavy Duty Wooden Pallets", "₹1,850/Piece"],
  ["Jadaun Technomech India Private Limited", "Ahmedabad", "Heavy Duty Wooden Pallet", "₹1,400/Piece"],
  ["Wooden Fab", "Tiruvallur", "Press Wood Pallet, 1000 x 1200 x 138 mm", "₹600/Piece"],
  ["Europack", "Mumbai", "Cp6 Wooden Pallet", "₹1,400/Piece"],
  ["Shree Packaging", "Mumbai", "Wooden Pallets", "₹800/Piece"],
  ["The Zoya Stores", "Vasai", "Wooden Pallets", "₹550/Piece"],
  ["Labline Trading Co.", "Hyderabad", "Labline Rectangular And Square Wooden Pallet", "₹800/Piece"],
  ["Shri Vishwakarma Furniture Works", "Pune", "Wooden Pallets", "₹850/Piece"],
  ["Rajat Packers", "Pune", "Wooden Packing Pallet", "₹1,500/Piece"],
  ["A-One Pallets", "Vadodara", "Export Wooden Pallets", "₹850/Piece"],
  ["A G S Enterprises", "Meerut", "1200X800 mm Hardwood Pallets", "₹480/Piece"],
  ["Perfect Packers & Traders", "Faridabad", "Wooden Pallets", "₹450/Piece"],
  ["Navjeevan Corp", "Pune", "Cp 7 Pallet, 1300mm X 1100mm", "₹1,031/Piece"],
  ["Roy Wooden Suppliers", "Tamluk", "Shessam Wood Pallet", "₹1,450/Piece"],
  ["Shri Laxmi Timber Mart", "Vadodara", "Packaging Wooden Pallets", "₹1,051/Piece"],
  ["Rashi Trading Company", "Dadri", "Epal Certified Wooden Shipping Pallet", "₹1,000/Piece"],
  ["Empire Wood Packing Solution", "Navi Mumbai", "1200x1000mm Pinewood Pallet", "₹850/Piece"],
  ["Rajanaa Wood", "Chennai", "Square Brown Four Way Wooden Pallets", "₹500/Piece"],
  ["Navin Timber Traders", "Borsad", "Industrial Wooden Pallets", "₹750/Piece"],
  ["Balaji Pallets Private Limited", "Ahmedabad", "Box Rectangular Soft wood Wooden Pallets, Capacity: 1000 kg", "₹600/Piece"],
  ["God Rise Storage System", "Muradnagar", "Soft Wooden Pallet", "₹900/Piece"],
  ["MK Industries", "Aurangabad", "Rectangular Wooden Pallets", "₹800/Piece"],
  ["J S Enterprise", "Valsad", "Rectangular Brown 3 Way Wooden Pallets For Shipping, Capacity: 60 Kg", "₹850/Piece"],
  ["Aryan Export Packers", "Kagal", "Jungle Wooden Pallet", "₹950/Piece"],
  ["Bhagwati Enterprises", "Jaipur", "Timber Wood Pallet Base", "₹65/Piece"],
  ["Vaikunda Selvam Enterprises", "Chennai", "Wooden Pallets", "₹420/Piece"],
  ["S.A Global Venture", "Bulandshahr", "25mm CP3 Wooden Pallets", null],
  ["Unique Ply & Timber", "South 24 Parganas", "2 Way Jungle Wood Wooden Pallets", "₹750/Piece"],
  ["Maa Vindhyavasini Traders & Co.", "Patna", "Industrial Wooden Pallets, 1200mm X 1000mm", "₹1,200/Piece"],
];

const STORAGE_RACKS: Listing[] = [
  ["Smart Storage Creation Private Limited", "Vasai", "8 Feet Industrial Storage Rack", "₹7,000/Piece"],
  ["Anmol Engineers", "Ludhiana", "Industrial Storage Rack, 7 ft", "₹13,500/Piece"],
  ["Sharang Corporation", "Pune", "Mild Steel Industrial Storage Rack", "₹45,000/Piece"],
  ["Sanghvi Metal Corporation", "Mumbai", "Mild Steel Free Standing Unit Shuttle Pallet Racking", "₹650/Kg"],
  ["Equipments & Interiors Private Limited", "Mumbai", "Mobistor Industrial Racks, 8 ft (2438 mm), 5", "₹15,000/Piece"],
  ["Annai Fabrication", "Coimbatore", "Mild Steel Industrial Storage Rack, 5 Ft", "₹9,800/Piece"],
  ["The Global Pharma Equipments", "Vasai", "Pharmaceutical Steel Racks", "₹22,800/Unit"],
  ["Mini Fabrication", "Mumbai", "Mild Steel Office Slotted Storage Racks", "₹1,200/Piece"],
  ["H V Engineering", "Vadodara", "M-08 Double Decker Fifo Rack", "₹15,000/Piece"],
  ["Myriad Storage System LLP", "Mumbai", "Industrial Storage Rack, 200 kg", "₹23,500/Piece"],
  ["Harrisons Pharma Machinery Private Limited", "New Delhi", "Multipurpose Storage Rack (6 ft Height x 18 inch)", "₹25,750/Piece"],
  ["Dhanvee Corporation", "Vadodara", "100 Kg SS Industrial Storage Rack", "₹19,000/Piece"],
  ["Labh Projects Private Limited", "Ahmedabad", "Long Span Storage Racking Shelving System", "₹12,000/Piece"],
  ["Synergy Technics", "Ahmedabad", "Stainless Steel Storage Rack, For Commercila", "₹24,500/Number"],
  ["SRG International Pvt. Ltd", "Faridabad", "Light Duty Storage Rack", "₹9,500/Number"],
  ["Reco Storage Systems Private Limited", "Pune", "MS Roll Storage Rack, Storage Capacity: 1000 KG", "₹25,000/Piece"],
  ["Ethics Infinty Private Limited", "Surat", "Sliding Shelving Rack, Load per Layer: 500 kg", "₹20,000/Piece"],
  ["Micro Sheet Crafts (India) Private Limited", "New Delhi", "Long Span Storage Rack, Upto 12ft", "₹90/Kg"],
  ["Lokpal Industries", "New Delhi", "Industrial Storage Rack", "₹18,900/Unit"],
  ["Infinity Engineering Services", "Padra", "Industrial Storage Rack", "₹25,000/Piece"],
  ["Vishvkarma Machine Tools", "Ambala", "Industrial Storage Rack", "₹5,500/Piece"],
  ["Opcieas", "Bengaluru", "Alloy Steel Powder Coated Storage Rack", "₹5,400/Piece"],
  ["Ratan Enterprises", "Pune", "Industrial Warehouse Storage Rack", "₹45,000/Piece"],
  ["Blue Sky System Private Limited", "New Delhi", "Industrial Storage Rack", "₹2,05,000/Piece"],
  ["Well India Racking System", "Muradnagar", "Steel Warehouse Long Span Rack", "₹100/Kg"],
  ["Sathya Corporation", "Chennai", "MS Industrial Storage Rack - IMPORTED, 5", "₹12,975/Piece"],
];

const TROLLEYS: Listing[] = [
  ["Baroda Polyform Pvt Ltd", "Vadodara", "Polyethylene Hand Trolley", "₹8,000/Piece"],
  ["Anmol Engineers", "Ludhiana", "Mild Steel Rubber Manual Hand Trolly, For Material Handling", "₹8,500/Piece"],
  ["Stackers & Movers India Manufacturing Company", "Ahmedabad", "SS Hand Trolley", "₹10,999/Piece"],
  ["Tech Mech Handling Equipments", "Meerut", "Folded Hand Trolley", "₹6,500/Piece"],
  ["Universal Technologies", "Pune", "Universal 965 Material Hand Trolley, Load Capacity: 300kg", "₹6,500/Piece"],
  ["Clean & Green Equipments Private Limited", "Ghaziabad", "Hand Cart Trolley", "₹4,500/Piece"],
  ["Manthan Sales Corporation", "Ahmedabad", "Plastic Industrial Material Handling Trolley", "₹4,800/Piece"],
  ["Spiderman Technology India Private Limited", "Chennai", "Hand Trolley", "₹3,500/Piece"],
  ["Lokpal Industries", "New Delhi", "Platform Hand Trolley", "₹3,500/Piece"],
  ["Shree Modi Material Handling Co.", "Surat", "GUJARAT Mild Steel Hand Trolley GT114", "₹5,700/Piece"],
  ["New National Hydraulics", "Noida", "Black Foldable Hand Platform Trolley", "₹5,000/Piece"],
  ["Max Lift", "Chennai", "Hand Cart Trolley", "₹5,000/Piece"],
  ["Tamilnadu Engineering Instruments", "Chennai", "Hand Trolley", "₹5,500/Piece"],
  ["Solutions Packaging", "Ludhiana", "Hand Trolley HT-1805", "₹2,500/Piece"],
  ["Forcelift Material Movements", "Bengaluru", "Forcelift Heavy Duty Platform Trolley", "₹35,000/Unit"],
  ["Mathewsons Exports And Imports Pvt. Ltd.", "Ernakulam", "Material Handling Trolleys", "₹4,750/Piece"],
  ["Vimal Industries", "Pune", "Mild Steel Sack Hand Trolley", "₹6,500/Piece"],
  ["L T Equipments India", "Mumbai", "Mild Steel Hand Trolley", "₹4,000/Piece"],
  ["Sorikal Wheels", "Bhiwandi", "Iron Nylon Hand Trolly, Load Capacity: Up to 50 kg", "₹5,700/one pc"],
  ["Ashirwad Sales", "Jalandhar", "Hand Cart Trolley", "₹5,800/Piece"],
  ["Patel Material Handling Equipment", "Ahmedabad", "Mild Steel Hand Trolley", "₹10,000/Piece"],
  ["Indocore Engineering Corporation", "Indore", "Hand Trolley .", "₹6,500/Piece"],
  ["Adarsh Udyog", "New Delhi", "Warehouse Hand Trolley", "₹8,500/Piece"],
  ["Amit Quality Product Co.", "New Delhi", "Hand Trolley", "₹8,800/Piece"],
  ["Vishwakarma Agro Engineers", "Jaipur", "Construction Hand Trolley", "₹8,500/Piece"],
  ["RKS Engineering Industries", "Chennai", "Mild Steel MS Wheel Trolley, For Carry Material", "₹4,000/Piece"],
  ["Ahuja Corporation Private Limited", "Jaipur", "Stainless Steel Stack Easy Hand Trolley, Material Movement", "₹11,500/Piece"],
  ["Sfa Syndicate", "Howrah", "Hand Cart Trolley", "₹3,800/Piece"],
  ["QT Services", "Sangamner", "Hand Truck Platform Trolley", "₹4,500/Piece"],
  ["Multidimensions", "Navi Mumbai", "Platform Trolley Pallet size 1200x800", "₹90,000/Piece"],
  ["Baroda Polyform Pvt Ltd", "Vadodara", "Stackable Platform Trolley", "₹8,000/Piece"],
  ["Muvall Castors Private Limited", "Bengaluru", "Platform Trolley", "₹4,500/Unit"],
  ["Annai Fabrication", "Coimbatore", "Ms Platform Trolley", "₹30,000/Piece"],
  ["National Industries", "New Delhi", "Namibind Heavy Hand Trolley For Material Handling", "₹5,500/Piece"],
  ["Anmol Engineers", "Ludhiana", "Stainless Steel Platform Trolley", "₹4,500/Piece"],
  ["Rite Solution", "Ghaziabad", "Platform Trolley With Scissor Tipper", "₹2,60,000/Piece"],
  ["A I Sales Corporation", "Pune", "Platform Trolley", "₹3,900/Piece"],
  ["Orchids International", "Mumbai", "Platform Trolley Four Side Covered", "₹19,600/Piece"],
  ["P Lal & Sons", "New Delhi", "Platform Trolly", "₹8,500/Piece"],
  ["Synergy Technics", "Ahmedabad", "Platform Trolley", "₹12,500/Number"],
  ["Future Industries Private Limited", "Ahmedabad", "Side Support Platform Trolley", "₹19,000/Unit"],
  ["Tech Mech Handling Equipments", "Meerut", "800 Mild Steel JET Platform Trolley, For Warehouse", "₹23,000/Piece"],
  ["Lokpal Industries", "New Delhi", "Hulk Lokpal Steel Platform Hand Trolley", "₹6,500/Piece"],
  ["Lokpal Industries", "New Delhi", "Platform Trolley", "₹5,000/Piece"],
  ["Shree Raj International Private Limited", "Kolkata", "Plastic Platform Trolley", "₹4,500/Piece"],
  ["Varad Enterprises", "Nashik", "Metal Platform Trolley", "₹7,900/Piece"],
  ["Megascope Enterprises", "Thane", "Metal Foldable Platform Trolley", "₹6,000/Piece"],
  ["Manthan Sales Corporation", "Ahmedabad", "Foldable Platform Trolley, Load Capacity(kg): 200 kg", "₹3,000/Piece"],
  ["Nandhi Technologies", "Bengaluru", "3000 Kg Platform Trolley", "₹16,000/Piece"],
  ["Micro Sheet Crafts (India) Private Limited", "New Delhi", "MS Platform Trolley", "₹4,800/Piece"],
  ["A S V Kitchen Equipments", "Coimbatore", "Four-Wheel Stainless Steel Utility Trolley, For Industrial", "₹9,500/Piece"],
  ["Akura Engineering Services", "Pune", "Portable Mild Steel Platform Trolley 750 x 500mm", "₹3,450/Piece"],
  ["Orchids Tissue Paper Products", "Mumbai", "Platform Trolley Single Handle OR-PLAT-S-02", "₹24,500/Piece"],
  ["Sai Safety Bellows", "Pune", "Ms Platform Trolley", "₹4,200/Piece"],
  ["Ethics Infinty Private Limited", "Surat", "Open Platform Trolley", "₹5,000/Piece"],
  ["Ratan Enterprises", "Pune", "Mild Steel Platform Trolley", "₹12,000/Piece"],
  ["Alif Enterprises", "", "Maf Pro Platform Trolley 300Kgs", "₹3,200/Piece"],
  ["Radhika Industrial Corporations", "", "MS Manual Platform Trolley", "₹4,500"],
  ["Mahalaxmi Industries", "", "Mild Steel Platform Trolley", "₹4,200/Piece"],
  ["Anjani Enterprise", "", "200 kg Platform Trolley", "₹4,500/Piece"],
  ["Unnati Engineering Co.", "", "Fiber Platform Trolley With 6 Wheel", "₹6,500/Piece"],
  ["Shreeji Industries", "", "Platform Trolleys", "₹5,800/Unit"],
  ["Balaji Industries", "", "Heavy Duty Ms Platform Trolley", "₹3,800/Piece"],
  ["Rimsha Engineers", "", "Industrial Platform Trolley", "₹12,501/Piece"],
  ["Sun Interia", "Gurgaon", "Platform Trolley", "₹6,000/Unit"],
  ["Wright Option Consultancy Services", "Pune", "Platform Trolley", null],
  ["National Equipments", "New Delhi", "Platform Trolley", null],
  ["Airking Engineers", "Rajkot", "Platform Trolley", null],
  ["HK Industries", "Ahmedabad", "Hydraulic Lifting Trolley, Load Capacity: 3 ton", "₹32,000/Piece"],
  ["Presstech", "Chennai", "Hydraulic Lifting Trolley, Load Capacity: 1 ton", "₹35,000/Piece"],
  ["Isha Engineering And Co.", "Coimbatore", "Hydraulic Lifting Trolley, 150 kg, 900 mm", "₹40,000/Piece"],
  ["Divine Machinery Solution", "Gandhinagar", "Hydraulic Lifting Trolley 8FTX4FT - Manually Operated, 800 mm, 150 kg", "₹1,80,000/Piece"],
  ["QT Services", "Sangamner", "Hydraulic Scissor Lift Trolley, For Goods Lifting", "₹45,000/Piece"],
  ["Vertex Engineering Works", "Ahmedabad", "Hydraulic Platform Trolley, 900 mm, 1000 Kg", "₹1,00,000/Piece"],
  ["Asmita Engineering Equipments", "Pune", "Hydraulic Pallet Truck, 200 mm", "₹13,500/piece"],
  ["CTR Manufacturing Industries Private Limited", "Pune", "Hydraulic Lifting Trolley, Load Capacity: 1 ton", "₹60,000/Piece"],
  ["Lokpal Industries", "New Delhi", "Hydraulic Lifting Trolley", "₹15,200/Piece"],
  ["Nandhi Technologies", "Bengaluru", "Scissor Lift Trolley, Lift Drive: Manual, Load Capacity: 5 ton", "₹30,000/piece"],
  ["Astha Enterprises", "Ahmedabad", "Hydraulic ROLLER Lifting Trolley, 500 kg, 800 mm", "₹2,85,000/Piece"],
  ["Stackers & Movers India Manufacturing Company", "Ahmedabad", "Hydraulic Scissor Lifting Trolley, For Industrial, Load Capacity: 500 kg", "₹6,00,000/Piece"],
  ["Manthan Sales Corporation", "Ahmedabad", "Hydraulic Lifting Trolley, 500 kg", "₹16,000/Piece"],
  ["Infinity Engineering Services", "Padra", "Scissor Lift Trolley, Lift Drive: Pneumatic, Hydraulic, Load Capacity: 500 kg", "₹6,000/Piece"],
  ["Unicorn Engineering", "Ahmedabad", "Scissor Lift Trolley", "₹22,000/Piece"],
  ["Afza Material Handling And Storage Systems", "Krishnagiri", "Hydraulic Lifting Trolley, 800 mm, 300 kg", "₹25,000/Piece"],
  ["RV Equipments", "Chennai", "500 kg Industrial Hydraulic Lifting Trolley", "₹46,000/Piece"],
  ["RB Industrial Equipments", "Surat", "Hydraulic Scissor Lifting Table Trolleys, Load Capacity: 500 kg", "₹24,999/Piece"],
  ["Darshan Industries", "Ahmedabad", "Spider Mild Steel Hydraulic Hook Stacker, For Material Handling, Lifting Capacity: 500-1500 Kg", "₹55,000/Piece"],
  ["Siddh Krupa Steel Fab", "Ahmedabad", "Hydraulic Lifting Trolley, 800 mm, 150 kg", "₹29,000/Piece"],
  ["TAVISHI", "New Delhi", "Hydraulic Lifting Trolley, 900 mm, 1 ton", "₹54,000/Piece"],
  ["New National Hydraulics", "Noida", "Fork Stacker Hydraulic Lifting Trolley, Lifting Capacity: 1 ton", "₹45,000/Piece"],
  ["Lokpal Industries", "New Delhi", "Hydraulic Lifting Trolley, Lifting Capacity: 2 ton", "₹28,000/Piece"],
  ["Pooja International", "Vasai", "MS Yellow Hydraulic Lifting Trolley, Load Capacity: 150- 300 kg", "₹40,000/Piece"],
  ["Stacker'S & Mover'S (I) Mfg. Co.", "Ahmedabad", "Hydraulic Lifting Trolley, For Industrial, Lift Drive: Manual", "₹8,900/Piece"],
  ["Shree Ram Enterprise", "Ahmedabad", "Hydraulic Lifting Trolley, Lift Drive: Manual, Capacity: 0.5 ton", "₹28,000/Piece"],
  ["R.R. Medi Engineering", "Kolkata", "RR MEDI Scissor Lift Trolley, Working Height: 10 feet, Capacity: 1-2 ton", "₹55,000/Piece"],
];

const CONVEYORS: Listing[] = [
  ["JD Roto Engineering", "Ahmedabad", "Mild Steel Horizontal Modular Belt Conveyor", "₹3,15,000"],
  ["Aline Conveyors Private Limited", "New Delhi", "Mild Steel Chain Conveyors Drive System, Capacity: 100 Kg/Feet", "₹2,00,000"],
  ["G.M. Packaging Solutions", "Chennai", "BI Direction Loading Conveyor Systems", "₹45,000"],
  ["Prime Precisions", "Coimbatore", "Enmasse Chain Conveyor", "₹12,00,000"],
  ["J K Engineering", "Ahmedabad", "Chevron Conveyor Belt System", "₹2,50,000"],
  ["Tirupati Engineering", "Ahmedabad", "Pouch Printing Conveyor Machine", "₹94,000"],
  ["Sigma Automation", "Ahmedabad", "Bag Pusher Belt Conveyor", "₹1,98,000"],
  ["Bandma Equipcorp Limited", "New Delhi", "Belt OLYMPO Conveyors System, Capacity: 50 Kg/Feet", "₹50,000"],
  ["Earth Engineering Co.", "Ahmedabad", "Pharmaceutical Conveyor", "₹2,80,000"],
  ["Spectra Plast India Private Limited", "Coimbatore", "Plastic PVC Belt Conveyor System", "₹15,000"],
  ["Bharatq Conveyor Automation Private Limited", "Manesar", "Material Handling Conveyors", "₹2,00,000"],
  ["H V Engineering", "Vadodara", "Mild Steel Conveyor System", "₹80,000"],
  ["Indotex Equipments", "Ahmedabad", "Batching Plant Radial Conveyor System", "₹6,00,000"],
  ["Sara Equipment", "Chettipalayam", "Belt Rubber Material Handling Conveyors", "₹1,80,000"],
  ["Techno Power Engimech Private Limited", "Ahmedabad", "Mobile Conveyor System", "₹2,75,000"],
  ["Mangla Sales Agency", "New Delhi", "Aluminium Belt Conveyor System, Capacity: 150 Kg/Feet", "₹75,350"],
  ["Sigma Instrumentation", "Ahmedabad", "Automatic Chevron Belt Conveyor for Material Handling and Bulk", "₹3,48,000"],
  ["Khodiyar Industrial Corporation", "Rajkot", "Automatic Conveyor Belt System for Material Handling", "₹50,000"],
  ["Jekmin Industries", "Ahmedabad", "Free-flow Conveyors", "₹10,000"],
  ["Maxtic Environmental Private Limited", "Ghaziabad", "Mild Steel Material Handling Conveyors", "₹1,50,000"],
  ["Canares Engineering Co.", "Bengaluru", "Aluminium Belt Transfer Unit Conveyor System, Capacity: 50", "₹60,000"],
  ["Anmol Engineers", "Ludhiana", "Mild Steel Roller Conveyor System, Capacity: 50 Kg/Feet", "₹8,500"],
  ["Oscar Cashew Tech", "Ahmedabad", "Stainless Steel 10Feet Fully Automatic Conveyor Belt System", "₹90,000"],
  ["The Radhey Export", "Ahmedabad", "Food Conveyor System", "₹1,00,700"],
  ["Thermocare Industries Limited", "Kanpur", "Conveyor Belt System", "₹50,000"],
  ["Magna Tronix", "Chennai", "Stainless Steel Industrial Chain Conveyors", "₹2,30,000"],
  ["Birdi Mechanical Works", "Ludhiana", "MS Industrial Conveyer Machine", "₹1,50,000"],
  ["Ultra Febtech Private Limited", "Ahmedabad", "Electric MS,SS Hydration Conveyor", "₹2,50,000"],
  ["Dodhia Techno Engineering Pvt. Ltd.", "Mumbai", "Belt Conveyor", null],
  ["Universal Equipments", "Navi Mumbai", "MS Conveyor", null],
  ["Shri Vijaylakshmi Industries", "Coimbatore", "Belt Conveyor", null],
  ["Sri Sai Enithu Enterprises", "Coimbatore", "Aluminum Frame Conveyors", null],
  ["P. D. Engineering Works", "Faridabad", "Tyre Pick-Up Conveyor", null],
  ["Rahul Expellers Industries", "Ludhiana", "Conveyor System", null],
  ["P Chandru Machine Tools", "Vellore", "Special Purpose Conveyor System", null],
  ["Fab Avia", "New Delhi", "Conveyor System", null],
  ["Ubikwites Export Management Private Limited", "Mysore", "Conveyor Systems", null],
  ["Shree Balaji Engineering Works", "New Delhi", "Continuous Conveyor System", null],
  ["Supermix Equipments", "Ahmedabad", "Fly Ash Conveying System", null],
  ["Unique Power Tools", "Coimbatore", "Conveyor System", null],
  ["Impex Automation & Systems", "Pune", "Material Handling Systems", "₹50,000"],
  ["Rullitech Engineers", "Anand", "Dribble Conveyor", null],
  ["Drivemax Equipments", "Thane", "Tray Washing Conveyor", null],
  ["Leelawati Industries", "Pune", "Industrial Conveyors", null],
  ["Shre Bajrang Enterprise", "New Delhi", "Screw Conveyors", null],
  ["Gurukirpa Technologies", "Chandigarh", "Conveyor", null],
  ["Eagle Technologies", "Tiruvallur", "Material Handling Conveyors", null],
  ["Cosmic Grace Engineers", "Raipur", "Long Distance Conveyors", null],
  ["Karnataka Iron Works", "Mangalore", "Screw Conveyors", null],
  ["Precision Transmission Chain", "Kolkata", "Belt Conveyor Systems", null],
  ["Ruby Auto & Rubber Industries", "New Delhi", "Material Handling Conveyors", null],
  ["Kalimata Engineering Company, Belghoria", "Kolkata", "Conveyor System", null],
  ["Krishna Products", "Noida", "Conveyor System", null],
  ["Vashisht Enterprises", "Muradnagar", "Belt Conveyor MS/SS Body, Capacity: 200 Kg/Feet, Load Capacity: Upto 200 kg", "₹35,000"],
  ["Prime Precisions", "Coimbatore", "Stainless Steel Precision Belt Conveyors", "₹1,00,000"],
  ["Excel Plants And Equipment Private Limited", "Pune", "Excel Stainless Steel Belt Conveyors Manufacturer", "₹50,000", "manufacturer"],
  ["Spectra Plast India Private Limited", "Coimbatore", "Stainless Steel PU Hopper Conveyors, Capacity: 150-200 kg,200-300 kg", "₹1,50,000"],
  ["Jekmin Industries", "Ahmedabad", "Belt Conveyor System, Load Capacity: 200 kg", "₹10,000"],
  ["CBC India", "Mumbai", "500kg/m Belt Conveyors", "₹5,60,000"],
  ["R V Packaging Machinery Solution Co.", "Nadiad", "Belt Conveyors", "₹3,50,000"],
  ["Sigma Automation", "Ahmedabad", "Material Feeder Belt Conveyor", "₹18,000"],
  ["Sara Equipment", "Chettipalayam", "Belt Conveyor System, Capacity: 500 Kg/Feet, Load Capacity: 200 kg", "₹32,500"],
  ["H V Engineering", "Vadodara", "Timing Belt Conveyor", "₹1,66,000"],
  ["Siddhi Enterprises", "Ahmedabad", "Belt Conveyors", "₹2,00,000"],
  ["JD Roto Engineering", "Ahmedabad", "Food Grade Belt Conveyor", "₹1,75,000"],
  ["J K Engineering", "Ahmedabad", "Rubber Cleated Belt Conveyor System (5m Length x 300mm Width)", "₹2,30,000"],
  ["Sigma Instrumentation", "Ahmedabad", "Bag Straighter Conveyor", "₹1,77,600"],
  ["Earth Engineering Co.", "Ahmedabad", "PVC Endless Belt Conveyor, For Pharma", "₹2,30,000"],
  ["N.N.Engineering Products", "Coimbatore", "Belt Conveyor System", "₹52,500"],
  ["FusionTech International", "Ahmedabad", "Customized Conveyor Belt Unit", "₹60,000"],
  ["Techno Power Engimech Private Limited", "Ahmedabad", "Belt Conveyor System", "₹5,00,000"],
  ["Aline Conveyors Private Limited", "New Delhi", "Aline Mild Steel Belt Conveyor System", "₹25,000"],
  ["Tirupati Engineering", "Ahmedabad", "Pouch Printing Belt Conveyor", "₹1,08,000"],
  ["Bharatq Conveyor Automation Private Limited", "Manesar", "Box Transfer Conveyor", "₹2,50,000"],
  ["Darshini Engineers", "Ahmedabad", "MS Cleated Conveyor Belt", "₹2,00,000"],
  ["Swastik Technology", "Rajkot", "10000Kg/Hr Belt Conveyor", "₹2,50,000"],
  ["Bandma Equipcorp Limited", "New Delhi", "OLYMPO Belt Conveyor, Capacity: 50 Kg/Feet", "₹50,000"],
  ["Wayal Industries Private Limited", "Pune", "Conveyor Belt Machine", "₹75,800"],
  ["Goras Industries", "Mahesana", "Belt Conveyor System, Load Capacity: 400 kg", "₹1,20,000"],
  ["Parul Engineering Private Limited", "Pune", "Z Belt Conveyor, Capacity: 3 Ton/Hour", "₹2,20,000"],
  ["Icon Engineers", "Greater Noida", "20m Belt Conveyor System", "₹1,30,000"],
  ["Aline Conveyors Private Limited", "New Delhi", "30 Meter Aluminum Roller Conveyor, Capacity: 80 kg", "₹20,000/Piece"],
  ["Prime Precisions", "Coimbatore", "Steel Natural Wholes Prime Roller Conveyor", "₹1,00,000/Piece"],
  ["Maxtic Environmental Private Limited", "Ghaziabad", "Roller Conveyor System", "₹6,000/Piece"],
  ["Jekmin Industries", "Ahmedabad", "Flexible Conveyors Motor Roller Conveyor System, Capacity: 50-100 kg per feet", "₹20,000/Piece"],
  ["Sara Equipment", "Chettipalayam", "Mild Steel Roller Conveyor System", "₹2,75,000/Piece"],
  ["Khodiyar Industrial Corporation", "Rajkot", "KIC 200-2500mm Conveyor System Rollers, Roller Diameter: 60-220mm, Capacity: 10-1000mt", "₹29,500/Piece"],
  ["R V Packaging Machinery Solution Co.", "Nadiad", "Mild Steel 1000 Roller Conveyor, Roller Diameter: 60mm, Capacity: 100Kg/Min", "₹85,000/Piece"],
  ["Bharatq Conveyor Automation Private Limited", "Manesar", "Pallet Conveyor System", "₹60,000/Piece"],
  ["Icon Engineers", "Greater Noida", "45mm Ball and Roller Conveyor", "₹1,35,000/Piece"],
  ["Sigma Automation", "Ahmedabad", "Spiral Conveyors Aluminum Roller Conveyor", "₹13,000/Piece"],
  ["Parul Engineering Private Limited", "Pune", "Stainless Steel Flexible Roller Conveyor", "₹1,80,000/Piece"],
  ["Magna Tronix", "Chennai", "MAGNA TRONIX Stainless Steel Roller Conveyor System", "₹3,00,000/Piece"],
  ["Blastclean Systems Private Limited", "Mumbai", "Roller Conveyor System", "₹1,51,000/Unit"],
  ["Spectra Plast India Private Limited", "Coimbatore", "Spectra Stainless Steel Gravity Roller Conveyors", "₹8,000/Piece"],
  ["Farmware Industries India Private Limited", "Pune", "Stainless Steel 1500 mm Roller Conveyor System, Roller Diameter: 89 mm, Capacity: Up To 2000 Kg", "₹90,000/Piece"],
  ["Thermocare Industries Limited", "Kanpur", "100Kg Roller Conveyor", "₹6,00,000/Piece"],
  ["Avi International Packaging Co.", "New Delhi", "AVI Motorised Roller Conveyor ( 90 Degree Twist )", "₹4,50,000/pc"],
  ["Panther Technologies", "Ahmedabad", "Mild Steel Ms Roller Conveyor", "₹2,40,000/Piece"],
  ["Darshini Engineers", "Ahmedabad", "150 Kg/Feet Turntable Roller Conveyor System", "₹4,00,000/Piece"],
  ["Imatics", "Chennai", "SS Roller Conveyor, Material Grade: SS304, Capacity: 200 Kg/Feet", "₹2,00,000/Unit"],
  ["H V Engineering", "Vadodara", "MS Roller Conveyor", "₹1,50,000/Unit"],
  ["JD Roto Engineering", "Ahmedabad", "Powered Flexible Mild Steel Roller Table Conveyor", "₹98,000/Piece"],
  ["Excel Conveyors", "Pune", "Chain Driven Live Roller Conveyor", "₹50,000/Unit"],
  ["Jwala Techno Engineering Private Limited", "Mumbai", "Steel Jwala 2 Tier Inspection Conveyor", "₹7,00,000/Number"],
  ["Shri Shyam Laser Cutting", "New Delhi", "20 Feet Roller Conveyor", "₹8,000/Piece"],
  ["Indian Machine Mart", "New Delhi", "Steel 15-20 M Roller Conveyor", "₹2,10,000/Piece"],
  ["M.S. Enterprises", "Faridabad", "Roller Conveyor Systems", "₹80,000/Unit"],
];

const COLD_CHAIN: Listing[] = [
  ["New Edge Refrigeration LLP", "Ahmedabad", "Galvanized Steel Refrigerated Container", "₹6,00,000"],
  ["S.K. Scientific And Surgicals", "Ambala", "20 feet Refrigerated Containers", "₹5,50,000"],
  ["Anand Refrigeration Co. Pvt. Ltd.", "Ghaziabad", "Refrigerated Truck Container", "₹5,90,000"],
  ["Polaris Shipping Lines LLP", "Chennai", "10 feet Reefer Refrigerated Containers", "₹7,50,000"],
  ["Yash Shivani Agencies", "Thane", "40 Refer And Cold Storage Container", "₹84,000"],
  ["Cabicon Box And Lorry Services Pvt. Ltd.", "New Delhi", "20 feet Refrigerated Container", "₹4,25,000"],
  ["Quatre Agro Enterprises Pvt. Ltd.", "Mumbai", "10ft Brand new reefer container for vaccines storage", "₹10,00,000"],
  ["Rohan Industries", "Pune", "Used Reefer Refrigerated Container 40 Feet For Cold Room", "₹11,99,000"],
  ["Siberian Refrigeration LLP", "Naiti", "20 feet GRP Refrigerated Container", "₹2,50,000"],
  ["Mech-Air Industries", "Vadodara", "Refrigerated Truck Container", "₹2,00,000"],
  ["Amfico Agencies Pvt. Ltd.", "Mumbai", "20 Feet Reefer Shipping Container for Sale - Amfico Cold Chain", "₹4,00,000"],
  ["J B M Logistics Services", "Greater Noida", "20 Feet MS Refrigerated Shipping Container", "₹4,50,000"],
  ["Unicorn International", "Noida", "10 feet Refrigerated Containers/ Refeer Container", "₹3,00,000"],
  ["Rockwell Shipping Cargo Containers", "Udaipur", "Stainless Steel Reefer Container, Capacity: 30-40 ton", "₹4,50,000"],
  ["Divine Cooling System", "Ahmedabad", "40 feet Thermo King Reefer Container", "₹8,00,000"],
  ["Kavi International", "Chennai", "40 feet Steel Refrigerated Containers", "₹5,90,000"],
  ["Imnc Strategic Logistics Pvt. Ltd.", "Navi Mumbai", "Aluminium Alloy Refrigerated Container, Capacity: 20-30 Ton", "₹4,00,000"],
  ["Astro Teck", "Tiruvallur", "10 feet Galvanized Steel Refrigerated Container", "₹1,85,000"],
  ["Trans Auto", "Bengaluru", "Container Cold Storage System", "₹40,00,000"],
  ["Voltazo Refrigeration", "Ahmedabad", "Grp Insulated Refrigerated Containers", "₹2,00,000"],
  ["Sub Zero Insulation Technologies Pvt. Ltd.", "Pune", "Eutectic Reefer Refrigerated Containers", "₹7,00,000"],
  ["Elegaframe Structure LLP", "Faridabad", "Refrigerated Containers", "₹2,50,000"],
  ["Air Equipment Engineering", "New Delhi", "Mild Steel Reefer Container", "₹5,00,000"],
  ["Pioneer Cold Store And Cladding Pvt. Ltd.", "Chennai", "Refrigerated Truck Container - 20 feet", "₹5,90,000"],
  ["Mansoori Global Shipping Pvt. Ltd.", "Thane", "Stainless Steel 40 FEET Reefers, Capacity: More than 30 ton", "₹4,85,000"],
  ["Sarjak Container Lines Pvt. Ltd.", "Mumbai", "20 Feet Refrigerated Shipping Container", "₹6,00,000"],
  ["Cabicon Box And Lorry Services Private Limited", "New Delhi", "40 feet Refrigerated Container", "₹6,50,000"],
  ["Vira Enterprise", "Faridabad", "20 feet 20Ton Refrigerated Container", "₹4,50,000"],
  ["Myru Global Enterprises", "Navi Mumbai", "40 feet Corten Steel Refrigerated Cold Storage Container", "₹2,22,000"],
  ["Snowline Engineering", "Kolkata", "Refrigerated Truck Container", "₹3,00,000"],
  ["K.G.N. Infra", "Kolkata", "20 Feet Refrigerated Shipping Container", "₹3,30,000"],
  ["SDK Enterprises", "Thane", "10 feet Refrigerated Shipping Container", "₹2,00,000"],
  ["Alfa Kold Solutions", "Dera Bassi", "Mild Steel Refrigerated Truck Container", "₹1,80,000"],
  ["Greencold Refrigeration", "Tiruppur", "Refrigerated Containers", "₹1,00,000"],
  ["Acoldz Refrigeration", "Gandhinagar", "Food Grade Refrigerated Container", "₹2,20,000"],
  ["Reefer Containers", "New Delhi", "20 feet Insulated Vehicle Refrigerated Container", "₹4,75,000"],
  ["Sri Kamakshi Enterprises", "Chennai", "Galvanized Steel Reefer Container Refrigeration Containers", "₹35,000"],
  ["N V S Industries", "Sonipat", "20 feet White Refrigerated Container", "₹4,00,000"],
  ["Cross Marine Container Services", "Chennai", "20 Ft Refrigerated Container", "₹1,80,000"],
  ["Ritveyraaj Cargo Shipping Containers", "Mumbai", "Mild Steel Portable Refrigerated Shipping Container, Capacity: 10-20 ton", "₹4,75,000"],
  ["Purbasa Refrigeration", "Tarakeswar", "Truck Refrigerated Container", "₹4,00,000"],
  ["Innovotech Global Services", "New Delhi", "Refrigerated Containers", "₹7,50,000"],
  ["Orchid Enterprises", "Chennai", "Stainless Steel Reefer Container, For Industrial", "₹4,95,000"],
  ["Kool World", "Lucknow", "10 feet Carrier Refrigerated Shipping Container", "₹50,000"],
  ["AK Enterprises", "Chennai", "20 Ft Refrigerated Shipping Container", "₹2,00,000"],
  ["Ozone Cooling Systems", "Bengaluru", "10 feet Refrigerated Shipping Container", "₹2,40,000"],
  ["Hitech Cooling Systems", "Sangli", "Galvanized Iron Cold Room Equipment", "₹50,000"],
  ["New Edge Refrigeration LLP", "Ahmedabad", "Cold Storage Equipment", "₹3,00,000"],
  ["Sonex Trading Co.", "Ahmedabad", "Cold Storage Indoor Unit", "₹12,97,000"],
  ["Unique Airtech Private Limited", "Vadodara", "Stainless Steel Cold Storage Equipment", "₹20,00,000"],
  ["Siberian Refrigeration LLP", "Naiti", "Galvanized Iron Cold Storage Equipment", "₹2,85,000"],
  ["Salleria Solutions", "New Delhi", "Co2 Machine For Cold Store", "₹2,15,000"],
  ["Shree Ram Engineers", "Hyderabad", "Cold Storage Equipment", "₹25,000"],
  ["Air Comfort & Automation Company", "New Delhi", "8-10 Cold Storage Equipment", "₹3,00,000"],
  ["AWO Tech India", "Agra", "Cold Storage Equipment", "₹77,550"],
  ["Astro Teck", "Tiruvallur", "Cold Storage Equipment", "₹5,000"],
  ["Voltazo Refrigeration", "Ahmedabad", "Galvanized Iron Cold Storage Equipment", "₹20,500"],
  ["Ahata Industries", "Kharkhoda", "Galvanized Iron Cold Storage Equipment", "₹2,85,000"],
  ["Vibgyor International Pvt. Ltd.", "New Delhi", "Dura-Cyl Liquid Nitrogen Storage Equipment", "₹5,00,000"],
  ["Pragmatic Hvac Engineers Pvt. Ltd.", "Mumbai", "Stainless Steel Cold Room Equipments", "₹2,80,000"],
  ["Eastern Air Conditioning And Refrigeration", "Guwahati", "Cold Storage Equipment", "₹5,000"],
  ["Cold Chain Solution", "Indore", "Mild Steel Cold Storage Equipment", "₹55,000"],
  ["Tilak Electronics & Refrigeration Point", "Faridabad", "2tr To 400tr Stainless Steel Cold Storage Equipment", "₹45,000"],
  ["AKG Jaipur", "Jaipur", "Cold Storage Equipment", "₹15,000"],
  ["Divansh Engineers", "New Delhi", "Aluminium Co2 Machine For Cold Storage", "₹5,50,000"],
  ["Avantika Industries", "Ghaziabad", "Stainless Steel Cold Storage Equipment", "₹27,999"],
  ["Ultramech Systems", "Mumbai", "Cold Storage Equipment", "₹2,75,000"],
  ["Centair Private Limited", "New Delhi", "Blue Star Cold Storage Unit", "₹1,20,000"],
  ["Aahaar", "New Delhi", "Blast Cold Room Freezer", "₹3,50,000"],
  ["Shakti Mechanical Works", "New Delhi", "Cold Storage Equipment", "₹5,000"],
  ["Siddhi Vinayak Enterprises", "Jaipur", "Cold Storage Equipment", "₹3,50,000"],
  ["Unicool Technologies", "Chennai", "0 To 5000 Ton Commercial Cold Storage Equipment", "₹60,00,000"],
  ["Bombay Ammonia Refrigeration Company", "New Delhi", "Cold Storage Equipment", "₹10,00,000"],
  ["Keon Reftec Private Limited", "Ahmedabad", "Galvanized Iron Cold Storage Equipment", "₹2,00,000"],
  ["K S Refrigeration", "Pune", "Cold Storage Equipment", "₹1,10,000"],
  ["S B Refrigeration And Solutions Private Limited", "Bengaluru", "2 Ton Vegetable Cold Storage", "₹2,50,000"],
  ["Sam Tech Cooling Solutions", "Hyderabad", "Cold Storage Equipment", "₹5,000"],
  ["Mahalakshmi Tube And Pipe Industries", "Nashik", "Stainless Steel Condensing Unit Cold Storage System", "₹50,001"],
  ["Heat Freeze Equipment", "Secunderabad", "Stainless Steel Cold Room Equipment", "₹18,000"],
  ["Neat Air Conditioning Private Limited", "Mumbai", "FRP Cold Storage Equipment", "₹5,00,000"],
  ["Green Tech Solutions", "Hyderabad", "Cold Storage Equipment", null],
  ["Inno Cool (India) Private Limited", "Chennai", "Inno Fully Automatic Cold Storage Refrigeration", null],
  ["Royal Hi-Tech Engineering", "Kathua", "Cold Storage Units, for Industrial Use", null],
  ["Blue Cold Refrigeration Private Limited", "Bengaluru", "Commercial Cold Storage Equipment", "₹50,000"],
  ["Bombay Ammonia Sales Corporations", "New Delhi", "Cold Storage Equipment", "₹10,00,000"],
];

const ALL_SUBCATEGORIES: { key: keyof typeof SOURCES; entries: Listing[] }[] = [
  { key: "forklifts", entries: FORKLIFTS },
  { key: "woodenPallets", entries: WOODEN_PALLETS },
  { key: "storageRacks", entries: STORAGE_RACKS },
  { key: "trolleys", entries: TROLLEYS },
  { key: "conveyors", entries: CONVEYORS },
  { key: "coldChain", entries: COLD_CHAIN },
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
  let existingIds: number[] = [8999]; // seed just below the 9000-9999 block (see lib/supplier-store.ts)
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
      if (c === "Logistics") continue;
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

  const dataFile = path.join(process.cwd(), "data", "suppliers", "logistics.json");
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ suppliers }, null, 2), "utf-8");
  console.log(`\nWrote ${suppliers.length} suppliers to ${dataFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
