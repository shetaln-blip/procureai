// Tests P0 #1 (the structured requirement survives creation -> RFQ ->
// supplier-facing view) plus a regression pass over the existing core
// RFQ workflow: creation, response, submission, editing, comparison,
// award, PO generation.
//
// Run with a throwaway store file so this never touches real data:
//   RFQ_STORE_FILE=/tmp/procureai-test-rfq-flow.json npx tsx scripts/test-rfq-flow.ts
import { extractProcurementRequirement } from "../lib/extraction/pipeline";
import { toLegacyRequirements } from "../lib/extraction/legacy-adapter";
import { toSupplierFacingRequirement } from "../lib/extraction/supplier-view";
import { createRFQ, getRFQ, addQuote, awardRFQ, toPublicRfq } from "../lib/store";

if (!process.env.RFQ_STORE_FILE) {
  console.error(
    "Refusing to run without RFQ_STORE_FILE set — this test writes RFQs " +
      "and must not touch the real data/rfqs-store.json. Example:\n" +
      "  RFQ_STORE_FILE=/tmp/procureai-test-rfq-flow.json npx tsx scripts/test-rfq-flow.ts"
  );
  process.exit(1);
}

let failures = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.log(`  FAIL: ${label}`);
    failures++;
  }
}

async function main() {
  console.log("=== Test 1: structured requirement survives into the RFQ ===");

  const query =
    "Need 5000 5-ply corrugated shipping boxes, ISO 9001 certified, recyclable material, delivered to Bengaluru within 20 days, budget under ₹45 per box, Net 30 payment terms";
  const extraction = extractProcurementRequirement(query);
  const legacyRequirements = toLegacyRequirements(extraction);

  const rfq = await createRFQ({
    query,
    requirements: legacyRequirements,
    structuredRequirement: extraction.requirement,
    suppliers: [
      { vendorId: 1, vendorName: "Test Supplier A" },
      { vendorId: 2, vendorName: "Test Supplier B" },
    ],
  });

  check("RFQ created", !!rfq.id);
  check(
    "structuredRequirement stored on the RFQ",
    rfq.structuredRequirement !== null
  );
  check(
    "structured product matches extraction",
    rfq.structuredRequirement?.product.value ===
      extraction.requirement.product.value
  );
  check(
    "structured quantity matches extraction",
    rfq.structuredRequirement?.quantity.value ===
      extraction.requirement.quantity.value
  );
  check(
    "legacy flat requirements are derived from the structured requirement",
    rfq.requirements.product === legacyRequirements.product &&
      rfq.requirements.quantity === legacyRequirements.quantity
  );

  const reloaded = await getRFQ(rfq.id);
  check(
    "structuredRequirement survives a reload from disk",
    reloaded?.structuredRequirement?.product.value ===
      extraction.requirement.product.value
  );

  const supplierView = reloaded?.structuredRequirement
    ? toSupplierFacingRequirement(reloaded.structuredRequirement)
    : null;

  check("supplier-facing view derived from the structured requirement", supplierView !== null);
  check(
    "supplier-facing view exposes product",
    supplierView?.product === extraction.requirement.product.value
  );
  check(
    "supplier-facing view exposes certifications",
    (supplierView?.certifications.length ?? 0) > 0
  );
  check(
    "supplier-facing view does NOT expose confidence metadata",
    JSON.stringify(supplierView).includes("confidence") === false
  );

  const publicRfq = toPublicRfq(reloaded!);
  check(
    "buyer-facing RFQ view strips invitation token fields",
    publicRfq.suppliers.every(
      (s) => s.tokenHash === null && s.tokenIssuedAt === null
    )
  );

  console.log("\n=== Regression: existing RFQ workflow ===");

  const quoted = await addQuote(rfq.id, {
    vendorId: 1,
    vendorName: "Test Supplier A",
    unitPrice: 40,
    quotedQuantity: 5000,
    moq: 500,
    leadTimeDays: 15,
    shippingCost: 1500,
    taxPercent: 18,
    paymentTerms: "Net 30",
    validUntil: "2026-12-31",
    notes: "Initial quote",
  });

  check("quote submission succeeds", quoted !== null);
  check(
    "RFQ status becomes quotes_received",
    quoted?.status === "quotes_received"
  );
  check(
    "supplier status flips to quoted",
    quoted?.suppliers.find((s) => s.vendorId === 1)?.status === "quoted"
  );

  // Quote editing — same vendorId should replace, not duplicate.
  const edited = await addQuote(rfq.id, {
    vendorId: 1,
    vendorName: "Test Supplier A",
    unitPrice: 38,
    quotedQuantity: 5000,
    moq: 500,
    leadTimeDays: 12,
    shippingCost: 1500,
    taxPercent: 18,
    paymentTerms: "Net 30",
    validUntil: "2026-12-31",
    notes: "Revised quote",
  });

  check(
    "editing a quote replaces it rather than duplicating",
    edited?.quotes.filter((q) => q.vendorId === 1).length === 1
  );
  check(
    "edited quote reflects the new price",
    edited?.quotes.find((q) => q.vendorId === 1)?.unitPrice === 38
  );

  await addQuote(rfq.id, {
    vendorId: 2,
    vendorName: "Test Supplier B",
    unitPrice: 42,
    quotedQuantity: 5000,
    moq: 1000,
    leadTimeDays: 20,
    shippingCost: 1000,
    taxPercent: 18,
    paymentTerms: "50% advance",
    validUntil: "2026-12-31",
    notes: "",
  });

  const beforeAward = await getRFQ(rfq.id);
  check("both suppliers have quotes (comparison has data)", beforeAward?.quotes.length === 2);

  const bestQuoteId = beforeAward!.quotes.find((q) => q.vendorId === 1)!.id;
  const awardResult = await awardRFQ(rfq.id, bestQuoteId);

  check("award succeeds", awardResult.ok === true);
  const awarded = awardResult.ok ? awardResult.rfq : null;
  check("RFQ status becomes awarded", awarded?.status === "awarded");
  check("PO generated", awarded?.purchaseOrder !== null);
  check(
    "PO awarded to the correct vendor",
    awarded?.purchaseOrder?.vendorId === 1
  );
  check(
    "PO total value is calculated (not zero/fabricated)",
    (awarded?.purchaseOrder?.totalValue ?? 0) > 0
  );
  check(
    "structuredRequirement still intact after quotes + award",
    awarded?.structuredRequirement?.product.value ===
      extraction.requirement.product.value
  );

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
