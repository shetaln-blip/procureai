// Representative test cases for the extraction pipeline (lib/extraction).
// Run with: npx tsx scripts/test-extraction.ts
//
// These exist to test the extraction THEORY (span-based entities, product
// derivation by complement, price/quantity/date classification) across
// different procurement styles — not to memorize one sentence. None of
// these strings are read by lib/extraction/* itself; the pipeline has no
// knowledge these test cases exist.
import { extractProcurementRequirement } from "../lib/extraction/pipeline";
import type { ExtractionResult } from "../lib/extraction/schema";

const REFERENCE_DATE = new Date("2026-09-07T00:00:00Z");

type Check = {
  label: string;
  assert: (result: ExtractionResult) => string | null; // null = pass, string = failure reason
};

type TestCase = {
  name: string;
  query: string;
  checks: Check[];
};

function field<T>(getter: (r: ExtractionResult) => T | null | undefined, expected: T, label: string): Check {
  return {
    label,
    assert: (result) => {
      const actual = getter(result);
      if (actual !== expected) {
        return `expected ${label} = ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
      }
      return null;
    },
  };
}

function contains(getter: (r: ExtractionResult) => string[], expected: string, label: string): Check {
  return {
    label,
    assert: (result) => {
      const actual = getter(result);
      if (!actual.some((v) => v.toLowerCase() === expected.toLowerCase())) {
        return `expected ${label} to include ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
      }
      return null;
    },
  };
}

function productDoesNotContain(expected: string): Check {
  return {
    label: `product excludes "${expected}"`,
    assert: (result) => {
      const product = (result.requirement.product.value ?? "").toLowerCase();
      if (product.includes(expected.toLowerCase())) {
        return `product ("${result.requirement.product.value}") unexpectedly contains "${expected}"`;
      }
      return null;
    },
  };
}

function isNull(getter: (r: ExtractionResult) => unknown, label: string): Check {
  return {
    label: `${label} is null`,
    assert: (result) => {
      const actual = getter(result);
      if (actual !== null) return `expected ${label} to be null, got ${JSON.stringify(actual)}`;
      return null;
    },
  };
}

const cases: TestCase[] = [
  {
    name: "Simple product request, no quantity, no budget",
    query: "I need office chairs delivered to Mumbai",
    checks: [
      field((r) => r.requirement.product.value, "Office Chairs", "product"),
      field((r) => r.requirement.location.value, "Mumbai", "location"),
      isNull((r) => r.requirement.quantity.value, "quantity"),
      isNull((r) => r.requirement.price.amount, "price.amount"),
    ],
  },
  {
    name: "Technical product with certification, no quantity",
    query: "Looking for 10-inch stainless steel pipes, ISO 9001 certified",
    checks: [
      isNull((r) => r.requirement.quantity.value, "quantity"),
      contains((r) => r.requirement.specifications.construction, "10-inch", "construction"),
      contains((r) => r.requirement.specifications.certifications, "ISO 9001", "certifications"),
      field((r) => r.requirement.specifications.material.value, "Stainless steel", "material"),
      productDoesNotContain("10"),
      productDoesNotContain("iso"),
    ],
  },
  {
    name: "Quantity with adjective between number and unit",
    query: "Need 2,500 eco-friendly water bottles for our office",
    checks: [
      field((r) => r.requirement.quantity.value, 2500, "quantity"),
      field((r) => r.requirement.unit.value, "bottles", "unit"),
      contains((r) => r.requirement.specifications.sustainabilityRequirements, "eco-friendly", "sustainability"),
    ],
  },
  {
    name: "Multiple specifications on one product",
    query:
      "Source 5000 recyclable 5-ply corrugated shipping boxes with custom printing, ISO 9001 certified, food grade",
    checks: [
      field((r) => r.requirement.quantity.value, 5000, "quantity"),
      field((r) => r.requirement.unit.value, "boxes", "unit"),
      contains((r) => r.requirement.specifications.construction, "5-ply", "construction"),
      contains((r) => r.requirement.specifications.sustainabilityRequirements, "recyclable", "sustainability"),
      contains((r) => r.requirement.specifications.customizationRequirements, "custom printing", "customization"),
      contains((r) => r.requirement.specifications.certifications, "ISO 9001", "certifications"),
      contains((r) => r.requirement.specifications.qualityRequirements, "food grade", "quality"),
      field((r) => r.requirement.specifications.material.value, "Corrugated", "material"),
      isNull((r) => r.requirement.price.amount, "price.amount"),
    ],
  },
  {
    name: "Price: maximum, per-unit basis",
    query: "Procure 1000 packaging boxes under ₹12 per box",
    checks: [
      field((r) => r.requirement.quantity.value, 1000, "quantity"),
      field((r) => r.requirement.price.amount, 12, "price.amount"),
      field((r) => r.requirement.price.type, "maximum", "price.type"),
      field((r) => r.requirement.price.basis, "per_unit", "price.basis"),
      field((r) => r.requirement.price.currencySymbol, "₹", "price.currencySymbol"),
    ],
  },
  {
    name: "Price: total budget, no quantity",
    query: "We need office furniture, budget of ₹200000",
    checks: [
      isNull((r) => r.requirement.quantity.value, "quantity"),
      field((r) => r.requirement.price.amount, 200000, "price.amount"),
      field((r) => r.requirement.price.basis, "total_budget", "price.basis"),
    ],
  },
  {
    name: "Price: range, per-unit basis",
    query: "Looking for corrugated boxes between ₹8 and ₹14 per unit",
    checks: [
      field((r) => r.requirement.price.type, "range", "price.type"),
      field((r) => r.requirement.price.amount, 8, "price.amount"),
      field((r) => r.requirement.price.amountMax, 14, "price.amountMax"),
      field((r) => r.requirement.price.basis, "per_unit", "price.basis"),
    ],
  },
  {
    name: "Absolute deadline",
    query: "Need 500 chairs by September 30",
    checks: [
      field((r) => r.requirement.deliveryTimeframe.kind, "absolute", "deliveryTimeframe.kind"),
      field((r) => r.requirement.deliveryTimeframe.absoluteDate, "2026-09-30", "deliveryTimeframe.absoluteDate"),
    ],
  },
  {
    name: "Relative deadline",
    query: "Require 300 tables within 3 weeks",
    checks: [
      field((r) => r.requirement.deliveryTimeframe.kind, "relative", "deliveryTimeframe.kind"),
      field((r) => r.requirement.deliveryTimeframe.relativeDays, 21, "deliveryTimeframe.relativeDays"),
    ],
  },
  {
    name: "Urgency / ASAP",
    query: "Need packaging material ASAP",
    checks: [
      field((r) => r.requirement.deliveryTimeframe.kind, "urgent", "deliveryTimeframe.kind"),
      field((r) => r.requirement.urgency.value, "urgent", "urgency.value"),
      field((r) => r.requirement.urgency.confidence, "high", "urgency.confidence"),
    ],
  },
  {
    name: "Multiple quantities in one request",
    query: "Order 500 boxes and 200 crates for shipment",
    checks: [
      field((r) => r.requirement.quantity.value, 500, "quantity (first mention wins)"),
      field((r) => r.requirement.unit.value, "boxes", "unit"),
      {
        label: "multiple_quantities_detected warning present",
        assert: (r) =>
          r.warnings.some((w) => w.code === "multiple_quantities_detected")
            ? null
            : "expected a multiple_quantities_detected warning",
      },
    ],
  },
  {
    name: "Technical numbers: grade + material + percentage, no quantity",
    query: "Need 304 stainless steel sheets, 99.9% purity, Grade A",
    checks: [
      isNull((r) => r.requirement.quantity.value, "quantity"),
      contains((r) => r.requirement.specifications.construction, "304 stainless steel", "construction"),
      contains((r) => r.requirement.specifications.construction, "99.9% purity", "construction"),
      contains((r) => r.requirement.specifications.certifications, "Grade A", "certifications"),
      field((r) => r.requirement.specifications.material.value, "Stainless steel", "material"),
    ],
  },
  {
    name: "Service request, no product quantity",
    query: "Looking for a reliable supplier for warehouse management services in Chennai",
    checks: [
      isNull((r) => r.requirement.quantity.value, "quantity"),
      field((r) => r.requirement.location.value, "Chennai", "location"),
      contains((r) => r.requirement.specifications.requiredCapabilities, "reliable supplier", "capabilities"),
      productDoesNotContain("chennai"),
    ],
  },
  {
    name: "Payment terms, no quantity or budget",
    query: "Need custom printing on labels, payment terms net 30",
    checks: [
      field((r) => r.requirement.paymentTerms.value, "net 30", "paymentTerms"),
      contains((r) => r.requirement.specifications.customizationRequirements, "custom printing", "customization"),
    ],
  },
  {
    name: "Location must not leak into product",
    query: "Custom boxes in Bengaluru",
    checks: [
      field((r) => r.requirement.location.value, "Bengaluru", "location"),
      productDoesNotContain("bengaluru"),
      productDoesNotContain("in "),
      contains((r) => r.requirement.specifications.customizationRequirements, "custom", "customization"),
    ],
  },
  {
    name: "Combined: quantity, spec, material, location, relative deadline, per-unit price",
    query:
      "Sourcing 7500 biodegradable 3-layer kraft paper mailers with custom branding, delivery to Pune within 10 days, under $0.5 per unit",
    checks: [
      field((r) => r.requirement.quantity.value, 7500, "quantity"),
      field((r) => r.requirement.unit.value, "mailers", "unit"),
      contains((r) => r.requirement.specifications.construction, "3-layer", "construction"),
      contains((r) => r.requirement.specifications.sustainabilityRequirements, "biodegradable", "sustainability"),
      contains((r) => r.requirement.specifications.customizationRequirements, "custom branding", "customization"),
      field((r) => r.requirement.specifications.material.value, "Kraft paper", "material"),
      field((r) => r.requirement.location.value, "Pune", "location"),
      field((r) => r.requirement.deliveryTimeframe.relativeDays, 10, "deliveryTimeframe.relativeDays"),
      field((r) => r.requirement.price.amount, 0.5, "price.amount"),
      field((r) => r.requirement.price.currencySymbol, "$", "price.currencySymbol"),
      field((r) => r.requirement.price.basis, "per_unit", "price.basis"),
    ],
  },
];

let passed = 0;
let failed = 0;

for (const testCase of cases) {
  const result = extractProcurementRequirement(testCase.query, REFERENCE_DATE);
  const failures: string[] = [];

  for (const check of testCase.checks) {
    const failure = check.assert(result);
    if (failure) failures.push(failure);
  }

  if (failures.length === 0) {
    passed++;
    console.log(`PASS  ${testCase.name}`);
  } else {
    failed++;
    console.log(`FAIL  ${testCase.name}`);
    console.log(`      query: "${testCase.query}"`);
    for (const failure of failures) {
      console.log(`      - ${failure}`);
    }
    console.log(`      full result: ${JSON.stringify(result, null, 2)}`);
  }
}

console.log(`\n${passed}/${cases.length} passed, ${failed} failed.`);

if (failed > 0) process.exit(1);
