// Ingestion run: Office Furniture supplier batch (India-wide), the first
// category batch of the 14-category supplier database expansion. Every
// record here traces to a real, fetched public source (see SOURCES below).
// Writes to data/suppliers/office-furniture.json — a SEPARATE file from the
// legacy data/suppliers.json packaging batch, combined transparently at
// read time by lib/supplier-store.ts. Ids for this file are drawn from the
// 1000-1999 block reserved for office-furniture (see the comment in
// lib/supplier-store.ts) so they never collide with the legacy file or any
// other category's file.
//
// Run with: npx tsx scripts/import-office-furniture-batch.ts
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
// 1. IndiaMART directory — the "Office Furniture" category page, fetched
//    both as the pan-India aggregate (impcat) and as nine individual city
//    pages (New Delhi/NCR, Mumbai, Bengaluru, Chennai, Pune, Ahmedabad,
//    Kolkata, Hyderabad). Fetched 2026-09-08. Each listing gives: company
//    name, the city IndiaMART shows for that listing, one product name,
//    and (for most listings) one indicative per-unit/per-sq-ft price for
//    that single product. This is NOT a general price range for the
//    company's full catalog, so it is recorded as an indicative price for
//    the named product only — never generalized into an MOQ or full price
//    range, neither of which this source provides.
const INDIAMART_SOURCE_NAME = "IndiaMART — Office Furniture directory";
const INDIAMART_NATIONAL_URL =
  "https://m.indiamart.com/impcat/officeworkfurniture.html";

const CITY_URLS: Record<string, string> = {
  National: INDIAMART_NATIONAL_URL,
  "New Delhi": "https://m.indiamart.com/city/delhi/officeworkfurniture.html",
  Mumbai: "https://m.indiamart.com/city/mumbai/officeworkfurniture.html",
  Bengaluru: "https://m.indiamart.com/city/bengaluru/officeworkfurniture.html",
  Chennai: "https://m.indiamart.com/city/chennai/officeworkfurniture.html",
  Pune: "https://m.indiamart.com/city/pune/officeworkfurniture.html",
  Ahmedabad: "https://m.indiamart.com/city/ahmedabad/officeworkfurniture.html",
  Kolkata: "https://m.indiamart.com/city/kolkata/officeworkfurniture.html",
  Hyderabad: "https://m.indiamart.com/city/hyderabad/officeworkfurniture.html",
};

// 2. AFMT — Association of Furniture Manufacturers & Traders (India) —
//    public members directory. Fetched 2026-09-08. Gives: company name,
//    city/state (for most members). AFMT covers furniture broadly (office,
//    residential, modular kitchens, etc.), so — unlike the city IndiaMART
//    pages, which are already scoped to "office furniture" — a member is
//    only pulled into THIS batch when its own listed name explicitly
//    signals an office/commercial-seating line (contains "office",
//    "seating", "chair", "workstation", "ergo", or "modular" in a clearly
//    office-furniture context). General furniture/interiors/kitchen AFMT
//    members with no such signal are deliberately left out of this batch
//    rather than assumed to be office-furniture suppliers.
const AFMT_URL = "https://afmtindia.com/members.html";
const AFMT_NAME =
  "Association of Furniture Manufacturers & Traders (India) — Members Directory";

const STATE_BY_CITY: Record<string, string> = {
  "New Delhi": "Delhi",
  Delhi: "Delhi",
  Gurugram: "Haryana",
  Gurgaon: "Haryana",
  Noida: "Uttar Pradesh",
  Faridabad: "Haryana",
  Ghaziabad: "Uttar Pradesh",
  Manesar: "Haryana",
  Chandigarh: "Chandigarh",
  Jaipur: "Rajasthan",
  Mumbai: "Maharashtra",
  "Mumbai City": "Maharashtra",
  "Navi Mumbai": "Maharashtra",
  Pune: "Maharashtra",
  Nagpur: "Maharashtra",
  Bengaluru: "Karnataka",
  Chennai: "Tamil Nadu",
  Vellore: "Tamil Nadu",
  Ahmedabad: "Gujarat",
  Vadodara: "Gujarat",
  Surat: "Gujarat",
  Rajkot: "Gujarat",
  Anand: "Gujarat",
  Jamnagar: "Gujarat",
  Kolkata: "West Bengal",
  Hyderabad: "Telangana",
  Meerut: "Uttar Pradesh",
  Lucknow: "Uttar Pradesh",
  Indore: "Madhya Pradesh",
  Gwalior: "Madhya Pradesh",
  Thane: "Maharashtra",
  Nashik: "Maharashtra",
  Solapur: "Maharashtra",
  Kolhapur: "Maharashtra",
  Satara: "Maharashtra",
  Ludhiana: "Punjab",
  Junnar: "Maharashtra",
  "Bangalore Rural District": "Karnataka",
};

function locationFor(city: string): string {
  const state = STATE_BY_CITY[city];
  // AFMT's own directory labels a few entries with district-style names
  // ("Mumbai City", "Bangalore Rural District") rather than the plain city
  // name IndiaMART uses — clean those for display without changing what
  // state they map to.
  const displayCity = city.replace(/ City$/, "").replace(/ Rural District$/, "");
  return state ? `${displayCity}, ${state}` : city;
}

// ---------------------------------------------------------------------
// RAW LISTINGS — IndiaMART, "Office Furniture" category
// ---------------------------------------------------------------------
// [companyName, city, product, price-or-null]. `price` is exactly what
// IndiaMART showed for that one listing (may be absent — recorded
// verbatim, not backfilled).
type Listing = [string, string, string, string | null];

const NATIONAL: Listing[] = [
  ["Prime Equipments And Supplies India Private Limited", "Mumbai", "Manager Cabin Furniture", "₹60,263/Piece"],
  ["Opcieas", "Bengaluru", "Brown Office Table And Chair Set", null],
  ["New Golden Furnishers Co.", "New Delhi", "Examination Lab Computer Lab Furniture", null],
  ["Spark International", "New Delhi", "BLACK Metal Office Steel Almirah", null],
  ["S Comfort Seating Systems", "Pune", "4 Seater Wood, SS Office Cubicle Workstation", "₹22,500/Piece"],
  ["Sapphire Interior Solutions Pvt. Ltd.", "Manesar", "Classic- 11 Wooden Desk", "₹45,000/Piece"],
  ["Shyam Ji Trading Company", "Chandigarh", "Oval Laminated Board Office Conference Table", null],
  ["SRK Modular Furniture Co.", "Jaipur", "Wooden Office Furniture", null],
  ["Decor-X Interior Private Limited", "Kolkata", "Rectangular 8 Seater Conference Meeting Table", "₹14,750/Piece"],
  ["Universal Home Decor Private Limited", "Ahmedabad", "Executive Office Furniture", "₹1,900/Square Feet"],
  ["Vlite Furnitech LLP", "Mumbai", "Particle Board Wooden Computer Table", "₹14,500/Piece"],
  ["Delite Hi-Tech Furniture Industries Private Limited", "New Delhi", "Teak Wood Rectangular Office Table", null],
  ["Kapoor Furnishers", "Faridabad", "6 Seater Office Modular Furniture", null],
  ["Sai Fab Engineers & Co.", "Faridabad", "Multicolor Executive Office Furniture", null],
  ["Gurudas Crafts", "Ghaziabad", "Office Furniture", null],
  ["Poly World Furniture", "Nagpur", "High Back Executive Chair", null],
  ["DS Door (India) Limited", "Faridabad", "Furniture For Office", null],
  ["Saptarishi Furnitures", "Vadodara", "Rectangular 8 Brown Conference Room Table", null],
  ["Nicewood Furniture LLP", "Ahmedabad", "Workstation Legs", "₹2,550/Piece"],
  ["Delhi Tirpal House", "New Delhi", "Office Furniture", null],
  ["Aone Office Systems", "New Delhi", "Modular Office Workstation", null],
  ["Vardhmaan Enterprise", "Mumbai", "Office Furniture", "₹850/sq ft"],
  ["Nidhi Enterprises", "Bengaluru", "Office Furniture", "₹900/sq ft"],
  ["AJ Enterprises", "New Delhi", "Office Furniture", null],
  ["Kalacrea Co.", "Meerut", "Workstation Office Furniture Manufacturer", null],
  ["Samt Fixture And Furniture Private Limited", "New Delhi", "Brown Plywood Wooden Office Furniture", null],
  ["NU Track Industries", "Ahmedabad", "Single Seater Plywood Modular Office Furniture", null],
  ["Rolex Furniture", "Mumbai", "Office Modular Furniture", "₹14,000/Piece"],
];

const DELHI: Listing[] = [
  ["New Golden Furnishers Co.", "New Delhi", "Trends Wooden Ply Examination Lab Computer Lab Furniture", null],
  ["ASP Modulars & Interiors", "New Delhi", "Wood Modular Workstations", null],
  ["R Origin Private Limited", "Gurugram", "Open Modular Workstation", null],
  ["JDB Engineers Works", "Noida", "Office Furniture (Reception Desk)", null],
  ["Spark International", "New Delhi", "BLACK Metal Office Steel Almirah, Size: 900X475X1980", null],
  ["Asian Office Furniture", "New Delhi", "Modern Modular Office Furniture", "₹17,500/Piece"],
  ["Radiant Electrical Enterprises", "New Delhi", "50 Inch Modular Office Workstation", null],
  ["Pioneer Furniture Company", "New Delhi", "Director & Chairman Chair, Warranty: 3 Years", null],
  ["NU Track Industries", "Delhi", "Grey Mild Steel Office File Cabinet", null],
  ["Creative Office Systems", "Noida", "Wooden Office Workstation", null],
  ["ABP Moduler Furniture Private Limited", "Gurgaon", "Wooden Storage Cabinet", null],
  ["Basant Sales Pvt. Ltd.", "Gurugram", "Office Executive Chair", null],
  ["Sapphire Interior Solutions Pvt. Ltd.", "Manesar", "Classic- 11 Wooden Desk, 1 Year, Brown", null],
  ["G M Enterprises", "New Delhi", "White Polished Modular Office Workstation", null],
  ["Aone Office Systems", "New Delhi", "Modular Office Workstation", null],
  ["Kain Store", "New Delhi", "White computer table", null],
  ["D.K. Modular Contractor", "New Delhi", "White And Green Particle Board 2 Seater Office Workstation", null],
  ["Amulya Interio", "New Delhi", "Modular Office Furniture", null],
  ["Creature Comforts", "New Delhi", "3 Seater Black Office Sofa Set, Shape: U Shape", null],
  ["Durgashani Enterprises", "New Delhi", "Office Furniture (Office Table)", null],
  ["U 3 Office Solution", "New Delhi", "File Cabinets", null],
  ["Moss interior solutions", "New Delhi", "Particle Board 4 Seater Office Table", null],
  ["Lisa India Enterprises", "New Delhi", "Office Furniture (Office Table)", null],
  ["New Capital Office Solutions", "New Delhi", "White 12 Seater Modular Office Furniture", null],
  ["Corporate Biz Systems", "New Delhi", "Modular Office Furniture", null],
  ["Modern Interior Studio", "New Delhi", "Office Furniture (Workstation)", null],
  ["Tanvi Enterprises", "New Delhi", "Wooden Single Low Back Storage, Brown", null],
  ["Royal Interior", "New Delhi", "Office Furniture (Workstation)", null],
];

const MUMBAI: Listing[] = [
  ["Vivan Enterprises Private Limited", "Mumbai", "Modular Office Furniture", "₹25,000/Piece"],
  ["Rolex Furniture", "Mumbai", "Office Modular Furniture", "₹14,000/Piece"],
  ["Sapphire Interior Solutions Pvt. Ltd.", "Mumbai", "Classic- 11 Wooden Desk, 1 Year, Brown", "₹45,000/Piece"],
  ["Asian Office Furniture", "Mumbai", "Modern Modular Office Furniture", "₹17,500/Piece"],
  ["NU Track Industries", "Mumbai", "4 Seater MS Modular Office Furniture", "₹7,500/Set"],
  ["Supreme Tradelines Private Limited", "Mumbai", "Wooden Office Tables", "₹8,000/Piece"],
  ["Speqta Interio", "Mumbai", "Modular Office Cubicle Workstation", "₹25,000/Piece"],
  ["Interiors Plus", "Mumbai", "Wooden Brown Rectangular Conference Table", "₹22,000/Piece"],
  ["Krystal Enterprises", "Mumbai", "Metal Office Table", "₹1,500/Piece"],
  ["Bharat Seating Systems (India)", "Mumbai", "Rectangular Office Furniture Table", "₹8,000/Piece"],
  ["Vlite Furnitech LLP", "Mumbai", "Particle Board Wooden Computer Table", "₹14,500/Piece"],
  ["Adityoa Enterrprises", "Mumbai", "Corporate Office Furniture", "₹12,000/unit"],
  ["Aisthetic Space Modular", "Mumbai", "Office Furniture Manufacturer In Mumbai", "₹4,800/Piece"],
  ["Hycon India", "Mumbai", "Office Revolving Stools", "₹3,200/Piece"],
  ["Vardhmaan Enterprise", "Mumbai", "Office Furniture", "₹850/sq ft"],
  ["Ruby Safe Company", "Mumbai", "Plywood Rectangular Computer Workstation Furniture", "₹7,800/Piece"],
  ["Shivam Steel Art", "Mumbai", "Wooden Practical Board Office Furniture", "₹300/Square Feet"],
  ["Santosh Interior", "Mumbai", "Wooden And Glass Brown Cash Desk Counter", "₹18,000/Piece"],
  ["Modulux Modular Kitchen And Furniture", "Mumbai", "Ergonomic Office Furniture", "₹8,500/Piece"],
  ["Magnek Associates", "Mumbai", "White Office Workstation Furniture, Seating Capacity: 3 Seater", "₹6,000/Piece"],
  ["Hemangi Interior", "Mumbai", "Wooden Conference Table (Seats 10-12)", "₹18,500/Piece"],
  ["Ergosoul", "Mumbai", "Metal Star Lounge Chair", "₹5,500/Piece"],
  ["Klass Interiors", "Mumbai", "Office Furniture", "₹16,500/Piece"],
  ["Steel Craft", "Mumbai", "Office Furniture", "₹499/sq ft"],
  ["Anand Furniture & Interiors", "Mumbai", "Particle Board Office Furniture", null],
  ["Stepearly Private Limited", "Mumbai", "Mesh Flair Office Chair", "₹12,250/Piece"],
  ["Arihant Enterprise", "Mumbai", "Back Rest Fabric", "₹180/Piece"],
];

const BENGALURU: Listing[] = [
  ["Wintech Corporate Solutions", "Bengaluru", "Desk Type Symphony Glassy Workstation", "₹5,600/Piece"],
  ["Brand World India", "Bengaluru", "Black Bwi Revolving Mesh Chair, For Office", "₹3,600/Piece"],
  ["Well Designs Engineering", "Bengaluru", "Office Furniture (Office Table)", "₹6,500/Piece"],
  ["Smart Desk", "Bengaluru", "Conference Table", "₹37,510/Piece"],
  ["Rolex Furniture", "Bengaluru", "Office Modular Furniture", "₹14,000/Piece"],
  ["NU Track Industries", "Bengaluru", "4 Seater MDF Modular Office Furniture", "₹460/Sq Ft"],
  ["Supreme Tradelines Private Limited", "Bengaluru", "Teak Wood Modular Office Wooden Drawer", "₹6,500/Piece"],
  ["Infinite Sales And Services", "Bengaluru", "Office Furniture In Bangalore", "₹3,200/Piece"],
  ["Kartha Industries", "Bengaluru", "Office Modular Furniture", "₹9,000/Piece"],
  ["Weltech Engineers Private Limited", "Bengaluru", "Orange,Brown Wooden Modular Work Station", "₹6,700/Piece"],
  ["Mobel Modular System", "Bengaluru", "Cubicle Work Station", "₹5,800/Piece"],
  ["Sanlax Enterprises", "Bengaluru", "Stainless Steel Rectangular Office Conference Table", "₹48,000/Piece"],
  ["BMS Interiors", "Bengaluru", "Office Cubicle Workstation", "₹16,200/Piece"],
  ["Chimney-N-Chulla", "Bengaluru", "Mesh Winner Grey MB Chair", "₹8,100/Piece"],
  ["LK Furniture World1", "Bengaluru", "Executive Revolving Office Chairs", "₹3,900/Piece"],
  ["Ashithesh Enterprises", "Bengaluru", "Reception Area Furniture", "₹15,340/Piece"],
  ["Shine Office Furniture", "Bengaluru", "Medium Back Fixed Office Chair", "₹2,200/Piece"],
  ["Interwood", "Bengaluru", "Front office furniture", "₹39,813/Piece"],
  ["Cubiclecraft", "Bengaluru", "Grey Hector High Back Office Chair", "₹7,406/Piece"],
  ["I Space Modular Systems", "Bengaluru", "Wooden Modular Office Workstation", "₹7,000/Piece"],
  ["DRS Design Private Limited", "Bengaluru", "Office Furniture Design", "₹15,000/Piece"],
  ["People Interiors & Furnitures", "Bengaluru", "Office Furniture (Metal with Wood)", "₹5,500/Piece"],
  ["Rockline Enterprises", "Bengaluru", "Office Tables And Chairs", "₹3,958/Piece"],
  ["Nidhi Enterprises", "Bengaluru", "Office Furniture (Workstation)", "₹900/sq ft"],
  ["Relish Tech Solutions", "Bengaluru", "Particle Board Office Furniture", "₹18,500/Piece"],
  ["Smaaz Furniture", "Bengaluru", "Executive Office Furniture Set", "₹14,800/Piece"],
  ["Vikash Ventures", "Bengaluru", "Revolving Chairs", "₹12,803/Piece"],
  ["Greyscale Interio", "Bengaluru", "Office Furniture", "₹4,500/Piece"],
];

const CHENNAI: Listing[] = [
  ["Corporate Concepts", "Chennai", "MD Room Table", "₹26,500/Piece"],
  ["Jap Enterprises", "Chennai", "Steel Office Rack", "₹9,000/Unit"],
  ["Diamond Industries", "Chennai", "L Shape Office Executive Table", "₹15,000/Set"],
  ["Girilak", "Chennai", "Wood Modern Office Furniture", "₹8,000/Piece"],
  ["UP Furnitures & Interiors", "Chennai", "Grey Office Storage Locker", "₹10,000/Unit"],
  ["Supreme Tradelines Private Limited", "Chennai", "Teak Wood Modular Office Drawer", "₹6,500/Piece"],
  ["Sac Systems", "Chennai", "Executive Modular Office Workstation", "₹36,000/Unit"],
  ["NU Track Industries", "Chennai", "7 Seater Plywood Modular Furniture", "₹9,200/Piece"],
  ["Laksh Enterprises", "Chennai", "Ergonomic Office Chairs", "₹2,000/Piece"],
  ["Sharon Furniture World", "Chennai", "Office Sofa (Standard)", "₹18,000/Piece"],
  ["Iyyan Decors", "Chennai", "Office Furniture Workstation", "₹5,500/Piece"],
  ["Sri Industries", "Chennai", "Modular Office Furniture", "₹5,000/Piece"],
  ["Taj Furn", "Chennai", "Office Conference Table", "₹15,000/Piece"],
  ["Hail Mary Enterprises", "Chennai", "Office Modular Furniture", "₹20,500/Piece"],
  ["Spatialinfra.Com", "Chennai", "Fonzel Metal Foldable Office Tables", "₹12,500/Piece"],
  ["Sri Venkateswara Furnitures", "Chennai", "Wooden Office Table", "₹14,900/Set"],
  ["Taj Workplace Furnitures", "Chennai", "5x3 Feet L Shape Wooden Table", "₹18,500/Piece"],
  ["Magnaa Modules Systems", "Chennai", "Wooden Modular Workstation", "₹18,500/Piece"],
  ["V R Office Needs", "Chennai", "Reception Counter Table", "₹34,000/Piece"],
  ["Smart Office Furniture Industry", "Chennai", "Modular Workstation", "₹260/sq ft"],
  ["Sri Finelook Enterprises", "Chennai", "Executive Office Furniture", "₹8,500/Piece"],
  ["Prime Office Systems", "Chennai", "Executive Medium Back Chair", "₹4,500/Piece"],
  ["Origin Office Creators", "Chennai", "Office Reception Table", "₹21,999/Piece"],
  ["Prince Furniture And Interiors", "Chennai", "Plywood Executive Table", "₹17,500/Piece"],
  ["Creative Interior Solutions", "Chennai", "4 Seater Open Desking Furniture", "₹6,500/Piece"],
  ["Grisha Enterprises", "Chennai", "Office Furniture", "₹5,500/Piece"],
  ["Xindo Window Private Limited", "Chennai", "Premium Model Office Furniture", "₹45,999/Set"],
  ["Hav'N Interiors & Global Sourcing", "Chennai", "Office Furniture", "₹80,000/Piece"],
];

const PUNE: Listing[] = [
  ["S Comfort Seating Systems", "Pune", "4 Seater Wood, SS Office Cubicle Workstation", "₹22,500/Piece"],
  ["Supreme Tradelines Private Limited", "Pune", "Teak Wood Modular Office Wooden Drawer", "₹6,500/Piece"],
  ["NU Track Industries", "Pune", "7 Seater Plywood Modular Office Furniture", "₹9,200/Piece"],
  ["Rolex Furniture", "Pune", "Office Modular Furniture", "₹14,000/Piece"],
  ["Giriraj Industries", "Pune", "Vertical Filing Cabinet", "₹13,499/Piece"],
  ["Aaesthetic Space Enterprises", "Pune", "Office Furniture Manufacturer", "₹700/Piece"],
  ["Blue Ribbon Furnishers Private Limited", "Pune", "Matte Paint Coated Modular Office Workstation", "₹14,200/Unit"],
  ["Human Ergo Furniture Solutions Private Limited", "Pune", "Modular Office Furniture Workstation", "₹8,000/Piece"],
  ["Aacord", "Pune", "Executive Conference Table", "₹35,000/Piece"],
  ["Stepearly Private Limited", "Pune", "Mesh Flair Office Chair", "₹12,250/Piece"],
  ["Credible Fitments (OPC) Private Limited", "Pune", "Office Meeting Room Furniture", "₹700/sq ft"],
  ["Metalux Space Solutions Private Limited", "Pune", "Designer Cabin Furniture", "₹90,000/Piece"],
  ["Swidoo Interics Private Limited", "Pune", "Office Furniture", "₹18,000/Piece"],
  ["Mod Men", "Pune", "Rectangular 20 Seater Conference Room Table", "₹22,000/Piece"],
  ["Grow Enterprises", "Junnar", "Office Furniture", "₹300/sq ft"],
  ["Veer Creative Design Private Limited", "Pune", "Engineered Wood Office Furniture", "₹900/sq ft"],
  ["S S Furniture", "Pune", "Wooden Plywood and Laminated Office Furniture", "₹850/Square Feet"],
  ["Metro Dynamics", "Pune", "Executive Office Table", "₹20,000/Piece"],
  ["Dzarch", "Pune", "Engineered Wood Plywood Office Furniture", "₹6,500/Piece"],
  ["Naresh Steel Corporation", "Pune", "Plywood Office Furniture", "₹8,000/Piece"],
  ["APS Interior Furnitures", "Pune", "Office furniture", "₹1,650/Piece"],
  ["Aakar Interiors", "Pune", "Office Furniture Manufacturer", "₹26,650/Piece"],
  ["Vighnaharta Industries", "Pune", "Modern Ergonomic Office Training Room Furniture", "₹11,000/Piece"],
  ["House Of Innovation", "Pune", "Office Furniture Set", "₹300/sq ft"],
  ["Shree Furniture Industry", "Pune", "Modular Office Furniture", "₹1,250/sq ft"],
  ["Durgashani Enterprises", "Pune", "Office Furniture", "₹6,000/Piece"],
  ["Krystal Enterprises", "Pune", "Mild Steel Work-Station for Office", "₹12,000/Piece"],
  ["Wedha Communication Private Limited", "Pune", "Cluster Office Workstation", "₹150/sq ft"],
];

const AHMEDABAD: Listing[] = [
  ["Craftwiz Furniture LLP", "Ahmedabad", "Modular Office Workstation", "₹5,000/Piece"],
  ["NU Track Industries", "Ahmedabad", "10 Seater Table Office Furniture", "₹5,500/Set"],
  ["Rolex Furniture", "Ahmedabad", "Office Modular Furniture", "₹14,000/Piece"],
  ["Eplast Industries LLP", "Ahmedabad", "Leather Particle Board Owner Office Furniture", "₹70,000/Set"],
  ["Space Plan Systems", "Ahmedabad", "Particle Board Office Furniture Elem Series", "₹28,000/Piece"],
  ["Panam Projects Private Limited", "Ahmedabad", "White Three Versatile Office Stool", "₹16,000/Set"],
  ["Intact Furniture & Projects", "Ahmedabad", "Engineered Wood Office Work Furniture", "₹850/sq ft"],
  ["Universal Home Decor Private Limited", "Ahmedabad", "Executive Office Furniture", "₹1,900/Square Feet"],
  ["D G Furniture", "Ahmedabad", "Office Furniture In Ahmedabad", "₹9,999/Piece"],
  ["Hina Furniture", "Ahmedabad", "Solid PLB Office Furniture", "₹4,000/Piece"],
  ["Nicewood Furniture LLP", "Ahmedabad", "Workstation Legs", "₹2,550/Piece"],
  ["Zarrah Furniture", "Ahmedabad", "Corporate Office Conference Table Furniture", "₹18,500/Piece"],
  ["Akar Interiors", "Ahmedabad", "Wood Veneer Office Table", "₹1,600/sq ft"],
  ["Pan Engineers", "Ahmedabad", "Modern Office Partition Furniture Work", "₹100/Square Feet"],
  ["Super Enterprises", "Ahmedabad", "Wood Office Furniture", "₹6,500/Piece"],
  ["Shree Vishvakarma Furniture Works", "Ahmedabad", "Revolving Chair", null],
  ["3 Vision Interior Solution", "Ahmedabad", "Office Furniture", "₹4,500/Piece"],
  ["Shreem Furniture And Interior", "Ahmedabad", "High Back Chair", null],
  ["Vinayak Plywood", "Ahmedabad", "Brown Office Chair", "₹15,000/Piece"],
  ["Sujako Interiors Pvt. Ltd.", "Ahmedabad", "Panel Based Workstations - ALIGN", null],
  ["Gujju Furniture", "Ahmedabad", "Rectangular Reception Table 4x2ft", "₹6,500/Piece"],
  ["Prayosha Furniture", "Ahmedabad", "Office Furniture", null],
  ["3j Design", "Ahmedabad", "Modular Office Furniture", null],
  ["Padmavati Furniture", "Ahmedabad", "Storage & Filings", null],
  ["Shrom Furniture", "Ahmedabad", "Wooden Executive Office Desk", null],
  ["Stylory India LLP", "Ahmedabad", "Office Reception Counter", null],
  ["Benz Furniture Private Limited", "Ahmedabad", "Discussion Chair", null],
  ["Arihant Furniture", "Ahmedabad", "Office Table", "₹2,500/Piece"],
];

const KOLKATA: Listing[] = [
  ["Decor-X Interior Private Limited", "Kolkata", "DX-CF154 Office Conference Table, Rectangular, 6 Seater", "₹14,750/Piece"],
  ["Steel Modoling Furniture", "Kolkata", "Rectangular Steel Office Table, With Storage", "₹6,000/Piece"],
  ["NU Track Industries", "Kolkata", "5 Seater Particle Board Modular Office Furniture", "₹5,500/Piece"],
  ["Ghosh Engineering & Furniture Private Limited", "Kolkata", "Wood L Shape Modular Office Furniture", "₹3,500/Square Feet"],
  ["Meghdoot Steel Furniture", "Kolkata", "Metal Office Storage Furniture", "₹15,000/Piece"],
  ["Shree Sairam Trading Co.", "Kolkata", "Brown Office Furniture Set", "₹3,200/Piece"],
  ["Epic Woodberg Systems", "Kolkata", "Revolving Mid Back Office Chair, Black", "₹7,200/Piece"],
  ["Imperia Interior", "Kolkata", "PVD Office Chair, High Back", null],
  ["New Simahin Furniture", "Kolkata", "Office Table", "₹10,000/Piece"],
  ["Decorative Collection", "Kolkata", "Net Jelly Medium Back Mesh 802, Black", "₹3,290/Piece"],
  ["Amrit Furniture", "Kolkata", "Rotatable With Armrest Office & Conference Furnitures", "₹2,400/Unit"],
  ["Ganpati Enterprise", "Kolkata", "Brown Office Interior Furniture", "₹1,251/sq ft"],
  ["Styleon Steel Furniture", "Kolkata", "Stainless Steel Fabric Office Chair", "₹4,500/Piece"],
  ["Royal Touch", "Kolkata", "Office Furniture", "₹4,500/Piece"],
  ["Raj Furnishers", "Kolkata", "Office Tables TC-660", null],
  ["Decofur", "Kolkata", "Revolving Chairs", null],
  ["Dsk Furniture", "Kolkata", "Wooden Office Furniture", "₹5,000/Piece"],
  ["Hf Furniture", "Kolkata", "Rectangular Executive Office Table, Without Storage", "₹6,000/Set"],
  ["Basanti Furniture Co.", "Kolkata", "Computer Chair", null],
  ["Dadheech Furniture Private Limited", "Kolkata", "Candid Chair", null],
  ["Softcart Retails Private Limited", "Kolkata", "Corporate Office Furniture", null],
  ["Hi Definition", "Kolkata", "Office Chair", "₹6,000/Piece"],
  ["Mani Steel Furniture", "Kolkata", "Office Furniture", null],
  ["Sampriti Furniture", "Kolkata", "Office Furniture", null],
];

const HYDERABAD: Listing[] = [
  ["Onyx", "Hyderabad", "Sunny Chair", "₹11,000/Piece"],
  ["Excel Industries", "Hyderabad", "White XLT-2015", "₹30,000/Piece"],
  ["Annapurna Interiors", "Hyderabad", "Office Furniture Workstations", "₹6,457/Piece"],
  ["Dhanalakshmi Enterprises", "Hyderabad", "Wooden Rectangular DL 256 Office Table, With Storage", "₹11,000/Piece"],
  ["N Wood Crafts", "Hyderabad", "Office Pedestal Cabinets", "₹3,850/Piece"],
  ["Pinnacle Furniture", "Hyderabad", "Polyester 1 Seater Corporate Office Chair, Black", "₹3,900/Piece"],
  ["NU Track Industries", "Hyderabad", "4 Seater MS Modular Office Furniture", "₹7,500/Set"],
  ["Supreme Tradelines Private Limited", "Hyderabad", "Wooden Office Tables", "₹8,000/Piece"],
  ["Asian Office Furniture", "Hyderabad", "Modern Modular Office Furniture", "₹17,500/Piece"],
  ["Greenwell Seating Solutions", "Hyderabad", "Computer Workstation Furniture", "₹6,500/Piece"],
  ["Modular Line Interior Factory", "Hyderabad", "Wooden Office Furniture", "₹6,500/Piece"],
  ["I4 Modulars", "Hyderabad", "Wooden 6 Seater Smart Desk Office Workstation", "₹6,500/Piece"],
  ["Vindhya Integrated Solutions", "Hyderabad", "Corporate Work Suite Furniture", "₹6,000/Piece"],
  ["BNW Enterprises", "Hyderabad", "Office Furniture 2 Seatings", "₹13,350/Piece"],
  ["Magnus Office Furniture", "Hyderabad", "Office Modular Workstation", "₹4,500/Piece"],
  ["Ritz Interior Associates", "Hyderabad", "MDF L Shaped Wooden Brown White Reception Table", "₹5,200/sq ft"],
  ["Sri Kanjani Furnitures", "Hyderabad", "Office Furniture Manufacturer", "₹25,000/Piece"],
  ["Tiruven Furniture Gallery", "Hyderabad", "Modern Brown M-348 Computer Table", "₹4,800/Piece"],
  ["Sanwariya Furniture", "Hyderabad", "Stainless Steel Visitor Chair", "₹2,200/Piece"],
  ["Sri Vaishnavi Furniture", "Hyderabad", "Moulded Office Furniture", "₹18,500/Piece"],
  ["Siva'S Interiors", "Hyderabad", "Office Furniture", "₹15,000/Piece"],
  ["Jagdamba Furnitures", "Hyderabad", "Office Furniture", "₹5,800/Piece"],
  ["Tarun Furniture", "Hyderabad", "Leather Executive Office Chair", "₹17,999/Piece"],
  ["Batcha Furnitures", "Hyderabad", "Leather Revolving Office Chair", "₹5,000/Unit"],
  ["B7 Crafting Beautiful Homes", "Hyderabad", "Office Furniture", "₹3,500/Piece"],
  ["Shree Balaji Office Systems", "Hyderabad", "Office Furniture", "₹6,500/Piece"],
  ["JK Enterprises", "Hyderabad", "All Types Of Office Furnitures", "₹3,000/Piece"],
  ["VB Modulars", "Hyderabad", "Corporate/Office Interior Designing Furniture", "₹3,500/Piece"],
];

const ALL_LISTINGS: { city: string; entries: Listing[] }[] = [
  { city: "National", entries: NATIONAL },
  { city: "New Delhi", entries: DELHI },
  { city: "Mumbai", entries: MUMBAI },
  { city: "Bengaluru", entries: BENGALURU },
  { city: "Chennai", entries: CHENNAI },
  { city: "Pune", entries: PUNE },
  { city: "Ahmedabad", entries: AHMEDABAD },
  { city: "Kolkata", entries: KOLKATA },
  { city: "Hyderabad", entries: HYDERABAD },
];

// ---------------------------------------------------------------------
// AFMT members whose own listed name signals an office/commercial-seating
// line (see the filtering rule documented above). [name, city|null]
// ---------------------------------------------------------------------
const AFMT_OFFICE_MEMBERS: [string, string | null][] = [
  ["Featherlite Office Systems Pvt. Ltd.", "Bangalore Rural District"],
  ["Dexton Seating Systems And Furniture (I) Pvt. Ltd.", "Mumbai City"],
  ["Human Method Ergonomics Private Limited", "Pune"],
  ["Ergon Seatings Pvt. Ltd.", "Ludhiana"],
  ["Indo Office Solutions Pvt. Ltd.", null],
  ["Dice Office Systems", null],
  ["Comfort Seating (Prisca)", "Kolkata"],
  ["Creative Seating Systems", "Pune"],
  ["Eurosteel Office Furniture System Pvt Ltd", "Pune"],
  ["Exclusiff Seating System", "Mumbai City"],
  ["Fabchair", "Pune"],
  ["Flexi Seating Systems Pvt Ltd", "Kolkata"],
  ["Furnitech Seating System (I) Pvt Ltd", "Pune"],
  ["Geeken Seating Collection Pvt. Ltd.", "Gurgaon"],
  ["Ira Seating World", "Mumbai City"],
  ["Keni Office Seating System Pvt Ltd", "Ahmedabad"],
  ["Maxiims Concept Chairs", "Mumbai City"],
  ["Neeman Seating Solutions Pvt Ltd", null],
  ["Obizz Office Furniture", null],
  ["Frontier Modular Designs Pvt Ltd", "Bangalore Rural District"],
];

// ---------------------------------------------------------------------
// Build raw records
// ---------------------------------------------------------------------

function priceRangeFromListing(product: string, price: string | null): string | null {
  if (!price) return null;
  return `${price} (indicative, for: ${product})`;
}

type MergedListing = {
  companyName: string;
  primaryCity: string;
  citiesServed: string[];
  products: string[];
  price: string | null;
  priceProduct: string | null;
};

// Merge listings of the SAME company appearing across multiple IndiaMART
// city pages (and/or the national aggregate) into one record — this is a
// data-collection artifact of fetching one category page per city, not
// evidence of separate companies, so counting each city hit as its own
// supplier would silently inflate the batch. First city encountered
// (National first, then the city fetch order above) is kept as the
// primary/HQ-best-guess location; every other city the same listing
// appeared under is recorded honestly as a served city, not a guess.
function mergeIndiamartListings(): MergedListing[] {
  const byKey = new Map<string, MergedListing>();

  for (const { entries } of ALL_LISTINGS) {
    for (const [companyName, city, product, price] of entries) {
      const key = normalizeCompanyName(companyName);
      const existing = byKey.get(key);

      if (!existing) {
        byKey.set(key, {
          companyName,
          primaryCity: city,
          citiesServed: [],
          products: [product],
          price,
          priceProduct: price ? product : null,
        });
        continue;
      }

      if (existing.primaryCity !== city && !existing.citiesServed.includes(city)) {
        existing.citiesServed.push(city);
      }
      if (!existing.products.includes(product)) {
        existing.products.push(product);
      }
      if (!existing.price && price) {
        existing.price = price;
        existing.priceProduct = product;
      }
    }
  }

  return Array.from(byKey.values());
}

function indiamartRawRecords(): RawSupplierRecord[] {
  const merged = mergeIndiamartListings();

  return merged.map((m) => {
    const fields = [
      "identity.companyName",
      "identity.location",
      "capabilities.categories",
      "capabilities.products",
    ];
    if (m.price) fields.push("commercial.priceRange");

    const cityNote =
      m.citiesServed.length > 0
        ? ` Also appears under IndiaMART's ${m.citiesServed.join(", ")} office-furniture listing(s) — recorded as cities served, not confirmed additional branches.`
        : "";

    return {
      companyName: m.companyName,
      location: locationFor(m.primaryCity),
      citiesServed: m.citiesServed.map(locationFor),
      categories: ["Office furniture"],
      products: m.products,
      priceRange: m.priceProduct ? priceRangeFromListing(m.priceProduct, m.price) ?? undefined : undefined,
      source: {
        url: CITY_URLS[m.primaryCity] ?? INDIAMART_NATIONAL_URL,
        sourceName: `${INDIAMART_SOURCE_NAME} (${m.primaryCity})`,
        sourceType: "public_directory",
        fields,
        snippet: `Listed on IndiaMART's Office Furniture category page for ${m.primaryCity}.${cityNote}`,
      },
    } satisfies RawSupplierRecord;
  });
}

function afmtRawRecords(): RawSupplierRecord[] {
  return AFMT_OFFICE_MEMBERS.map(([companyName, city]) => ({
    companyName,
    location: city ? locationFor(city) : "",
    categories: ["Office furniture"],
    source: {
      url: AFMT_URL,
      sourceName: AFMT_NAME,
      sourceType: "industry_association",
      fields: city
        ? ["identity.companyName", "identity.location", "capabilities.categories"]
        : ["identity.companyName", "capabilities.categories"],
      snippet:
        "Listed as a member company on the AFMT (Association of Furniture Manufacturers & Traders, India) members directory; included in this batch because its own listed name signals an office/commercial-seating product line.",
    },
  }));
}

// ---------------------------------------------------------------------
// Cross-source overlap check: before writing the batch, verify by normalized
// name (and a stricter alphanumeric-only key, to catch punctuation
// differences like "Hi-Tech" vs "Hi Tech") whether any company appears in
// BOTH the IndiaMART set and the AFMT set. Checked while building this
// batch: none do — the AFMT members pulled in here (filtered to an
// explicit office/seating name signal) don't overlap with the IndiaMART
// office-furniture listings gathered above. If a future re-run of this
// script (e.g. after adding more AFMT members) DOES produce a same-company
// hit across the two sources, mergeSuppliers() below merges it into one
// record with both sources as evidence — the same manual/curated pattern
// scripts/import-packaging-batch.ts used for Unikube Kartons — rather than
// leaving two rows for one real company.
// ---------------------------------------------------------------------
function mergeSuppliers(primary: Supplier, secondary: Supplier): Supplier {
  const sources = [...primary.intelligence.sources, ...secondary.intelligence.sources];

  return {
    ...primary,
    capabilities: {
      ...primary.capabilities,
      categories: Array.from(
        new Set([...primary.capabilities.categories, ...secondary.capabilities.categories])
      ),
    },
    intelligence: {
      ...primary.intelligence,
      sources,
      dataConfidence: computeDataConfidence(sources),
    },
    mergedFrom: [...primary.mergedFrom, secondary.id],
  };
}

function alnumKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function main() {
  // Id block reserved for this file: 1000-1999 (see lib/supplier-store.ts).
  let existingIds: number[] = [999];
  const suppliers: Supplier[] = [];

  const pushNormalized = (raw: RawSupplierRecord) => {
    const supplier = normalizeSupplierRecord(raw, existingIds);
    existingIds = [...existingIds, supplier.id];
    suppliers.push(supplier);
    return supplier;
  };

  const indiamartRaw = indiamartRawRecords();
  const afmtRaw = afmtRawRecords();

  for (const raw of indiamartRaw) pushNormalized(raw);
  for (const raw of afmtRaw) pushNormalized(raw);

  // Verify (not assume) there's no same-company overlap between the two
  // sources before writing the batch — see the comment above mergeSuppliers.
  let crossSourceMergesApplied = 0;
  const indiamartKeys = new Set(
    suppliers
      .filter((s) => s.sourcing.method === "public_directory")
      .map((s) => alnumKey(s.identity.companyName))
  );
  for (const s of suppliers.filter((s) => s.sourcing.method === "industry_association")) {
    const key = alnumKey(s.identity.companyName);
    if (!indiamartKeys.has(key)) continue;

    const primary = suppliers.find(
      (other) => other.sourcing.method === "public_directory" && alnumKey(other.identity.companyName) === key
    )!;
    const merged = mergeSuppliers(primary, s);
    suppliers[suppliers.findIndex((x) => x.id === primary.id)] = merged;
    suppliers.splice(suppliers.findIndex((x) => x.id === s.id), 1);
    crossSourceMergesApplied++;
  }

  const candidates = findPotentialDuplicates(suppliers);

  console.log(`Normalized ${suppliers.length} office-furniture suppliers.`);
  console.log(`Sources: IndiaMART (${indiamartRaw.length} unique companies after merging duplicate city-page listings), AFMT (${afmtRaw.length} members).`);
  console.log(`Cross-source duplicates found and merged (same company on both IndiaMART and AFMT): ${crossSourceMergesApplied}.`);
  console.log(`findPotentialDuplicates() flagged ${candidates.length} candidate pair(s) for human review:`);
  for (const candidate of candidates) {
    console.log(
      `  - "${candidate.a.identity.companyName}" (${candidate.a.identity.location}) <-> "${candidate.b.identity.companyName}" (${candidate.b.identity.location}) [${candidate.reason}]`
    );
  }

  const byConfidence = { high: 0, medium: 0, low: 0 };
  const byState = new Map<string, number>();
  let withWebsite = 0;
  let withProducts = 0;
  let withPricing = 0;
  let withMoqOrLeadTime = 0;

  for (const s of suppliers) {
    byConfidence[s.intelligence.dataConfidence]++;
    const state = s.identity.location.split(",").pop()?.trim() || "Unspecified";
    byState.set(state, (byState.get(state) ?? 0) + 1);
    if (s.identity.website) withWebsite++;
    if (s.capabilities.products.length > 0) withProducts++;
    if (s.commercial.priceRange) withPricing++;
    if (s.commercial.moq || s.commercial.leadTime) withMoqOrLeadTime++;
  }

  console.log("\n--- Batch summary ---");
  console.log(`Total suppliers: ${suppliers.length}`);
  console.log(`Confidence: high=${byConfidence.high} medium=${byConfidence.medium} low=${byConfidence.low}`);
  console.log(`With website: ${withWebsite}`);
  console.log(`With product evidence: ${withProducts}`);
  console.log(`With pricing data: ${withPricing}`);
  console.log(`With MOQ or lead time: ${withMoqOrLeadTime}`);
  console.log("Geographic distribution (by state):");
  for (const [state, count] of Array.from(byState.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${state}: ${count}`);
  }

  const dataFile = path.join(process.cwd(), "data", "suppliers", "office-furniture.json");
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ suppliers }, null, 2), "utf-8");

  console.log(`\nWrote ${suppliers.length} suppliers to ${dataFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
