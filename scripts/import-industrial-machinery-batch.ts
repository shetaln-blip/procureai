// Ingestion run: Industrial Machinery supplier batch (India-wide) — the
// second category batch of the 14-category supplier database expansion.
// Every record here traces to a real, fetched public source (see SOURCES
// below). Writes to data/suppliers/industrial-machinery.json — a SEPARATE
// file from office-furniture.json and the legacy packaging file, combined
// transparently at read time by lib/supplier-store.ts. Ids for this file
// are drawn from the 2000-2999 block reserved for industrial machinery
// (see the comment in lib/supplier-store.ts).
//
// Run with: npx tsx scripts/import-industrial-machinery-batch.ts
import { promises as fs } from "fs";
import path from "path";
import {
  normalizeSupplierRecord,
  computeDataConfidence,
  type RawSupplierRecord,
} from "../lib/ingestion/normalize";
import { findPotentialDuplicates, normalizeCompanyName } from "../lib/dedup";
import type { Supplier } from "../lib/supplier-types";

// ---------------------------------------------------------------------
// SOURCES
// ---------------------------------------------------------------------
// IndiaMART directory — the pan-India ("impcat") category page for each
// industrial-machinery subcategory below, fetched 2026-09-08. Each listing
// gives: company name, the city IndiaMART shows for that listing, one
// product name, and (for most listings) one indicative price for that
// single product — never generalized into a fabricated MOQ or full price
// range, neither of which this source provides at the category-page level.
//
// Unlike Batch 1 (a single "office furniture" category fetched across many
// CITIES), this batch fetches many different SUBCATEGORIES, each as one
// pan-India page — IndiaMART's national category pages already return
// listings from dozens of different cities/states directly (confirmed
// while fetching: Coimbatore, Rajkot, Batala, Bhiwadi, Howrah,
// Secunderabad, Rajahmundry, Bhavnagar, Jodhpur, Kochi, Jammu, etc. all
// appeared without any city-specific fetch), so geographic coverage here
// comes from that breadth rather than from fetching each subcategory once
// per city.
const RETRIEVED_AT_NOTE = "2026-09-08";

type SubcategorySource = {
  subcategory: string; // supplier-facing subcategory label
  url: string;
  sourceName: string;
};

const SOURCES: Record<string, SubcategorySource> = {
  general: {
    subcategory: "Manufacturing machinery",
    url: "https://m.indiamart.com/impcat/industrial-machinery.html",
    sourceName: "IndiaMART — Industrial Machinery directory",
  },
  materialHandling: {
    subcategory: "Material handling equipment",
    url: "https://m.indiamart.com/impcat/material-handling-equipments.html",
    sourceName: "IndiaMART — Material Handling Equipment directory",
  },
  automation: {
    subcategory: "Industrial automation",
    url: "https://m.indiamart.com/impcat/industrial-automation-systems.html",
    sourceName: "IndiaMART — Industrial Automation Systems directory",
  },
  pumps: {
    subcategory: "Pumps",
    url: "https://m.indiamart.com/impcat/industrial-pumps.html",
    sourceName: "IndiaMART — Industrial Pumps directory",
  },
  compressors: {
    subcategory: "Compressors",
    url: "https://m.indiamart.com/impcat/air-compressors.html",
    sourceName: "IndiaMART — Air Compressors directory",
  },
  generators: {
    subcategory: "Industrial generators",
    url: "https://m.indiamart.com/impcat/industrial-generator.html",
    sourceName: "IndiaMART — Industrial Generator directory",
  },
  hydraulic: {
    subcategory: "Hydraulic machinery",
    url: "https://m.indiamart.com/impcat/hydraulic-machines.html",
    sourceName: "IndiaMART — Hydraulic Machines directory",
  },
  pneumatic: {
    subcategory: "Pneumatic equipment",
    url: "https://m.indiamart.com/impcat/pneumatic-equipment.html",
    sourceName: "IndiaMART — Pneumatic Equipment directory",
  },
  machineTools: {
    subcategory: "Machine tools",
    url: "https://m.indiamart.com/impcat/machine-tools.html",
    sourceName: "IndiaMART — Machine Tools directory",
  },
  metalworking: {
    subcategory: "Metalworking machinery",
    url: "https://m.indiamart.com/impcat/metalworking-machinery.html",
    sourceName: "IndiaMART — Metalworking Machinery directory",
  },
  plastic: {
    subcategory: "Plastic processing machinery",
    url: "https://m.indiamart.com/impcat/plastic-processing-equipment.html",
    sourceName: "IndiaMART — Plastic Processing Equipment directory",
  },
  food: {
    subcategory: "Food processing machinery",
    url: "https://m.indiamart.com/impcat/food-processing-machine.html",
    sourceName: "IndiaMART — Food Processing Machine directory",
  },
  textile: {
    subcategory: "Textile machinery",
    url: "https://m.indiamart.com/impcat/textile-machines.html",
    sourceName: "IndiaMART — Textile Machines directory",
  },
  printing: {
    subcategory: "Printing machinery",
    url: "https://m.indiamart.com/impcat/printing-machine.html",
    sourceName: "IndiaMART — Printing Machine directory",
  },
  packagingMachinery: {
    subcategory: "Packaging machinery",
    url: "https://m.indiamart.com/impcat/packaging-machine.html",
    sourceName: "IndiaMART — Packaging Machine directory",
  },
  welding: {
    subcategory: "Welding machinery",
    url: "https://m.indiamart.com/impcat/welding-machine.html",
    sourceName: "IndiaMART — Welding Machine directory",
  },
  cutting: {
    subcategory: "Industrial cutting machinery",
    url: "https://m.indiamart.com/impcat/metal-cutting-machines.html",
    sourceName: "IndiaMART — Metal Cutting Machines directory",
  },
  mixing: {
    subcategory: "Industrial mixing equipment",
    url: "https://m.indiamart.com/impcat/mixing-equipment.html",
    sourceName: "IndiaMART — Mixing Equipment directory",
  },
  process: {
    subcategory: "Process equipment",
    url: "https://m.indiamart.com/impcat/pressure-vessels.html",
    sourceName: "IndiaMART — Pressure Vessels directory",
  },
};

// ---------------------------------------------------------------------
// City -> State lookup, covering every city that appeared across the 19
// subcategory pages fetched for this batch.
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
  Chandigarh: "Chandigarh",
  Ambala: "Haryana",
  Panipat: "Haryana",
  Sonipat: "Haryana",
  Kundli: "Haryana",
  Palwal: "Haryana",
  Bhiwadi: "Rajasthan",
  Jaipur: "Rajasthan",
  Jodhpur: "Rajasthan",
  Kishangarh: "Rajasthan",
  Udaipur: "Rajasthan",
  Mumbai: "Maharashtra",
  "Navi Mumbai": "Maharashtra",
  Sanpada: "Maharashtra",
  Thane: "Maharashtra",
  Pune: "Maharashtra",
  Nagpur: "Maharashtra",
  Nashik: "Maharashtra",
  Kolhapur: "Maharashtra",
  Sangli: "Maharashtra",
  Nanded: "Maharashtra",
  Vasai: "Maharashtra",
  Kalyan: "Maharashtra",
  Gadchiroli: "Maharashtra",
  Palghar: "Maharashtra",
  Khopoli: "Maharashtra",
  "Chhatrapati Sambhajinagar": "Maharashtra",
  Jejuri: "Maharashtra",
  "Pimpri Chinchwad": "Maharashtra",
  Moshi: "Maharashtra",
  Bengaluru: "Karnataka",
  Chennai: "Tamil Nadu",
  Coimbatore: "Tamil Nadu",
  Tiruppur: "Tamil Nadu",
  Erode: "Tamil Nadu",
  Ahmedabad: "Gujarat",
  Vadodara: "Gujarat",
  Surat: "Gujarat",
  Rajkot: "Gujarat",
  Anand: "Gujarat",
  Gandhinagar: "Gujarat",
  Vapi: "Gujarat",
  Dhoraji: "Gujarat",
  Waghodia: "Gujarat",
  Wadhwan: "Gujarat",
  Bhavnagar: "Gujarat",
  Kolkata: "West Bengal",
  Howrah: "West Bengal",
  Hyderabad: "Telangana",
  Secunderabad: "Telangana",
  Medak: "Telangana",
  Visakhapatnam: "Andhra Pradesh",
  Rajahmundry: "Andhra Pradesh",
  Ludhiana: "Punjab",
  Amritsar: "Punjab",
  Batala: "Punjab",
  Mohali: "Punjab",
  Agra: "Uttar Pradesh",
  Kanpur: "Uttar Pradesh",
  Bareilly: "Uttar Pradesh",
  Aligarh: "Uttar Pradesh",
  Saharanpur: "Uttar Pradesh",
  Dehradun: "Uttarakhand",
  Rudrapur: "Uttarakhand",
  Bhopal: "Madhya Pradesh",
  Indore: "Madhya Pradesh",
  Gwalior: "Madhya Pradesh",
  Raipur: "Chhattisgarh",
  Patna: "Bihar",
  Hisar: "Haryana",
  Una: "Himachal Pradesh",
  Kochi: "Kerala",
  Kalamassery: "Kerala",
  Pondicherry: "Puducherry",
  Jammu: "Jammu and Kashmir",
  Daman: "Dadra and Nagar Haveli and Daman and Diu",
  Bandoda: "Goa",
  Kaman: "Rajasthan",
  Kanaipur: "Gujarat",
  Bavla: "Gujarat",
  Upleta: "Gujarat",
  Kheda: "Gujarat",
  "Paonta Sahib": "Himachal Pradesh",
};

function locationFor(city: string): string {
  const cleanCity = city.split(",")[0].trim();
  const state = STATE_BY_CITY[cleanCity];
  return state ? `${cleanCity}, ${state}` : cleanCity;
}

type Listing = [string, string, string, string | null];

// ---------------------------------------------------------------------
// RAW LISTINGS, one array per subcategory (see SOURCES above for the URL
// and label each array corresponds to).
// ---------------------------------------------------------------------

const GENERAL: Listing[] = [
  ["Multidimensions", "Navi Mumbai", "Semi-automatic Wedger Pumpkin, Watermelon, Melon Cutter", "₹72,000"],
  ["Labh Projects Private Limited", "Ahmedabad", "Customised Machines Equipment", "₹15,00,000"],
  ["Yes Square Marketing", "Coimbatore", "Scrap Baling Press", "₹6,40,000"],
  ["Capital Industries", "Ahmedabad", "Double Head Three Hoppers Multi Function Forming Machine", "₹10,00,000"],
  ["Micro Tech Engineering", "New Delhi", "Perfume Making Machine", "₹2,56,319"],
  ["Intimate Machine Tools", "Rajkot", "Acrylic Doweling Machine", "₹2,85,000"],
  ["Rajesh Export & Import Co.", "Hisar", "Solar Panel Frame Dismantling Machine", "₹15,50,101"],
  ["Besto Industries", "Batala", "Belt Driven Shaping Machine", "₹2,50,000"],
  ["M S Klebstoffe", "New Delhi", "Router For Fitting Hinges", "₹1,15,000"],
  ["Iyalia Engineering Solutions India", "Coimbatore", "Industrial Automation High Speed Bar Feeder Machine", "₹9,99,999"],
  ["Nathuram Jaiswal", "Kolkata", "Idler Roller Conveyor Welding Machine", "₹6,50,000"],
  ["SS Engineers & Consultants", "Rajahmundry", "Egg Washing Machine", "₹17,00,000"],
  ["Hi-Power Controls", "Chennai", "Vision Checking Machine", "₹6,00,000"],
  ["VSKS Electrical Technologies", "Chennai", "MLDIS Machines", "₹1,60,000"],
  ["Yash Food Equipment", "Navi Mumbai", "Egg Breaker Machine", "₹98,000"],
  ["Global Advertising Agency & Agro Industries", "Patna", "Multipurpose Ronda Machine", "₹95,000"],
  ["Hydrotech Engineering Works", "New Delhi", "Wall Plug Making Machine", "₹3,50,000"],
  ["A R Paper Plates", "Una", "Double Die", "₹65,000"],
  ["Rajaram Dies Maker", "Mumbai", "Titan Machine", null],
  ["S.K. Engineers", "Bareilly", "Wall Plug Making Machine", null],
  ["C.S. Engg. Works", "Howrah", "Custom Manufacturing Machine", null],
  ["Subrto Machine Tools", "Bhiwadi", "Industrial Machines", null],
  ["Megacity Industries", "Secunderabad", "Super Steel Machine", null],
  ["Khalsa Engineering Works", "Kolkata", "Separplast", null],
  ["Washmatic India Private Limited", "New Delhi", "Non Tilting Type washing unit", null],
  ["Zeemrah Enterprises", "Chennai", "Bung Processor", null],
  ["Univision Automation", "Pune", "Rear Suspension Pressing Fixture", null],
  ["Dynaxcel Engineers Private Limited", "Pune", "Heavy Engineering Industry Equipment", null],
];

const MATERIAL_HANDLING: Listing[] = [
  ["Rite Solution", "Ghaziabad", "Slab Marble or Bundle Handler", "₹4,00,000"],
  ["Presstech", "Chennai", "Hydraulic Material Handling Equipment", "₹10,000"],
  ["Bharatq Conveyor Automation Private Limited", "Manesar", "Truck Loading Conveyor", "₹45,000"],
  ["Carmac Technologies Private Limited", "Pune", "MasterMover SM100+ Compact Electric Tugger", "₹1,00,000"],
  ["Parul Engineering Private Limited", "Pune", "Mild Steel Material Handling Systems", "₹9,00,000"],
  ["Aaspee Machinery Private Limited", "Ahmedabad", "Choker Belt Oil Gas Pipeline", "₹31,500"],
  ["PM Industries And Process Equipments Private Limited", "Pune", "Hydraulic Stainless Steel Building Material Handling Systems", "₹17,50,000"],
  ["Eco Dynaamic Equipments", "Coimbatore", "Electric Material Handling Vehicle", "₹3,80,000"],
  ["Patel Manufacturing", "Upleta", "Sugarcane Manual Loader, For Industrial", "₹1,25,000"],
  ["Multidimensions", "Navi Mumbai", "WINKEL Telescopic Fork-Type TZ, VTZ, TZM, VTZM, DTZR", "₹12,75,000"],
  ["Amar Shiva Engineering Company", "Hyderabad", "Material Handling Equipment", "₹3,00,000"],
  ["Universal Technologies", "Pune", "Industrial Tugger Cart", "₹5,75,000"],
  ["ABC Trade Zone", "Coimbatore", "Material Handling Equipment Manufacturing", "₹5,00,000"],
  ["Remso Control Technologies Private Limited", "Greater Noida", "Remso Tundish For Steel Plant, For Industrial", "₹7,54,000"],
  ["E Safe Enterprises", "Jodhpur", "E-Safe Magnetic Material Handling Tool", "₹42,500"],
  ["New National Hydraulics", "Noida", "ZED Steerable Skates", "₹18,000"],
  ["Shree Modi Material Handling Co.", "Surat", "Battery Operated Pallet Trucks", "₹3,99,000"],
  ["Lokpal Industries", "New Delhi", "Material Handling Equipment", "₹45,000"],
  ["Yash Engineers", "Mumbai", "Material Handling Equipment", "₹16,000"],
  ["Shree Ram Enterprise", "Ahmedabad", "Fork Stacker Mild Steel Material Handling Equipment", "₹45,000"],
  ["Besto Material Handling Equipments", "Chennai", "5 Ton Material Handling Lift", "₹2,50,000"],
  ["Fab Tex Engineering Works", "Coimbatore", "6 Ton Machine Moving Skates", "₹34,000"],
  ["All Construction Equipments", "New Delhi", "Material Handling Equipments", "₹1,45,000"],
  ["Delite Systems Engineering (India) Pvt. Ltd.", "Mumbai", "Mild Steel Elevation Transfer Vehicle", "₹12,00,000"],
  ["S.S. Engineering & Industries", "Udaipur", "Slab Bundle Handler, For Industrial", "₹3,20,000"],
  ["Tool Range Depot Private Limited", "Kishangarh", "1000kg Slab Bundle Handler", "₹5,00,000"],
  ["M/s Annapurna Industries", "Ahmedabad", "Manual Hydraulic Horizontal Roll Handler", "₹55,000"],
  ["E S Industries", "Coimbatore", "Manual Material Handling Equipment, For Industrial", "₹6,000"],
];

const AUTOMATION: Listing[] = [
  ["Tekglobal Technologies", "Chennai", "Distillery Automation System", "₹35,000"],
  ["Nunes Instruments", "Coimbatore", "Automation and Robotics Trainer Instruments", "₹48,000"],
  ["Ecosys Efficiencies Private Limited", "Mumbai", "Industrial Automation PLC", "₹40,000"],
  ["R.S. Enterprises", "Chennai", "Industrial Automation System", "₹33,000"],
  ["Star Electricals", "Bhavnagar", "Wind Solutions V301-2", "₹1,500"],
  ["Yellow Retail", "Bengaluru", "B&R Industrial Automation Module", "₹20,000"],
  ["Nexus Automech Private Limited", "Ahmedabad", "Industrial Automation Systems", "₹15,00,000"],
  ["Labh Projects Private Limited", "Ahmedabad", "Factory Automation for Plastic Processing Industry Plant", "₹2,00,000"],
  ["Hi-Tech Combustion", "Ahmedabad", "Burner Automation System", "₹60,000"],
  ["A.S. International", "Ambala", "Industrial Automation Training Systems", "₹5,50,000"],
  ["Teczhar Private Limited", "Chhatrapati Sambhajinagar", "Industrial Automation Systems, 440V", "₹55,000"],
  ["Proflex Engineering", "Bandoda", "Industrial Automation System", "₹40,000"],
  ["Miranda Automation Private Limited", "Navi Mumbai", "Industrial Automation System", "₹17,40,000"],
  ["Imatics", "Chennai", "Three Phase Industrial Automation System, 440V", "₹4,00,000"],
  ["Wonder Systems (India) Private Limited", "Mohali", "Parker SSD Spare Power Board DC Drives", "₹2,999"],
  ["DVC Process Technologists", "Jejuri", "Tank Farm Automation Plant", "₹10,00,000"],
  ["Power Drives Enterprises (India) Private Limited", "Chennai", "Pick and Place Automation System", "₹1,75,000"],
  ["Aumcontrols And Equipment", "Ahmedabad", "Industrial Automation System", "₹1,50,000"],
  ["Hitech Automation", "Pune", "Industrial Automation Systems", "₹7,500"],
  ["Sarita Enterprises", "Panipat", "System Integration Services - Industrial Automation", "₹44,555"],
  ["General Motion Control", "Ahmedabad", "Industrial Automation System", "₹60,000"],
  ["Adatronix Private Limited", "Bengaluru", "Industrial Automation Components, 5V", "₹17,430"],
  ["Vision Automation & Robotic Solution", "Gurugram", "Panasonic Industrial Automation Products", "₹10,000"],
  ["D. S. Industrial Solution", "Gurgaon", "Line Automation System, Wired", "₹3,00,000"],
  ["Ampper Controls And Automation", "Coimbatore", "Water Treatment Automation Systems", "₹6,00,000"],
  ["Crystal Technology", "Pune", "Industrial Automation Components", "₹3,910"],
  ["Global Systems", "Chennai", "Industrial Automation Products", "₹15,000"],
];

const PUMPS: Listing[] = [
  ["Mini Max Dosing Pumps", "Nashik", "Triple Headed Dosing Pumps", "₹24,000"],
  ["Aira Trex Solutions India Private Limited", "Bengaluru", "KSB Custom-built Automatic Industrial Pump", "₹6,000"],
  ["Leakless India Engineering", "Mumbai", "150 Meter Mild Steel Industrial Pumps, 10 HP", "₹49,000"],
  ["Be Traders", "Coimbatore", "Hydracell Pump for Coolant", "₹2,50,000"],
  ["JB Pumps India Private Limited", "Ahmedabad", "150 Meter Mild Steel Industrial Pumps, 10 HP", "₹15,000"],
  ["Sujal Engineering", "Ahmedabad", "Up to 45 mtr STP Pump", "₹9,800"],
  ["Jay Ambe Engineering Co.", "Ahmedabad", "Waste Water Treatment Industrial Pumps", "₹45,000"],
  ["Slurry Pumps & Engineers", "Ahmedabad", "Abrasive Slurry Pumps", "₹85,000"],
  ["MS Radix Impex Solutions", "Ahmedabad", "Industrial Pumps (Gear Pump)", "₹5,000"],
  ["Amee Industries", "Ahmedabad", "Air Cooled Pump", "₹18,000"],
  ["Flow Line Pumps And Engineers", "Ahmedabad", "Starch Transfer Centrifugal Chemical Pump", "₹22,500"],
  ["N.P.Syndicate", "Kolkata", "Industrial Vacuum Pumps", "₹65,000"],
  ["Indo Marine Spares", "Bhavnagar", "Aluminium Hobart Pump, For Industrial", "₹1,00,000"],
  ["Indserv Pune Private Limited", "Pune", "50 Meter Industrial Pumps, 7.5 HP", "₹1,00,000"],
  ["Yash Blowers Private Limited", "Faridabad", "Aluminium Industrial Pumps, 3 HP", "₹31,000"],
  ["A G Marine Trading", "Navi Mumbai", "50 Meter Mild Steel FIFI Pump, 1 HP", "₹50,000"],
  ["Harsiddhi Manufactures & Marketing", "Rajkot", "Hi Head Pump", "₹2,25,000"],
  ["Aaditya Mechatronics LLP", "Noida", "Mild Steel Pail Pump For Industrial", "₹1,20,000"],
  ["AL Tech Centrifuges", "Bhavnagar", "Taiko Kikai Pumps", "₹2,90,000"],
  ["Malwi Marine Enterprises", "Bhavnagar", "EBARA - EVM, EVMS Pump", "₹10,000"],
  ["Jee Pumps Limited", "Ahmedabad", "Eva Operation Pump", "₹22,000"],
  ["Sms Pumps And Engineers", "Ahmedabad", "Industrial Process Pumps", "₹35,000"],
  ["Vibgyor Color Solutions", "New Delhi", "Bell Metal High-Pressure Plunger Pump", "₹14,999"],
  ["Saksham Industries", "Kanpur", "Mild Steel Sugar Syrup Pump, 2 HP", "₹25,000"],
  ["Shukan Engineering", "Ahmedabad", "Mild Steel Industrial Centrifugal Pump, 2 HP", "₹32,000"],
  ["Parshwa Traders", "Mumbai", "Stainless Steel 50 Meter Industrial Centrifugal Pumps", "₹13,500"],
  ["Microtech Engineering", "New Delhi", "Wet Scrubber Pump", "₹19,859"],
  ["Ambica Machine Tools", "Ahmedabad", "100 Mtrs Cast Steel Thermic Fluid Pump", "₹55,000"],
];

const COMPRESSORS: Listing[] = [
  ["Sumved International", "Navi Mumbai", "Nardi Paintball & PCP Air Compressor", "₹7,00,000"],
  ["Delta Separation", "Bhavnagar", "Sperre HL2/160 Air Compressor", "₹2,20,000"],
  ["Karan Micro Industries", "Ahmedabad", "10 Hp Air Compressor", "₹1,10,400"],
  ["Sunrise Instruments Private Limited", "Pune", "3HP Air Compressor, 200 Ltr", "₹44,500"],
  ["A G Marine Trading", "Navi Mumbai", "0.5 HP Yanmar Air Compressors", "₹1,00,000"],
  ["Eastman Cast & Forge Limited", "Ludhiana", "Eastman Air Compressor Machine", "₹1,394"],
  ["H.P.Singh & Co.", "Kolkata", "2 HP Air Compressor Machine", "₹32,000"],
  ["Kismat Machines India Private Limited", "Pune", "Yuva Vayu 3HP Industrial Air Compressor", "₹53,100"],
  ["Ahmedabad Pneumatic", "Gandhinagar", "Mining Air Compressor", "₹4,55,000"],
  ["Urvi Corporation", "Ahmedabad", "3 HP Spray Painting Air Compressor", "₹12,000"],
  ["Majestic Marine And Engineering Services", "Bhavnagar", "5 HP Tanabe Air Compressors", "₹1,50,000"],
  ["Harsiddhi Manufactures & Marketing", "Rajkot", "Industrial Air Compressor", "₹86,000"],
  ["Vatsa Enterprises", "Agra", "Metabo Compressor Basic 250-24", "₹21,003"],
  ["Shiv Engineering Works", "Faridabad", "Screw Air Compressor, 2 HP", "₹37,500"],
  ["Sanjay Tools And Accessories Pvt. Ltd.", "Pune", "Kaeser Air Compressor", "₹2,00,000"],
  ["Universe Shipping & Trade Links", "Mumbai", "3 Hp Single Phase Grasso Air Compressors", "₹10,000"],
  ["A-One International", "Ahmedabad", "5 HP Air Compressor", "₹53,000"],
  ["Manatec Electronics Private Limited", "Pondicherry", "10HP Air Compressor", "₹1,51,100"],
  ["Sigma Air Source", "Ahmedabad", "10 Hp Air Compressor, 300 L", "₹95,000"],
  ["Leanwork Solutions LLP", "Kalyan", "5 HP Tank Mounted Air Compressor", "₹92,500"],
  ["Empire Compressor Private Limited", "Ahmedabad", "15 HP Screw Air Compressor", "₹2,60,000"],
  ["Sharia Exports", "Ahmedabad", "24 bar Doosan Air Compressor", "₹25,00,000"],
  ["AL Tech Centrifuges", "Bhavnagar", "Hatlapa Air Compressor", "₹5,75,000"],
  ["Malwi Marine Enterprises", "Bhavnagar", "10 HP Yanmar SC40N Air Compressor", "₹10,000"],
  ["M. Harakhji And Sons", "Bhavnagar", "Reciprocating Sperre HV2-270 Air Compressor", "₹1,49,999"],
  ["Naman Automotive Solutions", "Ahmedabad", "10 HP Air Compressor", "₹60,000"],
  ["Shabbir Packaging Industries", "Vadodara", "8 Hp Air Compressors", "₹55,552"],
  ["Abhi Marine Private Limited", "Navi Mumbai", "Unused TMC 14-8 EANA Compressors", "₹6,21,879"],
];

const GENERATORS: Listing[] = [
  ["Dazzle Power Generators", "Mumbai", "7.5 Kva Industrial Portable Generator Set", "₹95,000"],
  ["Maruti Infinity", "Rajkot", "Prime 1125 KVA Perkins Diesel Generator (Open Type)", "₹82,00,000"],
  ["Vaishnavi Power Technolgy", "Bengaluru", "Diesel 100 KVA Industrial Power Generator Set", "₹11,50,000"],
  ["GMDT Marine And Industrial Engineering Private Limited", "Ahmedabad", "30 kVA Industrial Diesel Generators", "₹4,15,000"],
  ["Abhi Marine Private Limited", "Navi Mumbai", "3-Phase Pielstick Generator Set", "₹22,52,265"],
  ["GMT Marine India", "Bhavnagar", "Wartsila HFO Generator Set, 5.4 MW", "₹1,00,000"],
  ["Shama Global", "Faridabad", "Industrial Heating Generator", "₹75,000"],
  ["Unitrade International", "Kolkata", "15 kVA Mitsubishi Diesel Generator", "₹70,000"],
  ["J.K.Engineers And Traders", "Coimbatore", "Industrial Diesel Generator, 125 kVA", "₹7,50,000"],
  ["RST Electricals Private Limited", "Ghaziabad", "Industrial Diesel Generator, 125 kVA", "₹7,15,000"],
  ["Aastha Power Project", "Surat", "Industrial Diesel Generator, 125 kVA", "₹13,40,000"],
  ["RA Power Solutions Private Limited", "Gurugram", "Industrial Generator", "₹60,000"],
  ["EO Energy Private Limited", "Faridabad", "Air Cooling Generator, 40 kVA", "₹6,00,000"],
  ["Riddance Engineering", "Mumbai", "Diesel Industrial Generator, 40 kVA", "₹5,65,000"],
  ["Asian Construction Equipment Co.", "Kochi", "Industrial Power Generator, 120-240V", "₹85,000"],
  ["Sunlite Generators", "Chennai", "Diesel Industrial Generator, 160 kVA", "₹16,00,000"],
  ["Raipur Industrial Sales & Service", "Raipur", "125 kVA Industrial Use Generator", "₹6,50,000"],
  ["Deepak Engineering Stores", "Rajkot", "Diesel Industrial Power Generators, 30 kVA", "₹1,00,000"],
  ["House Of Power Equipments", "Mumbai", "Diesel 20 kVA Generator", "₹3,30,000"],
  ["Alfent Developers Private Limited", "Kalamassery", "250kVA Diesel Generator Sets, 3 Phase", "₹3,00,000"],
  ["Navdeep Trading Company", "Jammu", "Industrial Generator Set", "₹54,000"],
  ["SRF Power Machine", "Mumbai", "Industrial Generator, 125 kVA", "₹3,60,000"],
  ["Utech Power LLP", "Pune", "Diesel Industrial Generators, 30 kVA", "₹5,00,000"],
  ["R S Power Products", "Thane", "Diesel Industrial Generators", "₹7,10,000"],
  ["Uvdv Power Engineers", "Chennai", "500 kVA Generator", "₹30,00,000"],
  ["Zaheeruddin Generator Co.", "Mumbai", "Industrial Generator Gasoline, 6500W", "₹85,000"],
  ["KD Enterprise", "Rajkot", "Diesel 200KVA Industrial Generator", "₹20,00,000"],
  ["Nano Generators India Private Limited", "Bengaluru", "625 kVA Industrial Diesel Generator", "₹50,00,000"],
];

const HYDRAULIC: Listing[] = [
  ["Marathon Engineering", "Ahmedabad", "40 Ton SPM Hydraulic Machine", "₹1,90,000"],
  ["Mittwoch Technologies", "Agra", "Polymer Insulator Hydraulic Moulding Machine", "₹13,50,000"],
  ["Shree Umiya Engineers", "Ahmedabad", "Hydraulic Rotary Composer Machine", "₹16,50,000"],
  ["Santec Exim Pvt. Ltd.", "Manesar", "Iron Hydraulic Machine", "₹7,50,000"],
  ["Rudraksh Engineering", "Rajkot", "Mild Steel Variable Rack Angle Hydraulic Shearing Machine", "₹6,00,000"],
  ["Achieve Hydraulics & Pneumatics Limited", "Pune", "Automatic Hydraulic Flushing System, 50 Ton", "₹5,00,000"],
  ["Oham Engineers", "Ahmedabad", "Hydraulic Baling Press", "₹6,69,999"],
  ["Shree Hydraulicpress Industries", "Rajkot", "Hydraulic Deep Drawing Press Machine, 100-500T", "₹35,00,000"],
  ["Fluidics Engineers Private Limited", "Coimbatore", "Mild Steel Hydraulic Press Machine, 630KN", "₹8,00,000"],
  ["S And S Industries", "Anand", "Mild Steel Hydraulic Press Machine, 440V", "₹2,34,567"],
  ["AS Mechfluid Solutions Private Limited", "Jaipur", "Hydac Filtration Machine", "₹1,50,000"],
  ["Ashapura Industries", "Ahmedabad", "Hydraulic Double Action Press", "₹3,00,000"],
  ["Parrytech Hydraulics", "New Delhi", "Special Purpose Machine", "₹5,00,000"],
  ["Jai Matadi Engineering", "Kolkata", "Hydraulic Paper Cutting Machine", "₹90,000"],
  ["Prabha Machine Tools Private Limited", "Coimbatore", "Hydraulic Press Machine, 80 Ton", "₹1,28,000"],
  ["Maruti Machine Tools", "Rajkot", "C Type Hydraulic Press Machine", "₹5,50,000"],
  ["JSD Engineering Products Private Limited", "Faridabad", "Mild Steel 150 Ton Deep Draw Hydraulic Press", "₹9,80,000"],
  ["Shad Engineering Works", "New Delhi", "Hydraulic Press", "₹2,00,000"],
  ["Vansh Industries", "Dehradun", "Hydraulic Joggling Machine", "₹4,50,000"],
  ["Jeet Machine Tools Corporation", "New Delhi", "Hydraulic Press Machine (Manual)", "₹57,500"],
  ["Hari Engineering Works", "Rajkot", "Harison Hydraulic Single Action Press Machine", "₹1,25,000"],
  ["Yashwant Industries", "Ahmedabad", "Hydraulic Joggling Machine, 10 Ton", "₹3,00,000"],
  ["A S Hydraulic Engg. (Regd)", "Ludhiana", "Mica Paste Hydraulic Press, 10-100 Ton", "₹4,50,000"],
  ["Ace Automation", "Coimbatore", "Cast Steel 4 Pillar Hydraulic Press, For Industrial", "₹2,00,000"],
  ["Indotech Industries", "Rajkot", "Automatic 200 Ton Four Column Type Workshop Hydraulic Press", "₹8,00,000"],
  ["Royal Hydrotech", "Bhiwadi", "Mild Steel Hydraulic Power Pack Machine", "₹1,50,000"],
  ["Shri Vaishno Enterprises", "New Delhi", "Hydraulic Fully Automatic Machine", "₹70,000"],
  ["Advance Hydraulic Works", "New Delhi", "150 Ton Hydraulic Press Machine", "₹2,00,000"],
];

const PNEUMATIC: Listing[] = [
  ["RB Tech India", "Bhiwadi", "Pneumatic Cylinders", "₹660"],
  ["Metal Work Pneumatic India Private Limited", "Bengaluru", "Air Pressure Multiplier", "₹29,498"],
  ["Dolly Enterprises", "Thane", "Stainless Steel Cylinders, For Industrial", "₹7,896"],
  ["B V Transmission Industries", "Mumbai", "Pneumatic Mounting, For Industrial", "₹310"],
  ["Vikas Machinery And Automobiles", "Rajkot", "Industrial Pneumatic Vise", "₹18,000"],
  ["Leo Royal Techserve Private Limited", "Chennai", "SMC Gap Checker", "₹20,000"],
  ["Sia Fluid Controls Private Limited", "New Delhi", "FESTO Suction Cup", "₹540"],
  ["Arise Tecnica", "Ahmedabad", "Regulator With Gauge", "₹650"],
  ["Alfa Hoses & Hydraulics Pvt. Ltd.", "Vadodara", "Pneumatic Products", "₹2,000"],
  ["IBK Engineers Private Limited", "Bengaluru", "Plain Feed Escapements", "₹50,000"],
  ["Star Automations", "Chennai", "Pneumatic Cylinder", "₹18,000"],
  ["Gravity Controls", "Vasai", "Pneumatic System For Pet Moulding", "₹19,250"],
  ["Raj Industrial Product", "Ahmedabad", "Pneumatic Cylinder Mounting", "₹120"],
  ["Vector Technologies", "Hyderabad", "Air Shot-Hammer", "₹5,000"],
  ["Marshal Haydraulics And Pneumatics", "Sangli", "Pneumatic Cylinder", "₹750"],
  ["Airpro Pneumatics India Private Limited", "Gurugram", "Air Screwdriver Heavy Duty", "₹4,537"],
  ["Tree Point Engineering", "Tiruppur", "Digital Pneumatic Equipment", "₹460"],
  ["Neo Automation", "Ahmedabad", "Multi-Link Systems Equipment", "₹20,000"],
  ["JMD International", "Mumbai", "Air Polisher", "₹23,400"],
  ["Satkirti Filter Technologies Private Limited", "Pune", "Pneumatic Rod", "₹525"],
  ["Fidus India Automation Private Limited", "Gurugram", "Air Gripper", "₹123"],
  ["Adatronix Private Limited", "Bengaluru", "SMC Pneumatic Equipment", "₹29,769"],
  ["Pace Assembly Tools", "Faridabad", "Air Filter", "₹5,455"],
  ["Starplus Engineering Enterprises", "Coimbatore", "Industrial Pneumatic Products", "₹750"],
  ["KEW Engineering & Manufacturing Private Limited", "Ahmedabad", "Pneumatic Cylinder", "₹2,500"],
  ["S. Balaji Mech-Tech Private Limited", "New Delhi", "Pneumatic Valve", "₹1,607"],
  ["A S International", "Mumbai", "Pneumatic Cylinder", "₹500"],
  ["Fluid Power Machines Private Limited", "Coimbatore", "Pneumatic Products", "₹31,000"],
];

const MACHINE_TOOLS: Listing[] = [
  ["HK Tools", "Mumbai", "Alloy Steel BT40 Pull Studs", "₹90"],
  ["Techno-Mech Machine Tools", "Rajkot", "Mild Steel Lathe Machine Tools", "₹1,27,000"],
  ["Powertech Industrial Equipments", "Thane", "Grooving Tool", "₹100"],
  ["Machinery Clinic", "Ahmedabad", "Machine Tool Precision Scraping Service", "₹1,10,000"],
  ["Unnati Tube Tools", "Thane", "Mild Steel Pulling Spear Tools, For Industrial", "₹1,000"],
  ["Tecroot Space (OPC) Private Limited", "New Delhi", "Stainless Steel Swiss Tools", "₹500"],
  ["Boyd Inc", "Kolkata", "Used Machine Tool", "₹40,000"],
  ["Renuka Tools", "Chhatrapati Sambhajinagar", "Steel Special Turning Tools / CNC Turning Tools", "₹5,000"],
  ["Uday Tech Engineering", "Chennai", "Tool Lever", "₹100"],
  ["R K Enterprise", "Rajkot", "Vertical Lathe Machine Tools", "₹150"],
  ["Ranoson Machines Private Limited", "Noida", "Spring Machine Tools", "₹10,000"],
  ["S. M. Shah & Company", "Mumbai", "Machine Tool Power Units", "₹20,000"],
  ["Anviloy Tooling Solution Private Limited", "Faridabad", "Rapid Drill Echain Tools", "₹2,800"],
  ["Universal Package Machinery", "Paonta Sahib", "Corrugation Machine Adopters & Fingers", "₹90"],
  ["Sun Automation", "Pune", "Mild Steel Three Phase Machine Tools", "₹9,600"],
  ["Weld In Equipments Private Limited", "Mumbai", "Stainless Steel Squeezer Tool", "₹1,25,000"],
  ["Labdhi Engineering Co.", "Mumbai", "Stainless Steel Electric Drilling Machine Tool", "₹4,321"],
  ["SMK Turnkey Solutions Pvt. Ltd.", "Pune", "Renishaw Machine Tool Probes And Software", "₹70,000"],
  ["Niksu Power Tools", "Thane", "Belling Tools", "₹1,500"],
  ["Sri Sabari Marketing Services", "Coimbatore", "Industrial Machine Tools", "₹1,500"],
  ["Sarveshwari Technologies Ltd.", "Sonipat", "Portable Rear Slip Plates for Wheel Alignment", "₹30,000"],
  ["Hakimi Enterprises", "Pune", "Cast Iron Tool Holder Devices", "₹1,450"],
  ["Burhani Trading Company", "Nagpur", "Brad Point Drilling Machine Tool", "₹1,150"],
  ["Sharad Enterprise", "Mumbai", "Milling Insert Stainless Steel Machine Tools", "₹5,400"],
  ["Silver Solutions", "Indore", "Mild Steel Safety Machine Tools", "₹105"],
  ["Electricano Company", "Pimpri Chinchwad", "CNC Lathe NC Machine Tool", "₹1,97,000"],
  ["Ajeet Enterprises", "Ludhiana", "Carbide Insert Iron Slotting Machine Tool", "₹40,000"],
];

const METALWORKING: Listing[] = [
  ["Labh Projects Private Limited", "Ahmedabad", "Semi Automatic Stainless Steel Utensils Production Plant", "₹15,00,000"],
  ["New NU", "Visakhapatnam", "Fully Automatic Imported Metalworking Machinery", "₹5,00,000"],
  ["Shiva Shakthi Enterprises", "Bengaluru", "Fully Automatic Metal Working Machines", null],
  ["Abro Technologies Private Limited", "New Delhi", "Sheet Metal Working Machine", null],
  ["Naugra Export", "Ambala", "Carpentry / Metal Working / Welding Workshop Machines", null],
  ["KPT Industries Limited", "Kolhapur", "Metal Working Drills Machine", null],
  ["Manisha Kailas Gopale", "Pune", "Sheet Stamping Mechanical Press, 500 Ton", null],
  ["Pavan Machine Tools & Services India Private Limited", "Bengaluru", "Metal Work Machines", null],
  ["NSL Automation Systems", "Medak", "Metalworking Machinery", null],
  ["Spearhead Engineering Solutions LLP", "Secunderabad", "Fiber Laser Metalworking Machine", null],
  ["Lakshya Chain Link Manufacturing", "Raipur", "Metalworking Machinery", "₹50,000"],
  ["Naveen Enterprises", "Gurugram", "Bending & Metalwork Machines", "₹15,000"],
  ["Chavan Enterprise", "Pune", "Bending & Metalwork Machines", "₹1,50,000"],
  ["Jankar Industries", "Mumbai", "Special Purpose Sheet Metal Machinery", null],
  ["Dcab And Company", "Bhopal", "Metalworking Machinery", null],
  ["Maa Tapeswari Hardware", "Kanpur", "Bending & Metalwork Machines", null],
  ["Kishore Metal Works", "Mumbai", "Metal Work Machines", null],
  ["Nitshaw Technologies", "Bengaluru", "Metal Working Machinery", null],
  ["Stara Engg International", "Pune", "Metal Working Machinery", null],
  ["Eurotech World", "Chandigarh", "Metalworking Machinery", null],
  ["S. S. Machining Tools", "Bengaluru", "Sheet Metal Processing Machines", null],
  ["Shree Jalaram Engineering Works", "Surat", "Metal Working Machine", null],
  ["Kathare Power Tools", "Nanded", "Angle Grinders Metal Working Machine", null],
  ["BMS Electrical And Automation", "Rudrapur", "Sheet Metal Machinery", null],
];

const PLASTIC: Listing[] = [
  ["Archana Extrusion Machinery Manufacturing", "Ahmedabad", "Automatic Plastic Processing Equipment", "₹3,75,000"],
  ["Hindustan Plastic And Machine Corporation", "New Delhi", "Plastic Recycling Plant", "₹36,50,000"],
  ["Sant Engineering Industries", "New Delhi", "Plastic Reprocessing Equipment", "₹2,00,000"],
  ["C S Equipments And Engineering", "Nagpur", "Plastic and Sand Equipment", "₹5,00,000"],
  ["Abhinav Engineering", "Daman", "Plastic Agglomerator Machine, 500 kg/hr", "₹3,50,000"],
  ["Sun Plasto Chem", "Dhoraji", "Plastic Processing Aid (fluoro-based masterbatch)", null],
  ["Shree Ganesh Engineering Works", "Jaipur", "Rubber & Plastics Processing Equipment", null],
  ["Everest Plastic Machinery", "Bengaluru", "Plastic Machinery Equipment", null],
  ["Daiichi Jitsugyo India Private Limited", "Bengaluru", "Plastic Molding Processing Equipment", null],
  ["Macfield Injection Moulding Machines", "Chennai", "Plastic Processing Equipments", null],
  ["S S Indian Representative Office", "Pune", "Plastics Production & Processing Equipment", null],
  ["PRM Automotives India Private Limited", "Chennai", "Plastic Molding / Processing Equipment", null],
  ["Yuvaan Enterprise", "Anand", "Plastic Processing Aids", null],
  ["Boolani Engineering Corporation", "Mumbai", "Custom Built Plastic Machines", null],
  ["Param Engineering Works", "New Delhi", "Plastic Processing Equipment", null],
  ["M R Engineers", "Daman", "Plastic Processing Equipment", null],
  ["Impex Engineering Works", "Noida", "Plastic Processing Machine & Accessories", null],
  ["Mother Industries", "Ahmedabad", "Plastic Processing Equipment", null],
  ["Gemini International Private Limited", "Mumbai", "Plastic Processing Equipments", null],
  ["Prabhavi Systems & Engineering", "Pune", "Plastic Processing Equipments", null],
  ["Satellite Plastic Industries", "Mumbai", "Plastic Processing Equipment", null],
  ["Bethel Electricals", "Bengaluru", "Plastic Processing Equipment", null],
  ["Milacron India Private Limited", "Ahmedabad", "Plastics Processing Equipment", null],
  ["Macplast Extrusion Technik", "Ahmedabad", "Plastic Processing Equipment", null],
  ["Phoenix Plastics Company", "Bengaluru", "Plastic Manufacturing Equipments", null],
  ["V D Swami And Company Private Limited", "Bengaluru", "Plastic Processing Machineries Accessories", null],
];

const FOOD: Listing[] = [
  ["Kalyan Machines", "Noida", "SS 304 Automatic Energy Bar Making Machine, 425 Kg", "₹7,95,000"],
  ["Growmax Machinery", "Noida", "Food Processing Machine, 100-120 kg/hr", "₹7,50,000"],
  ["Jackson Machine", "Ahmedabad", "Stainless Steel 200kg/Hr Automatic Food Processing Machinery", "₹1,20,000"],
  ["Indian Machine Mart", "New Delhi", "SS Single Phase Gulab Jamun Making Machine", "₹3,15,000"],
  ["Micro Industries", "Noida", "Automatic Food Processing Machine", "₹1,00,000"],
  ["Sri Brothers Enterprises", "Aligarh", "Bean Sprouts Washing and Dewatering Line", "₹7,75,000"],
  ["Thermocare Industries Limited", "Kanpur", "Mixer Gutkha Making Plant, 25 kg/hr", "₹11,00,000"],
  ["Ananta Machinery", "New Delhi", "SS-304 Food Processing Machine", "₹5,00,000"],
  ["Guru Engineers", "Pune", "Pulverizer Retort Food Processing Machines", "₹35,00,000"],
  ["National Packaging Solution", "Noida", "Automatic MS Food Processing Machine", "₹2,00,000"],
  ["Labh Projects Private Limited", "Ahmedabad", "Grinding Mill Nutrition Powder Making Production Machines", "₹8,00,000"],
  ["RZM Machinery Private Limited", "New Delhi", "Spring Roll Sheet Making Machine", "₹2,70,000"],
  ["Best Engineering Technologies", "Hyderabad", "Turmeric Rhizomes Oil Distillation Plant, 10 TPD", "₹12,00,000"],
  ["Fluid Process Solutions", "New Delhi", "Automatic SS Mayonnaise Plant", "₹14,80,000"],
  ["Packaging Solution", "Ghaziabad", "Food Processing Machine, Up to 25 kg/hr", "₹5,00,000"],
  ["Transmax Engineering Industries", "Vasai", "Food Chopper Machine", "₹25,000"],
  ["Excel Plants And Equipment Private Limited", "Pune", "Electric Blanching Machine", "₹5,00,000"],
  ["Aatomize Manufacturing Private Limited", "Rajkot", "Pulverizer Commercial Food Processing Equipment", "₹5,29,200"],
  ["Jas Enterprise", "Ahmedabad", "Automatic Stainless Steel Continuous Tahini Making Machine", "₹1,25,000"],
  ["Vaidikaz Industries", "Rajkot", "Vegetable Cutter Food Processing Machinery", "₹24,000"],
  ["Aqua Art & Engineering", "Ahmedabad", "Fully Automatic SS304 Food Processing Machine", "₹28,00,000"],
  ["Whirler Centrifugals Private Limited", "Ahmedabad", "Semi-Automatic Cassava Starch Processing Peeler Centrifuge", "₹10,00,000"],
  ["K P Engineering", "Ahmedabad", "Gulla Cutting Machine", "₹2,10,000"],
  ["Fansbro Erectors", "Vasai", "Upma Premix Manufacturing Plant", "₹2,80,000"],
  ["Rising Industries", "Kolkata", "Automatic Poha Making Machine, 150-200 kg/H", "₹75,000"],
  ["Kumaar Industries", "Coimbatore", "SS 202 Caramel Coating Machine", "₹75,000"],
  ["SS Engineers & Consultants", "Rajahmundry", "Vegetable Washing Machine, 500 Kg/hr", "₹3,50,000"],
];

const TEXTILE: Listing[] = [
  ["Five Fingers Exports India Private Limited", "Coimbatore", "Industrial Woven Roll Loom Machine", "₹9,00,000"],
  ["R. B. Electronic & Engineering Private Limited", "Vapi", "Textile Loop Steamer Machine", "₹12,00,000"],
  ["Hari Chand Anand & Co.", "New Delhi", "Collar Shaping And Blocking Machine", "₹3,65,000"],
  ["The Venus Engineering Company", "Ahmedabad", "Thread Polishing Machine", "₹13,00,000"],
  ["TCS Industries", "Vapi", "Laboratory Fabric Steamer", "₹2,00,000"],
  ["Annapurna Engineering Works", "Ahmedabad", "Textile Desizing Machine", "₹5,00,000"],
  ["Konica Electronics Enterprise", "Mumbai", "Automatic Airjet Loom With Staubli CAM", "₹15,00,000"],
  ["Mandakini Trading Co.", "Noida", "Stainless Steel Automatic Fabric Opening Machine", "₹1,65,000"],
  ["Arya M/C Tools", "Faridabad", "Textile Machine", "₹2,10,000"],
  ["Talwandi Technicals", "Nagpur", "Recron Poly Fiber Opening Machine", "₹1,65,000"],
  ["Sivan Industrial Engineering", "Erode", "Manual Fabric Spreading Machine", "₹1,20,000"],
  ["Veera Corporation", "Surat", "10 HP Jari Covering Textile Machine", "₹8,90,000"],
  ["Bazari Exim Pvt", "Ahmedabad", "Textile Stenter Machine", "₹35,00,000"],
  ["Gulamhusain Esufali Githam", "Mumbai", "Semi Automatic Eyeleting Machine", "₹30,000"],
  ["Sri Sundaramuthu Traders", "Coimbatore", "Pre-Owned Draw Frame (Rieter)", null],
  ["Sri Gayathri Engineering", "Coimbatore", "Textile Loop Steamer Machine", null],
  ["Meera Industries Ltd.", "Surat", "BCF Cabler / Twister for PP / Polyester / Nylon", null],
  ["Deep Inva Casting Gujarat Private Limited", "Ahmedabad", "Stainless Steel Semi Automatic Textile Drying Machine", null],
  ["Sujini Machines", "Coimbatore", "Semi-Automatic Rotary Bale Plucker Beater", "₹9,000"],
  ["Bea Electronics", "Gwalior", "Slub-O-Generator Fancy / Slub Yarn Attachment Machine", "₹6,00,000"],
  ["Bhatt Bros", "Ahmedabad", "Continuous Desizing Range", "₹30,00,000"],
  ["Uchotech India Private Limited", "Noida", "Manual Stainless Steel Steam Ager Machine", null],
  ["Parkash Textile Engineering Works", "Amritsar", "Semi-Automatic Mild Steel Textile Decanting Machine", "₹3,50,000"],
  ["Punjab Textiles Trading", "Ludhiana", "Mild Steel Textile Gill Box Machine", "₹8,00,000"],
  ["Bhumi Textiles Traders", "Surat", "Jari Conning Machine", "₹22,500"],
  ["Rathi Textile & Engineering Works", "Panipat", "Garnett Machine", "₹5,50,000"],
];

const PRINTING: Listing[] = [
  ["Avtar Mechanical Works", "New Delhi", "Pharmaceuticals Printing Machine", "₹9,00,000"],
  ["SK Ensure Machinery Private Limited", "Faridabad", "Mild Steel Pen Printing Machine", "₹89,000"],
  ["Viva Engineering", "Ahmedabad", "7 Colour Rotogravure Printing Machine", "₹23,00,000"],
  ["Sahil Graphics", "Faridabad", "Mini Offset Printing Machine", "₹10,50,000"],
  ["Aadvaita International", "Jaipur", "Acrylic Printing Machine", "₹15,00,000"],
  ["Blue Printline", "Faridabad", "Deluxe Model Printing Machine", "₹50,000"],
  ["Mehta Hitech Industries Limited", "Ahmedabad", "Solvent Printing Machine", "₹12,25,000"],
  ["G B Tech India", "New Delhi", "MRP/EXP Date Punch Machine", "₹2,650"],
  ["Meditek Printing Solutions", "New Delhi", "Duster Printing Machine", "₹1,25,000"],
  ["Omega Weldrod Systems", "Coimbatore", "Electrode Printing Machine", "₹1,00,000"],
  ["True Colors Solutions & Technologies", "New Delhi", "Printing Machine Electric Switch Board", "₹12,50,000"],
  ["Matrix Solutions", "Thane", "Tube Printing Machine", "₹26,000"],
  ["Macart Equipments Private Limited", "Pune", "Toy Printing Machines", "₹17,50,000"],
  ["Trilok Lasers", "Pune", "Printing Machine", "₹17,00,000"],
  ["Taniya Machinery Private Limited", "Faridabad", "Mild Steel Pen Printing Machine", "₹2,45,000"],
  ["Mahi Systems Private Limited", "Vadodara", "Large Format Inkjet Printer", "₹2,50,000"],
  ["Panse Lasers", "Pune", "Single Pass Printing Machine", "₹20,00,000"],
  ["J. D. Engineers", "Kheda", "Polar Printing Machine", "₹20,00,000"],
  ["Jayoma Industries", "Ahmedabad", "Strike Off Printing Machine", "₹4,27,000"],
  ["Creaseline Technologies", "Coimbatore", "Plywood Printing Machine", "₹4,75,000"],
  ["ADVANCED INDUSTRIAL MICRO SYSTEMS", "Mumbai", "HDPE Printing Machine", "₹79,000"],
  ["Friends Engineering Co.", "Amritsar", "Foil & Leaf Printing Machine", "₹1,25,000"],
  ["Moksha Engineering Works", "Ahmedabad", "Relam Delam Printing Machine", "₹80,00,000"],
  ["Shamasha India", "Faridabad", "Vacuum Printing Machine", "₹75,000"],
];

const PACKAGING_MACHINERY: Listing[] = [
  ["Sigma Instrumentation", "Ahmedabad", "Putty Packing Machine", "₹3,30,000"],
  ["Krishna Engineering Works", "Ahmedabad", "Semi-Automatic Rewinder Unwinder Machine", "₹8,00,000"],
  ["Shabbir Packaging Industries", "Vadodara", "Semi Automatic Saunf Packing Machine", "₹85,552"],
  ["Royal Inks & Equipments Private Limited", "Nashik", "Automatic Liquid Pouch Packing Machine", "₹1,38,000"],
  ["Aarzoo Engineering Works", "Noida", "Multi Head Packing Machine", "₹11,99,999"],
  ["Purusharth Packaging", "Rajkot", "Bakery Cream Roll Packing Machine", "₹38,500"],
  ["Pack Maker Machines Private Limited", "Rajkot", "Automatic Powder Packing Machine", "₹5,81,000"],
  ["Genius Engineering & Solutions", "Faridabad", "Gutkha Packing Machine", "₹1,45,000"],
  ["Imatics", "Chennai", "Ribbon Packing Machine, Automation Grade: Automatic", "₹17,00,000"],
  ["Suthar Pack Tech", "Faridabad", "Tomato Ketchup Packing Machine", "₹18,00,000"],
  ["For Bro Engineers", "Mumbai", "Semi-Automatic Milk Powder Packing Machine", "₹1,95,000"],
  ["Fitpack (A Brand Surendra Kumar & Co.)", "Jaipur", "Automatic Pouch Packing Machine with Multi Head", "₹11,00,000"],
  ["Shree Ram Packaging", "Faridabad", "Fully Automatic Red Chilli Powder Packing Machine", "₹3,50,000"],
  ["Mahalaxmi Machines", "Jaipur", "Semi Automatic Packaging Machine", "₹1,50,000"],
  ["Xsoni Systems Private Limited", "Greater Noida", "Garment Packing Machine", "₹75,000"],
  ["Aaditya Mechatronics LLP", "Noida", "Packaging Machine", "₹14,00,000"],
  ["Uniform Pack Private Limited", "Faridabad", "Packaging Machine", "₹4,50,000"],
  ["Micro Engineering Works", "Kanpur", "Automatic SS Pouch Packaging Machines", "₹85,000"],
  ["Proveg Engineering & Food Processing Private Limited", "Pune", "Automatic Spice Packaging Machine", "₹5,00,000"],
  ["Koyka Electronics Private Limited", "Faridabad", "Automatic Packaging Machine", "₹2,00,000"],
  ["Rising Industries", "Kolkata", "Automatic Powder Packing Machine", "₹1,36,000"],
  ["K P Automations", "Noida", "Collar Type Packing Machine", "₹5,50,000"],
  ["Swastik Industries", "Pune", "Shampoo Pouch Filling Machine", "₹2,54,999"],
  ["S N Enterprise", "Ahmedabad", "Automatic Sing Packing Machine", "₹1,35,000"],
  ["Shahiva Packing Machines", "Faridabad", "FFS Liquid Pouch Packing Machine", "₹1,50,000"],
  ["I P K Packaging India Private Limited", "Coimbatore", "Automatic Chips Packing Machine", "₹7,65,000"],
  ["Sunpack Solutions Private Limited", "Faridabad", "Automatic Packing Machines", "₹8,50,000"],
  ["A One Technology", "Raipur", "Automatic Namkeen Packing Machine", "₹2,30,000"],
];

const WELDING: Listing[] = [
  ["Nunes Instruments", "Coimbatore", "Automatic Welding Machine", "₹63,700"],
  ["Jupiter World Trade", "Rajkot", "Welding Machine, 350 Amp", "₹18,500"],
  ["H.P.Singh & Co.", "Kolkata", "Jasic Arc 400 Welding Machine", "₹42,000"],
  ["Rajlaxmi Electricals Private Limited", "Rajkot", "MMA 200 Welding Machine", "₹7,700"],
  ["Jayendra Sales Corporation", "Ahmedabad", "Accurate Regulator Welding Machine, 400 Amp", "₹29,000"],
  ["Krishna Welding House", "New Delhi", "Arc Welding Machine, 250 Amp", "₹9,000"],
  ["Cruxweld Industrial Equipments Private Limited", "Faridabad", "Arc Welding Machine, 400 Amp", "₹30,500"],
  ["Vigor Sales Corporation", "New Delhi", "Vigor MZ 1250 Welding Machine", "₹4,50,000"],
  ["Eastman Cast & Forge Limited", "Ludhiana", "Welding Set Machine, 20-200 A", "₹7,398"],
  ["Kismat Machines India Private Limited", "Pune", "Arc Yuva 350D Welding Machine", "₹22,365"],
  ["Vatsa Enterprises", "Agra", "Ultra Thin Plate Cold Welding Machine", "₹70,800"],
  ["Avesta Exports", "Ahmedabad", "Automatic Intelligent Welder Series", "₹2,00,000"],
  ["Taj Enterprises", "Pune", "Mild Steel Spot Welding Machine, 15KVA", "₹60,000"],
  ["Zenith Engineering Corporation", "Waghodia", "3 Phase Three Head Welding Machine", "₹5,50,000"],
  ["Mahad Infrastructure Private Limited", "Mumbai", "Roofing Membrane Welding Machine", "₹4,35,000"],
  ["Swan Machine Tools Private Limited", "Ahmedabad", "Arc Welding Machine, 400 Amp", "₹16,500"],
  ["Adinath Equipments Private Limited", "Ahmedabad", "Classic 200 Welding Machine", "₹7,500"],
  ["Amrit Enterprise", "Kolkata", "MIG Welding Machine, 400A", "₹69,000"],
  ["Cross Marketing", "Kolkata", "Ship Hull Automatic Welding Machine", "₹2,95,000"],
  ["Weld Zone", "Hyderabad", "Pendulum Weave Welding Machine", "₹1,50,000"],
  ["Electroweld Industries", "Mumbai", "Rocker Arm Type Spot Welding Machine", "₹37,999"],
  ["Smart Solutions", "New Delhi", "Single Head Welding Machine", "₹1,65,000"],
  ["D. H. Enterprises", "Ghaziabad", "Double Holder Welding Machine, 600 Amp", "₹58,800"],
  ["ARC Welding Company", "New Delhi", "ESAB Welding Machines, 30-250A", "₹27,500"],
  ["Velocity Engineers Private Limited", "New Delhi", "Cold Welding Machine, For Industrial", "₹44,000"],
  ["Siddhi Vinayak Enterprise", "Ahmedabad", "Weltronix Arc Welding Machine, Mini 200", "₹5,000"],
  ["Segatech Machines", "Ghaziabad", "Single Head Welding Machine", "₹1,70,000"],
  ["Kapoor & Sons", "Ludhiana", "Scaffolding Ledger Welding SPM", "₹70,000"],
];

const CUTTING: Listing[] = [
  ["Multicut Machine Tools", "Vadodara", "30HP Metal Cutting Machine, Fully Automatic", "₹6,00,000"],
  ["Aaradhana Machineries Private Limited", "Kanaipur", "Metal Cutting Machine", "₹32,00,000"],
  ["A Innovative International Ltd.", "Bavla", "Fiber Laser Metal Cutting Machine", "₹32,00,000"],
  ["Success Technologies", "Ahmedabad", "CNC Fiber Laser Metal Cutting Machine", "₹24,99,999"],
  ["Tara Mechcons Pvt. Ltd.", "Vadodara", "Metal Cut Off Machine, 14 inch", "₹42,000"],
  ["Flexitech Industries", "Ahmedabad", "Hexo Cutting Machine", "₹1,25,000"],
  ["H P Singh Machinery Pvt. Ltd.", "Ludhiana", "Channel Cutting Machines", "₹2,70,000"],
  ["A.S.I.Sales Private Limited", "New Delhi", "Metallographic Sample Cutting Machine", "₹3,10,000"],
  ["Rudraksh Engineering", "Rajkot", "Mild Steel Metal Cutting Machine", "₹50,000"],
  ["Ashapura Industries", "Ahmedabad", "Copper Brass Scalping Machine", "₹8,50,000"],
  ["Hydro Power Tech Engineering", "Rajkot", "CNC Angle Punching, Cutting & Marking Line", "₹1,10,00,000"],
  ["Bhavya Machine Tools LLP", "Ahmedabad", "Non Ferrous Metal Cutting Machine, 12 inch", "₹4,95,000"],
  ["MS Radix Impex Solutions", "Ahmedabad", "Metal Cutting Machine, Semi Automatic", "₹1,50,000"],
  ["Shabbir Packaging Industries", "Vadodara", "Metal Strip Cutter", "₹3,552"],
  ["Taheri Enterprises", "Mumbai", "Metal Cutting Machine", "₹8,750"],
  ["Mehta Hitech Industries Limited", "Ahmedabad", "Sheet Metal Cutting Machine, Fully Automatic", "₹26,00,000"],
  ["Deswam Engineering Solutions", "Pune", "63 Ton Automatic Metal Sheet Bending Machine", "₹14,00,000"],
  ["Chirag International", "New Delhi", "Sheet Metal Laser Cutting Machine", "₹30,00,000"],
  ["O P S Udyog", "Batala", "Metal Cutting and Punching Machine", "₹1,25,000"],
  ["Jayshree Engineering Co.", "Rajkot", "Metal Cutting Machines", "₹5,80,000"],
  ["Balaji Engineering Works", "Ahmedabad", "Bale Cutting Machine", "₹9,50,000"],
  ["Metlab Equipments And Engineering Systems", "Ahmedabad", "Metal Cutting Machine", "₹1,45,000"],
  ["D. H. Enterprises", "Ghaziabad", "Metal Cutting Machines", "₹23,80,000"],
  ["Sanseiko Laser Enterprises Private Limited", "Saharanpur", "Fiber Cutting Machine, Automatic", "₹25,00,000"],
  ["Jeet Machine Tools Corporation", "New Delhi", "Metal Cutting Machine", "₹85,000"],
  ["Star Engineers", "Pune", "Metal Cutting Machines", "₹17,30,000"],
  ["Sigma Mechotronics Private Limited", "Ahmedabad", "Fiber Laser Metal Cutting Machine", "₹21,51,000"],
];

const MIXING: Listing[] = [
  ["Pratham Engineering", "Thane", "Powder Mixing Equipment", "₹8,60,000"],
  ["Shritara Engg & Project Consultants", "Mumbai", "Stainless Steel Mixing Equipment", "₹25,000"],
  ["Dairy Man Engineering", "Coimbatore", "SS 304 Powder Mixing Machine, For Milk", "₹1,99,000"],
  ["Noble Procetech Engineers", "Nashik", "Hollow Shaft Motorized Mixer", "₹90,400"],
  ["Magna Tronix", "Chennai", "Paddle Mixer Machine", "₹2,50,000"],
  ["Mini Max Dosing Pumps", "Nashik", "Automatic SS/MS Chemical Mixer Machine", "₹28,000"],
  ["Keshav Engineering", "Surat", "Stainless Steel Mixing And Blending Equipment", "₹60,000"],
  ["PRAKASH INDUSTRIES", "Thane", "Shear Plough Mixer", "₹10,00,000"],
  ["Jas Enterprise", "Ahmedabad", "Stainless Steel Mixing Equipment", "₹25,000"],
  ["Sneha Food Equipments", "Ahmedabad", "Chavana Mixture Machine, 2HP", "₹85,000"],
  ["Aksar Food Machine LLP", "Wadhwan", "Stainless Steel Besan Mixing Machine", "₹2,00,000"],
  ["Aaspa Equipment Private Limited", "Ahmedabad", "Compact Concrete Mixing Equipment", "₹48,00,000"],
  ["Elizon India Private Limited", "New Delhi", "Stainless Steel Detergent Mixing Equipment, 50 Kg", "₹70,000"],
  ["Grace Food Processing & Packaging Machinery", "New Delhi", "Slurry Mixing Tank Kettle", "₹3,25,000"],
  ["Varahi Industries", "Ahmedabad", "Stainless Steel Mixing Equipment (Ribbon Blender)", "₹2,10,000"],
  ["JP Sons Engineering", "Ahmedabad", "Liquid Mixing Equipment", "₹34,999"],
  ["M/S. Sanjivan Industries", "Mumbai", "Paste Mixing Boiling Machine", "₹2,85,000"],
  ["Shree Krishna Enterprise", "Ahmedabad", "Detergent Soap Sigma Mixer Machine", "₹1,90,000"],
  ["Fluid Mixing Technologies", "Pune", "Mixing And Blending Equipment", "₹1,50,000"],
  ["Hovert Machines And Furnaces Private Limited", "Kanpur", "Oxide Mixing Machine", "₹50,00,000"],
  ["SS Engineers & Consultants", "Rajahmundry", "Stainless Steel Sauce Mixing And Holding System", "₹4,50,000"],
  ["Adinath Equipments Private Limited", "Ahmedabad", "Mobile Mixing Station", "₹60,000"],
  ["Sungrow Enterprises", "Ahmedabad", "Stainless Steel Mixing Equipment", "₹2,80,000"],
  ["Microtech Engineering", "New Delhi", "ECG Gel Mixing Machine", "₹3,65,350"],
  ["Soham Industrial Machinery Limited", "Surat", "Mixing Machine, 100 KG SS", "₹3,00,000"],
  ["Viasell Consultancy Services", "Pune", "Proportional Dosing Pump Coolant Mixing Systems", "₹99,999"],
  ["Sahyog Enterprise", "Mumbai", "Sanitizer Mixing Machine", "₹55,000"],
];

const PROCESS: Listing[] = [
  ["Shalin Composites (India) Private Limited", "Palghar", "FRVE Pressure Vessel Tank, 100 Psi", "₹30,000"],
  ["S S Engineering", "Thane", "Stainless Steel Pressure Vessel", "₹1,00,000"],
  ["Hydroflex Fluid Solutions LLP", "Pune", "Stainless Steel Pressure Tank", "₹38,000"],
  ["Karadani Engineering Private Limited", "Ahmedabad", "Reactor Pressure Vessel", "₹9,15,000"],
  ["Hexamide Agrotech Incorporation", "Khopoli", "Stainless Steel Pressure Vessels", "₹1,90,000"],
  ["Leela Pharma Machineries", "Vasai", "Stainless Steel Pressure Vessels", "₹55,000"],
  ["WTE Infra Projects Private Limited", "Pune", "Mild Steel ASME U Stamp Pressure Vessels", "₹25,000"],
  ["PM Industries And Process Equipments Private Limited", "Pune", "Mild Steel Low Pressure Vessels", "₹1,00,000"],
  ["Keshav Engineering", "Surat", "Mild Steel SS Pressure Vessel", "₹90,000"],
  ["Kiah Metallurgical Indian Exporters", "Mumbai", "Non Stirred Pressure Vessels", "₹25,000"],
  ["VN Aquatech", "Mumbai", "MS White Pressure Vessel Tank", "₹4,500"],
  ["Rachanashakti Fabtech Private Limited", "Ahmedabad", "Mild Steel Pressure Vessel Tank, 1000 L", "₹1,10,000"],
  ["Molsieve Designs Limited", "Palwal", "Stainless Steel Gas Pressure Vessel", "₹1,00,000"],
  ["Shanti Boilers & Pressure Vessels Pvt. Ltd.", "Hyderabad", "Carbon Steel Pressure Vessels, 10000 L", "₹3,00,000"],
  ["Shree Balaji Engineering Works", "Jaipur", "Industrial Pressure Vessel", "₹1,00,000"],
  ["Vikrama Innovative Technologies", "Hyderabad", "Industrial Pressure Vessel", "₹5,00,000"],
  ["D3S Engineering And Projects Private Limited", "Noida", "Mild Steel Storage Tank Pressure Vessels", "₹18,20,000"],
  ["Aror Engineers", "Pune", "High Pressure Vessels", "₹3,50,000"],
  ["Spark Engineers", "Pune", "Vertical MS High Pressure Vessels", "₹3,00,000"],
  ["Trenowatt Vacuum Equipments Private Limited", "Pune", "5000 L Pressure Vessel Tank", "₹10,00,000"],
  ["Creative Metal Industries", "Vadodara", "Pressure Vessel Tank, 10000 L", "₹2,50,000"],
  ["Maharsh Metal Heat Treatment", "Ahmedabad", "FRP Pressure Vessel Tank, 1000 L", "₹25,000"],
  ["MSM Process Solutions Private Limited", "Pune", "Stainless Steel Heavy Duty Pressure Vessel", "₹3,00,000"],
  ["United Engineers And Consultants", "Pune", "High-Rated Flow / Functional Vessels", "₹1,50,000"],
  ["Puregas Carbonics (India) Projects And Engg", "Vadodara", "Stainless Steel Pressure Vessel Tank, 10000 L", "₹3,50,000"],
  ["Aqua Solutions", "Mumbai", "Vertical FRP Air Pressure Vessel, 250 L", "₹4,000"],
  ["DSB Engineering", "Pune", "500L Stainless Steel Pressure Vessel", "₹3,00,000"],
  ["Bombay Engineering Works", "Mumbai", "Stainless Steel Pressure Vessel & Filling Vessel", "₹75,000"],
];

const ALL_SUBCATEGORIES: { key: keyof typeof SOURCES; entries: Listing[] }[] = [
  { key: "general", entries: GENERAL },
  { key: "materialHandling", entries: MATERIAL_HANDLING },
  { key: "automation", entries: AUTOMATION },
  { key: "pumps", entries: PUMPS },
  { key: "compressors", entries: COMPRESSORS },
  { key: "generators", entries: GENERATORS },
  { key: "hydraulic", entries: HYDRAULIC },
  { key: "pneumatic", entries: PNEUMATIC },
  { key: "machineTools", entries: MACHINE_TOOLS },
  { key: "metalworking", entries: METALWORKING },
  { key: "plastic", entries: PLASTIC },
  { key: "food", entries: FOOD },
  { key: "textile", entries: TEXTILE },
  { key: "printing", entries: PRINTING },
  { key: "packagingMachinery", entries: PACKAGING_MACHINERY },
  { key: "welding", entries: WELDING },
  { key: "cutting", entries: CUTTING },
  { key: "mixing", entries: MIXING },
  { key: "process", entries: PROCESS },
];

// ---------------------------------------------------------------------
// Build one raw record per (company, subcategory) appearance — each
// carries its own accurate source (that subcategory page's URL/name).
// Cross-subcategory merging (the same real company appearing under, say,
// both "Pumps" and "Compressors") happens AFTER normalization, below,
// so the final record keeps every source it's genuinely backed by.
// ---------------------------------------------------------------------
function rawRecordsForSubcategory(key: keyof typeof SOURCES, entries: Listing[]): RawSupplierRecord[] {
  const { subcategory, url, sourceName } = SOURCES[key];

  return entries.map(([companyName, city, product, price]) => {
    const fields = [
      "identity.companyName",
      "identity.location",
      "capabilities.categories",
      "capabilities.products",
    ];
    if (price) fields.push("commercial.priceRange");

    return {
      companyName,
      location: locationFor(city),
      categories: ["Industrial machinery", subcategory],
      products: [product],
      priceRange: price ? `${price} (indicative, for: ${product})` : undefined,
      source: {
        url,
        sourceName,
        sourceType: "public_directory",
        fields,
        snippet: `Listed on IndiaMART's ${subcategory} category page (retrieved ${RETRIEVED_AT_NOTE}).`,
      },
    } satisfies RawSupplierRecord;
  });
}

// Merge two normalized Supplier records confirmed to be the same real
// company (same normalized name), combining sources/categories/products —
// the same pattern used in scripts/import-packaging-batch.ts and
// scripts/import-office-furniture-batch.ts, generalized here to fold in
// as many same-company appearances as actually occur (a company can
// legitimately show up under several real machinery subcategories).
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
  // Id block reserved for this file: 2000-2999 (see lib/supplier-store.ts).
  let existingIds: number[] = [1999];
  const rawNormalized: Supplier[] = [];
  let totalRawListings = 0;

  const bySubcategoryCount: Record<string, number> = {};

  for (const { key, entries } of ALL_SUBCATEGORIES) {
    totalRawListings += entries.length;
    bySubcategoryCount[SOURCES[key].subcategory] = entries.length;
    for (const raw of rawRecordsForSubcategory(key, entries)) {
      const supplier = normalizeSupplierRecord(raw, existingIds);
      existingIds = [...existingIds, supplier.id];
      rawNormalized.push(supplier);
    }
  }

  const { merged: suppliers, mergeCount } = mergeSameCompanyAcrossSubcategories(rawNormalized);

  const candidates = findPotentialDuplicates(suppliers);

  console.log(`Total raw listings across ${ALL_SUBCATEGORIES.length} subcategory pages: ${totalRawListings}`);
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
  const bySubcategory = new Map<string, number>();
  let withWebsite = 0;
  let withProducts = 0;
  let withPricing = 0;
  let withMoq = 0;
  let withLeadTime = 0;
  let withCertifications = 0;

  for (const s of suppliers) {
    byConfidence[s.intelligence.dataConfidence]++;
    const state = s.identity.location.split(",").pop()?.trim() || "Unspecified";
    byState.set(state, (byState.get(state) ?? 0) + 1);
    for (const cat of s.capabilities.categories) {
      if (cat === "Industrial machinery") continue;
      bySubcategory.set(cat, (bySubcategory.get(cat) ?? 0) + 1);
    }
    if (s.identity.website) withWebsite++;
    if (s.capabilities.products.length > 0) withProducts++;
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
  console.log(`With pricing data: ${withPricing}`);
  console.log(`With MOQ: ${withMoq}`);
  console.log(`With lead time: ${withLeadTime}`);
  console.log(`With certifications: ${withCertifications}`);
  console.log("Geographic distribution (by state):");
  for (const [state, count] of Array.from(byState.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${state}: ${count}`);
  }
  console.log("Subcategory distribution (a supplier can count in more than one):");
  for (const [cat, count] of Array.from(bySubcategory.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  const dataFile = path.join(process.cwd(), "data", "suppliers", "industrial-machinery.json");
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ suppliers }, null, 2), "utf-8");

  console.log(`\nWrote ${suppliers.length} suppliers to ${dataFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
