// Ingestion run: IT Hardware supplier batch (India-wide) — Batch 8 of the
// master plan, seventh per-category dataset added to the existing
// multi-file supplier repository (see lib/supplier-store.ts's id-block
// scheme). Same architecture as scripts/import-electrical-equipment-batch.ts:
// normalizeSupplierRecord / computeDataConfidence / computeDedupeKey /
// findPotentialDuplicates from the existing lib/ingestion + lib/dedup
// modules — nothing new invented.
//
// SOURCES: 6 pan-India IndiaMART "impcat" category pages — desktop
// computers, computer servers, networking equipment (business/IT
// infrastructure — the "networking-equipment.html" slug redirects to
// computer-networking-device.html, confirmed on two separate research
// passes), industrial/business printers, data storage devices, IT
// peripherals for business.
//
// RESEARCH NOTE: the raw listing data for this batch was gathered via two
// parallel research passes (research agents), each WebFetching every
// subcategory's base URL and its "?pg=2" variant and transcribing every
// listing verbatim (company, city, exact title, price). The curated
// Listing[] arrays below apply one additional manual pass on top of the
// agents' own GENUINE/EXCLUDED classification, per the same discipline as
// every prior batch.
//
// INCLUSION RULE applied while curating the raw listings below:
//   - EXCLUDED: foreign companies not based in India. (Note: an India-
//     registered subsidiary of a foreign-headquartered brand, e.g. Foxlink
//     India Electric Private Limited or TDK India Pvt. Ltd., is NOT
//     excluded on this basis alone — the listing itself is India-based.)
//   - EXCLUDED: listings that are purely a reseller of ONE specific named
//     foreign brand via an otherwise-unrelated trading company with no
//     stated Indian own-business evidence. (Note: within IT hardware,
//     independent India-based IT-solutions companies reselling HPE/Dell/
//     Cisco/Lenovo enterprise hardware is the NORMAL structure of this
//     market — not treated as suspicious the way a single-foreign-brand
//     reseller was in the Electrical Equipment batch, since here dozens of
//     genuinely distinct IT-solutions businesses independently carry the
//     same handful of global enterprise-hardware brands.)
//   - EXCLUDED: spare-parts/component-only listings (a bare RAM module, a
//     PLC memory card, an EEPROM chip, a controller battery, a cooling
//     fan) rather than a complete hardware product.
//   - EXCLUDED: repair/service-only listings, and pure software-license
//     listings (not physical hardware).
//   - EXCLUDED: tiny single-unit consumer-only items with no plausible
//     business/bulk context (a single ₹175–650 home mouse/keyboard) and
//     gaming-only peripherals.
//   - EXCLUDED: listings for a clearly unrelated business that surfaced by
//     keyword coincidence — industrial-automation "network modules"
//     (Siemens SIMATIC, ABB Network 90, Delta DeviceNet) that are not IT
//     networking equipment, an EPABX telephony system, a flexo printing
//     press, an SMT PCB stencil printer, an ayurvedic-products company, a
//     gasket company, a metals/minerals trading company, a welding-brand
//     data-logger accessory.
//   - A company name alone (e.g. "DV Minerals And Associate", "Glorious
//     Color Images Private Limited", "Bengal Telecom Services", "Vohra
//     Brothers") was NOT used to exclude a listing whose title carried
//     genuine IT-hardware evidence — same rule as every prior batch.
//   - "Lohiya Electricals" (Bhavnagar) appears twice across this batch's
//     source pages with two different listings: a vague "MASTER COMPUTER,
//     Automatic" under Desktops (excluded — company name suggests an
//     unrelated electricals/industrial-controls business and the title is
//     too generic to confirm it's an IT desktop) and a distinct "PERIPHERAL
//     DEVICE" listing under IT Peripherals (kept — same ambiguity exists,
//     but "peripheral device" is concrete on-category vocabulary rather
//     than a title that reads as an industrial control panel).
//   - CROSS-BATCH CONSISTENCY CHECK: checked this batch's company names
//     against the two repeat generic-reseller companies excluded in Batch 7
//     ("Spot India Group"/"Spot India Company", "Econtrol Devices Private
//     Limited") — neither appears anywhere in this batch's data.
//
// MANUFACTURER/DISTRIBUTOR/TRADER STATUS: no listing across either research
// pass carried a literal, unambiguous business-type word on the listing
// itself (IndiaMART's impcat card view does not surface this field) — left
// unset ("unknown") for every supplier in this batch.
//
// TECHNICAL SPECS: extracted only when literally present in the title — RAM
// size, SSD/HDD/TB storage capacity, screen size, processor generation,
// Core i3/i5/i7/i9 tier, bay count, transfer speed (Gbps) — via
// parseItSpecs(). Nothing is inferred beyond the title text.
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
  desktops: {
    subcategory: "Computer hardware / desktops",
    group: "Desktops",
    url: "https://m.indiamart.com/impcat/desktop-computer.html",
    sourceName: "IndiaMART — Desktop Computer directory",
  },
  servers: {
    subcategory: "Servers",
    group: "Servers",
    url: "https://m.indiamart.com/impcat/computer-servers.html",
    sourceName: "IndiaMART — Computer Servers directory",
  },
  networking: {
    subcategory: "Networking equipment",
    group: "Networking Equipment",
    url: "https://m.indiamart.com/impcat/computer-networking-device.html",
    sourceName: "IndiaMART — Computer Networking Device directory",
  },
  printers: {
    subcategory: "Printers",
    group: "Printers",
    url: "https://m.indiamart.com/impcat/industrial-printer.html",
    sourceName: "IndiaMART — Industrial Printer directory",
  },
  dataStorage: {
    subcategory: "Data storage devices",
    group: "Data Storage",
    url: "https://m.indiamart.com/impcat/data-storage-device.html",
    sourceName: "IndiaMART — Data Storage Device directory",
  },
  itPeripherals: {
    subcategory: "IT peripherals for business",
    group: "IT Peripherals",
    url: "https://m.indiamart.com/impcat/computer-peripherals.html",
    sourceName: "IndiaMART — Computer Peripherals directory",
  },
} satisfies Record<string, SubcategorySource>;

const STATE_BY_CITY: Record<string, string> = {
  // Gujarat
  Ahmedabad: "Gujarat",
  Gandhinagar: "Gujarat",
  Bhavnagar: "Gujarat",
  Sanand: "Gujarat",
  // Rajasthan
  Jaipur: "Rajasthan",
  Bharatpur: "Rajasthan",
  // Maharashtra
  Mumbai: "Maharashtra",
  Thane: "Maharashtra",
  "Navi Mumbai": "Maharashtra",
  Pune: "Maharashtra",
  Nashik: "Maharashtra",
  Raigad: "Maharashtra",
  // Delhi
  "New Delhi": "Delhi",
  Delhi: "Delhi",
  // Uttar Pradesh
  Noida: "Uttar Pradesh",
  "Greater Noida": "Uttar Pradesh",
  Ghaziabad: "Uttar Pradesh",
  Lucknow: "Uttar Pradesh",
  // Telangana
  Hyderabad: "Telangana",
  Secunderabad: "Telangana",
  Koratla: "Telangana",
  // Tamil Nadu
  Chennai: "Tamil Nadu",
  Coimbatore: "Tamil Nadu",
  Madurai: "Tamil Nadu",
  Salem: "Tamil Nadu",
  // Karnataka
  Bengaluru: "Karnataka",
  // Haryana
  Gurugram: "Haryana",
  Gurgaon: "Haryana",
  Faridabad: "Haryana",
  // Punjab
  Ludhiana: "Punjab",
  // Madhya Pradesh
  Indore: "Madhya Pradesh",
  Rewa: "Madhya Pradesh",
  // West Bengal
  Kolkata: "West Bengal",
  Bansbaria: "West Bengal",
  Siliguri: "West Bengal",
  // Chandigarh
  Chandigarh: "Chandigarh",
  // Assam
  Guwahati: "Assam",
  // Andhra Pradesh
  Tirupati: "Andhra Pradesh",
  // Bihar
  Patna: "Bihar",
};

function locationFor(city: string): string {
  const cleanCity = city.split(",")[0].trim();
  if (!cleanCity) return "";
  const state = STATE_BY_CITY[cleanCity];
  return state ? `${cleanCity}, ${state}` : cleanCity;
}

// Literal-evidence-only technical spec extraction — same discipline as
// prior batches' parseChemSpecs()/parseElecSpecs(): every extracted fact is
// a direct regex match against the listing title, nothing inferred.
function parseItSpecs(title: string): string[] {
  const specs: string[] = [];
  const push = (label: string) => {
    if (!specs.includes(label)) specs.push(label);
  };

  const ramMatch = title.match(/(\d+)\s*GB\s*RAM\b/i);
  if (ramMatch) push(`${ramMatch[1]}GB RAM`);

  const ssdMatch = title.match(/(\d+)\s*(GB|TB)\s*SSD\b/i);
  if (ssdMatch) push(`${ssdMatch[1]}${ssdMatch[2].toUpperCase()} SSD`);

  const hddMatch = title.match(/(\d+)\s*(GB|TB)\s*(?:HDD|Hard Drive Capacity)/i);
  if (hddMatch) push(`${hddMatch[1]}${hddMatch[2].toUpperCase()} HDD`);

  const bareTbMatch = title.match(/(\d+)\s*TB\b/i);
  if (bareTbMatch && !ssdMatch && !hddMatch) push(`${bareTbMatch[1]}TB storage`);

  const screenMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:"|inch(?:es)?)\b/i);
  if (screenMatch) push(`${screenMatch[1]}" screen`);

  const genMatch = title.match(/\b(\d+)(?:th)?\s*[Gg]en\b/);
  if (genMatch) push(`${genMatch[1]}th Gen`);

  const coreMatch = title.match(/\bi([3579])\b/i);
  if (coreMatch) push(`Core i${coreMatch[1]}`);

  const bayMatch = title.match(/(\d+)[\s-]bay\b/i);
  if (bayMatch) push(`${bayMatch[1]}-bay`);

  const gbpsMatch = title.match(/(\d+)\s*Gbps\b/i);
  if (gbpsMatch) push(`${gbpsMatch[1]}Gbps`);

  return specs;
}

function rawRecordsForSubcategory(
  key: keyof typeof SOURCES,
  entries: Listing[]
): RawSupplierRecord[] {
  const { subcategory, group, url, sourceName } = SOURCES[key];
  const categories = Array.from(new Set(["IT Hardware", group, subcategory]));

  return entries.map(([companyName, city, title, price, bizType]) => {
    const specs = parseItSpecs(title);
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

const DESKTOPS: Listing[] = [
  ["Srsutra Info International Private Limited", "Noida", "Professional Desktop PC Core i7 4th Gen Upto 3.30GHz 12GB RAM 256GB SSD WiFi HDMI VGA", "₹12,747/Piece"],
  ["PP Tech Global Innovations LLP", "New Delhi", "INP Desktop i2308M i5", "₹30,000/Piece"],
  ["Modi Infosol Private Limited", "New Delhi", "Rectangular Workstation Z4G5 Xeon Xeon W5-2455X 12C 4.4Ghz, Windows", "₹3,90,000/Piece"],
  ["Aariha Enterprise Private Limited", "Ahmedabad", "Desktop Computer Systems", "₹6,500/Piece"],
  ["Oriflamme IT Solutions", "Mumbai", "Lenovo Computer Desktop, Memory Size (RAM): 4GB", "₹59,500/Piece"],
  ["Global Infotech Solutions", "Faridabad", "Advantech Office Workstation", "₹75,000/Piece"],
  ["Avertek Infosystems LLP", "Mumbai", "i7 Dell Desktop Computer, Hard Drive Capacity: 1 TB, Windows", "₹9,999/Piece"],
  ["Enfotech", "New Delhi", "Dell Precision T3680", "₹91,500/Piece"],
  ["Vardhman Computer And Peripheral", "New Delhi", "i3 Hp Desktop Computer", "₹29,001/Piece"],
  ["Saxena Technologies India Private Limited", "Noida", "udyama pos Core I5 Desktop, Hard Drive Capacity: 4gb ram 250ssd, Screen Size: 15\"", "₹42,000/Piece"],
  ["Itech World", "New Delhi", "HP Desktop Computer", "₹60,000/Piece"],
  ["Devi Enterprises", "Ahmedabad", "Microsoft Surface Studio", "₹3,49,999/Piece"],
  ["Sunshine IT Infra Services Pvt Ltd", "New Delhi", "Core i7 Office Desktop Computer, Hard Drive Capacity: 500 GB, Screen Size: 17 inches", "₹25,000/Piece"],
  ["Neotouch India Private Limited", "Chennai", "23.8 Inch Neotouch All in One Desktop Computer", "₹55,000/Piece"],
  ["Technocart Business Machine", "Lucknow", "Desktop Computer Systems", "₹75,000/Piece"],
  ["Dev Technology", "Mumbai", "Hp All In One Desktops", "₹48,100/Piece"],
  ["Metro Computers", "Mumbai", "Computer Systems DESKTOP", "₹29,990/Piece"],
  ["Pro Computer", "Mumbai", "DELL PRO MICRO QCM1250 Mini PC with Intel Core i3 14th Gen Processor, 8GB RAM, 512GB SSD", "₹37,500/Piece"],
  ["Ultimate IT Solution", "Mumbai", "Desktop 280 G9 Mt", "₹42,000/Piece"],
  ["Lakshya Computers", "Mumbai", "HP PRO SFF 280 G9 DESKTOP", "₹36,500/Piece"],
  ["Shree Infosys", "Mumbai", "Acer Desktop Computer, i5-12th, 18.5 Inches", "₹50,000/Piece"],
  ["Mega IT Solutions", "Thane", "Acer Verion M200-H610 Desktop Intel core i3-14100/8GB/512GB SSD DESKTOP", "₹40,500/Piece"],
  ["M Tech World", "Mumbai", "Lenovo Thinkcentre M75q Gen2 Desktop", "₹38,999/Piece"],
  ["Arihant Infotech", "Mumbai", "Small Hp Prodesk 400 G6, Core i5", "₹27,000/Piece"],
  ["Sai Computer Solution", "Gurugram", "Dell Optiplex 5060 MT CPU", "₹45,000/Piece"],
  ["Qinfo Solutions Private Limited", "Noida", "DELL 3460 SFF", "₹63,500/Piece"],
  ["S S International", "Chandigarh", "Desktop Computers", "₹10,000/Piece"],
  ["H.L.B.S Tech Private Limited", "", "HLBS i5 12th Gen Desktop PC", "₹40,000/Piece"],
  ["Samarth Infocom", "", "Desktop Computer", "₹15,000/Piece"],
  ["AI PC Builders", "", "I5 Desktop Computer", "₹27,800/Piece"],
];

const SERVERS: Listing[] = [
  ["Zortex Gaming Solution Private Limited", "Jaipur", "HPE ProLiant DL580 Gen10 6230 Rack Server", "₹1,91,300"],
  ["Srsutra Info International Private Limited", "Noida", "Hpe Proliant Dl380 Gen10 NVME", "₹1,80,000"],
  ["Zaco Computers Private Limited", "Mumbai", "Sun Fire V210 Server", "₹50,000"],
  ["Staunchondemand Solutions Private Limited", "Bengaluru", "Computer Servers", "₹13,500"],
  ["Adatronix Private Limited", "Bengaluru", "Hpe Synergy Compute Module", "₹10,000"],
  ["Raar Technologies", "New Delhi", "Dell Computer Server Rack", "₹1,80,000"],
  ["V S Computer Systems", "Mumbai", "HPE ProLiant DL380 Gen10 Plus Server", "₹1,65,000"],
  ["Modi Infosol Private Limited", "New Delhi", "16GB HPE ProLiant DL360 Gen10 Server WITH Xeon-G 6142", "₹2,69,900"],
  ["Eion Info", "Salem", "Hpe Proliant Dl380 Gen10 Server", "₹45,000"],
  ["Oriflamme IT Solutions", "Mumbai", "Lenovo Think Server", "₹90,000"],
  ["AMS Trading", "New Delhi", "128GB Windows Dell Dedicated Server", "₹15,000"],
  ["Esconet Technologies Limited", "New Delhi", "Dual Socket High Density Compute Server", "₹3,00,000"],
  ["Arihant Info Solutions", "Mumbai", "Intel Server System R1304WT2GS", "₹1,90,000"],
  ["Itech World", "New Delhi", "Lenovo SR530 Server - Two Socket Rack 1U Server", "₹1,60,200"],
  ["TPM Guru Private Limited", "New Delhi", "Sun Server X4-2 System", "₹3,00,000"],
  ["Solaris", "Kolkata", "HPE proliant dl380 gen10 server", "₹1,20,000"],
  ["Digitage Infocom Private Limited", "New Delhi", "HPE Servers", "₹4,60,000"],
  ["Webroute Inc.", "New Delhi", "Dell Poweredge R730 Rack Server", "₹1,40,000"],
  ["Aariha Enterprise Private Limited", "Ahmedabad", "HPE ProLiant DL380 Gen9 Server", "₹44,500"],
  ["Fluke Infotech LLP", "Indore", "Server", "₹2,50,000"],
  ["Comprint Tech-Solutions (I) Private Limited", "Mumbai", "B8033 Mitac Tyan", "₹1,89,000"],
  ["Dynamic IT Services", "New Delhi", "Hitachi Advanced Server DS220 - 2U Dual-Processor", "₹95,000"],
  ["Geloof Solutions Private Limited", "New Delhi", "Altos BrainSphere T15 F6 Server", "₹62,500"],
  ["Blue Link IT Solutions", "New Delhi", "Super Micro Server", "₹25,000"],
  ["NCS Techno Systems Private Limited", "Chennai", "TerraMaster T9-500 Pro Integrated Backup Server", "₹1,69,500"],
  ["Simple Solutions", "Bengaluru", "Fujitsu RX2530 M4 Server", "₹42,000"],
  ["Enfotech", "New Delhi", "HPE DL380 G11 4410Y MR408i-o NC 8SFF Svr", "₹3,67,450"],
  ["Aradhyam Trading Private Limited", "New Delhi", "HPE AMD Server", "₹3,10,000"],
  ["Lamatu Systems Private Limited", "Gurugram", "Refurbished Computer Servers Dell R640", "₹38,000"],
  ["I-Tek Logics Pvt. Ltd.", "New Delhi", "Dell Power Edge T360 4U Tower Server", "₹2,40,000"],
  ["MSM Peripherals Point", "New Delhi", "HPE PROLIANT Dl180 GEN10 8SFF SERVER", "₹95,000"],
  ["SRV Infosystem", "New Delhi", "HPE ProLiant DL345 Gen11 SERVER", "₹8,30,000"],
  ["Ranibytes Solutions Private Limited", "New Delhi", "HPE ProLiant DL145 Gen11 Server", "₹1,15,000"],
  ["3C IT Solutions And Telecoms (India) Limited", "Pune", "Cisco Computer Server", "₹36,000"],
  ["S.K Real Infotech", "New Delhi", "HPE DL350P G8 Xeon E5 Server", "₹45,000"],
  ["Dhavala Infotech", "Bengaluru", "Refurbished Dell EMC PowerEdge R640 Rack Server", "₹1,65,000"],
  ["Kadam Marketing Ltd.", "New Delhi", "HPE ProLiant DL380 Gen10 Plus Server Model-P74646-D65", "₹5,91,099"],
  ["Innoric Solutions Private Limited", "Kolkata", "ML30 Gen11 Server", "₹96,000"],
  ["Enigma Infotech", "New Delhi", "Enterprise Grade Rack Server", "₹9,00,000"],
  ["Creativepro It Services LLP", "", "HPE Proliant ML350 Gen11 Tower Server", null],
  ["Sureworks Infotech Private Limited", "", "HPE ProLiant DL560 Gen9 Server", "₹90,000"],
  ["Dynamic IT Devices Private Limited", "", "Cisco UCS C240 M5 Rack Server", "₹34,000"],
  ["Radical Technologies Private Limited", "", "HPE DL385 Gen10", "₹2,50,000"],
];

const NETWORKING: Listing[] = [
  ["3A Exports", "Mumbai", "MC210CS Gigabit Single-Mode Media Converter, For Networking", "₹2,700/Piece"],
  ["Dron Edge India Private Limited", "Noida", "24 Networking Devices And Equipment, For Ftth, Model Name/Number: Model", "₹25,000/Piece"],
  ["Ambika Electronics", "New Delhi", "Ubiquiti Power Beam AC GEN2 for PTP", "₹10,500/Unit"],
  ["Rectus India", "New Delhi", "Power Beam 620 ac, Model Name/Number: PBE-5AC-620", "₹22,000/Piece"],
  ["Eion Info", "Salem", "RIVERBED STEELHEAD CXA-05070-B010", "₹15,000/Piece"],
  ["Candid Optronix Private Limited", "New Delhi", "Optronix EOC Slave With 4 FE And 1 RF, Model Name/Number: KT-ES07", "₹944/Piece"],
  ["Surabhi Technology Services", "Chennai", "Checkpoint Networking Devices, For Firewall", "₹20,000/Unit"],
  ["Airpath Wirelessnet Solutions", "Chennai", "MIKROTIK RBDISCG-5ACD 21DBI 5GHZ ANTENNA DUAL CHAIN 802.11AC", "₹5,550/Piece"],
  ["Khushi Communications Private Limited", "New Delhi", "Albedo Net Storm WAN Emulator", "₹8,50,000/Piece"],
  ["Netserve IT Solutions Private Limited", "Gurugram", "Cisco ASA 5500 Firewall", "₹55,000/Piece"],
  ["Secure Tekno Systems", "New Delhi", "Data And Voice Networking Equipment", "₹1,050/Piece"],
  ["Cloud Infotech Private Limited", "Noida", "UBIQCOM GPON/XPON ONU - UB5021 GV", "₹715/Piece"],
  ["Infomac It Solutions Private Limited", "Mumbai", "LAN Capable Cisco SG300-28/K9 Network Switch", "₹11,500/Piece"],
  ["Lucents Technologies India Private Limited", "Lucknow", "Regeneration TAPs", "₹5,000/Piece"],
  ["Tanish Wifi Technologies", "Mumbai", "RB911G-5HPacD-NB Net Box 5 Outdoor Client Device", "₹7,600/Piece"],
  ["Xsol Data System Private Limited", "New Delhi", "Big Server Mart - Servers & Networking Devices", "₹25,000/Piece"],
];

const PRINTERS: Listing[] = [
  ["Krishna Engineering Works", "Ahmedabad", "Industrial Thermal Transfer Overprinter", "₹2,50,000"],
  ["Prezotech Solutions Private Limited", "New Delhi", "Zebra Black ZT600 Series Industrial Printers", "₹2,20,000"],
  ["Maven Automation", "Ahmedabad", "Thermal Mild Steel Honeywell PM43 Industrial Printers", "₹70,000"],
  ["ADVANCED INDUSTRIAL MICRO SYSTEMS", "Mumbai", "Industrial Smart Laser Printer SLP 10B", "₹2,49,000"],
  ["DV IT Solution", "Raigad", "4inch TSC ML Series Compact Industrial Printer, Black", "₹89,000"],
  ["Shiva Enterprises", "New Delhi", "INDUSTRIAL PRINTERS", "₹10,000"],
  ["Barcode Enterprises", "Hyderabad", "Honeywell PM45 Industrial Printer", "₹65,000"],
  ["Printronix India Private Limited", "Mumbai", "Black Industrial open print line printer", "₹7,50,000"],
  ["Jetmark Systems Private Limited", "Kolkata", "Savema 32 Continuous without Cassette TTO Printer", "₹3,58,000"],
  ["S. Solutions", "Mumbai", "Citizen CL-S 700/703/700R Barcode Label Printer", "₹75,000"],
  ["Ai-Scanbar Tech Solutions", "Ghaziabad", "Printronix T8000 Industrial Printer", "₹95,000"],
  ["Shiv Packaging", "Ahmedabad", "Industrial Inkjet Printer", "₹10,000"],
  ["Vision Barcode Solutions", "Mumbai", "Industrial Printer, Black", "₹1,20,000"],
  ["Raj Barcode Solution", "Greater Noida", "ML Series 4-Inch Compact Industrial Printers, Black", "₹34,900"],
  ["Precise Systems And Solution Private Limited", "New Delhi", "Honeywell PM23c Mid Range Industrial Printer", "₹79,000"],
  ["DV Minerals And Associate", "Rewa", "Industrial Laser Printers", "₹3,00,000"],
  ["Vision Enterprises", "Pune", "TSC T6304e MID-RANGE INDUSTRIAL PRINTER", "₹1,25,000"],
  ["Digital Unique Solutions", "New Delhi", "K.m. Copier/ Printer 287, Color", "₹1,10,000"],
  ["Etikett Solutions Private Limited", "New Delhi", "Argox IX4 240 Industrial Barcode Printer", "₹45,000"],
  ["RP Barcode Solutions", "New Delhi", "TSC ML Series 4 Inch Compact Industrial Printers", "₹70,000"],
  ["Domipos Pos Solutions LLP", "Pune", "ZT610 RFID Industrial Printer", null],
  ["Safeline Enterprises", "Pune", "High End Industrial Printers", null],
  ["Nextep Engineering Private Limited", "Bengaluru", "CL6e Series Industrial Printer", "₹10,500"],
  ["Print Packaging Systems", "Mumbai", "Industrial Smart Laser Printer SLP 10B", "₹2,49,000"],
  ["Cloudswood Technologies Private Limited", "Bengaluru", "Zt510 Industrial Printer", "₹10,000"],
];

const DATA_STORAGE: Listing[] = [
  ["Labh Projects Private Limited", "Ahmedabad", "AI Data Centre SSD NAS Data Storage Devices - Labh Group", "₹3,00,000"],
  ["Futura Apsol Private Limited", "Pune", "Label Data Storage Device For Printing", "₹33,100"],
  ["Pretty Soft Wisdom", "Hyderabad", "Dell EMC Unity 550F Hybrid Flash Storage", "₹29,400"],
  ["Tiitan Industries Private Limited", "Gurugram", "Storage Devices", "₹12,599"],
  ["SNT International Private Limited", "Greater Noida", "Portable Data Storage Devices", null],
  ["Panaro Tech Private Limited", "Coimbatore", "Awanstor ZX Series Data Storage", null],
  ["Miltec Equipments And Systems Private Limited", "Hyderabad", "Data Storage & Backup Devices", null],
  ["Amvin Technology Solutions Pvt. Ltd.", "Bengaluru", "Data Storage Solutions", null],
  ["Pro Technologies", "Bengaluru", "Data Storage Devices", null],
  ["Quazar Technologies Private Limited", "New Delhi", "Data Storage & Operating System Portability", null],
  ["Wysetek Systems Technologists Private Limited", "Pune", "IBM Storage and Backup Devices", null],
  ["Fusionstor Technologies Private Limited", "Navi Mumbai", "Storage Device", null],
  ["Moser Baer (India) Ltd.", "Greater Noida", "Storage Media", null],
  ["Orion Office Products", "Mumbai", "Data Storage Device", null],
  ["KSG Automation Private Limited", "New Delhi", "HP LTO-8 Ultrium Data Cartridge Q2078A", "₹7,350"],
  ["NCS Techno Systems Private Limited", "Chennai", "TerraMaster D4 SSD 4-Bay All-Flash Storage Enclosure USB4 40Gbps", "₹38,900"],
  ["Tech Nobe Technologies LLP", "Secunderabad", "Infortrend EonStor GS 2012R / GS 2012S Unified Storage with SAN & NAS Support", "₹4,50,000"],
  ["Unify Computers", "Mumbai", "Dell Emc Unity 350F Al Flash Storage Controller", "₹1,50,000"],
  ["Arihant Info Solutions", "Mumbai", "STARDOM i310-1S-SB3", "₹10,000"],
  ["TPM Guru Private Limited", "New Delhi", "Emc Vnx 5300", "₹20,00,000"],
  ["Cdm Technologies & Solutions Private Limited", "New Delhi", "Sandisk Professional G-RAID SHUTTLE 8 - 48TB , 96TB , 144TB , 160TB , 192TB", "₹6,72,900"],
  ["Surabhi Technology Services", "Chennai", "Net App Storage Systems", "₹6,50,000"],
  ["Icons", "Mumbai", "Istorage Plastic Diskashur 2 Data Storage Device", "₹20,000"],
  ["Aaa Media Technologies", "New Delhi", "Q San XN 5112D with 24TB", "₹12,00,000"],
  ["Electronic People", "Mumbai", "Lto 5 / 6 / 7 / 8 Ultrium / Data Cartridge Hp Ibm", "₹1,500"],
  ["Industrial Consultants", "New Delhi", "Fully Automatic DELL STORAGE POWER VOULT MD 1220", "₹1,95,000"],
  ["Kcis Info Solutions Private Limited", "Faridabad", "Eon Stor GSE 4000 Gen2 Unified Storage", "₹3,50,000"],
  ["Mazenet Technologies", "Coimbatore", "Nas Storage Device", "₹1,50,000"],
  ["Stortech Solutions", "Bengaluru", "Sun Oracle StorageTek SL150 Modular Tape Library", "₹10,000"],
  ["Ramton Technologies Private Limited", "New Delhi", "Semi-Automatic Offline NetApp unified data storage", "₹1,20,000"],
  ["Fcoos Technologies Private Limited", "Bengaluru", "Secure NAS Storage For Office Data", "₹35,000"],
  ["Micro Comp Inc", "Bengaluru", "Stardom Sc2-wb3 2 Bay Enclosure USB 3.0& Firewire 800", null],
  ["Foxlink India Electric Private Limited", "Tirupati", "Memory Storage Devices", null],
  ["TDK India Pvt. Ltd.", "Bansbaria", "Flash Storage", null],
  ["Squire Technology", "", "Home And SOHO Storage", null],
  ["Glorious Color Images Private Limited", "New Delhi", "Storage Media", null],
  ["Vohra Brothers", "Siliguri", "PC Storage Products", null],
  ["Bengal Telecom Services", "Kolkata", "Plastic Black Data Storage Device", null],
];

const IT_PERIPHERALS: Listing[] = [
  ["JDM Technologies Private Limited", "New Delhi", "APC UPS Network Management Card(SNMP) For 1-10kva, For Fault Monitoring", "₹10,000/Piece"],
  ["Devi Enterprises", "Ahmedabad", "Computer Hardware, Computer Peripherals Microsoft LifeCam Cinema", "₹11,999/Piece"],
  ["Lohiya Electricals", "Bhavnagar", "PERIPHERAL DEVICE", "₹1,000/Piece"],
  ["3C IT Solutions And Telecoms (India) Limited", "Pune", "Active Networking Device", "₹2,400/Piece"],
  ["Pluckytechnologies", "Hyderabad", "External Storage Devices Computer Peripheral Accessories", "₹10,000/Piece"],
  ["I SYS Infotech", "Madurai", "Computer Peripheral", "₹50,000/Piece"],
  ["Sai Info Solution", "Chennai", "Computer Peripherals And Accessories", "₹10,000/Piece"],
  ["Vayu Technologies", "Pune", "USB Peripheral & presentation Switch", "₹1,45,000/Piece"],
  ["Ace Technologies", "Ahmedabad", "Modem Tray", "₹1,100/Piece"],
  ["Shivansh Global Infotech", "Gandhinagar", "Computer Peripherals", null],
  ["Jemminy Computer", "Ahmedabad", "Computer Peripherals", null],
  ["Deep Computer & Services", "Mumbai", "Computer Peripheral Accessories", null],
  ["RJ Digital Alliance", "Mumbai", "Computer Accessories ,,", null],
  ["DSF Technology Consultants Pvt. Ltd.", "New Delhi", "Ergotron Interactive Arm, HD 45-296-026", "₹21,851/Number"],
  ["Techshield Integrated Solutions", "Gurgaon", "Corporate Computer Accessories", null],
  ["Dopo Infosystems Private Limited", "Bengaluru", "Peripherals and Accessories", null],
  ["TVS Sensing Solutions Private Limited", "Madurai", "Keypad (g84-4700)", null],
  ["Rap Infosolutions Private Limited", "New Delhi", "Targus Bluetooth Presenter AMP11AP for Mac", null],
  ["Purvajyoti Infotech", "Guwahati", "Computer Peripherals", null],
  ["Natasha Enterprises", "New Delhi", "Peripheral Devices", null],
  ["Shree Enterprises", "Nashik", "Printer Peripherals", null],
  ["Classic Network & Computers", "New Delhi", "Computer Peripherals And Accessories Of Laptops & Desktops", null],
  ["Roshan Computers", "Chennai", "Computer Peripherals", null],
  ["Hi-Tech Computers Services Nashik Private Limited", "Nashik", "Computer Peripherals", null],
  ["Hi-Tech Enterprises", "Chandigarh", "Computer Hardware Product", "₹999/Piece"],
  ["AK Groups", "Faridabad", "Keyboard Plastic Tourbox Neo, Usb", null],
];

const ALL_SUBCATEGORIES: { key: keyof typeof SOURCES; entries: Listing[] }[] = [
  { key: "desktops", entries: DESKTOPS },
  { key: "servers", entries: SERVERS },
  { key: "networking", entries: NETWORKING },
  { key: "printers", entries: PRINTERS },
  { key: "dataStorage", entries: DATA_STORAGE },
  { key: "itPeripherals", entries: IT_PERIPHERALS },
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
  let existingIds: number[] = [6999]; // seed just below the 7000-7999 block (see lib/supplier-store.ts)
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
      if (c === "IT Hardware") continue;
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

  const dataFile = path.join(process.cwd(), "data", "suppliers", "it-hardware.json");
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ suppliers }, null, 2), "utf-8");
  console.log(`\nWrote ${suppliers.length} suppliers to ${dataFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
