export type Vendor = {
  id: number;
  name: string;
  category: string;
  location: string;
  rating: number;
  reviews: number;
  priceRange: string;
  delivery: string;
  minOrder: string;
  sourceVerified: boolean;
  website: string;
  description: string;
};

export const vendors: Vendor[] = [
  {
    id: 1,
    name: "PackRight Industries",
    category: "Packaging",
    location: "Bangalore, Karnataka",
    rating: 4.8,
    reviews: 214,
    priceRange: "₹8–₹14 / unit",
    delivery: "7–14 days",
    minOrder: "5,000 units",
    sourceVerified: true,
    website: "https://packright-industries.example.in",
    description:
      "Manufacturer of custom corrugated boxes and sustainable packaging for businesses.",
  },
  {
    id: 2,
    name: "BoxCraft India",
    category: "Packaging",
    location: "Bangalore, Karnataka",
    rating: 4.6,
    reviews: 167,
    priceRange: "₹9–₹16 / unit",
    delivery: "10–18 days",
    minOrder: "2,000 units",
    sourceVerified: true,
    website: "https://boxcraft-india.example.in",
    description:
      "Custom packaging supplier specializing in branded boxes and retail packaging.",
  },
  {
    id: 3,
    name: "GreenPack Solutions",
    category: "Packaging",
    location: "Mysore, Karnataka",
    rating: 4.7,
    reviews: 98,
    priceRange: "₹10–₹15 / unit",
    delivery: "8–15 days",
    minOrder: "3,000 units",
    sourceVerified: false,
    website: "https://greenpack-solutions.example.in",
    description:
      "Eco-friendly packaging manufacturer using recyclable and biodegradable materials.",
  },
  {
    id: 4,
    name: "TechSource Components",
    category: "Electronics",
    location: "Bangalore, Karnataka",
    rating: 4.5,
    reviews: 321,
    priceRange: "₹50–₹5,000",
    delivery: "5–12 days",
    minOrder: "100 units",
    sourceVerified: true,
    website: "https://techsource-components.example.in",
    description:
      "Supplier of electronic components and hardware for startups and manufacturers.",
  },
  {
    id: 5,
    name: "OfficeHub",
    category: "Office Furniture",
    location: "Bangalore, Karnataka",
    rating: 4.4,
    reviews: 143,
    priceRange: "₹3,000–₹50,000",
    delivery: "10–20 days",
    minOrder: "10 units",
    sourceVerified: false,
    website: "https://officehub.example.in",
    description:
      "Commercial office furniture supplier serving businesses across South India.",
  },
];
