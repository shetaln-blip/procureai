// Tests P0 #3 — supplier performance derived from real RFQ/quote/award
// events, never fabricated.
//
// Run with a throwaway store file so this never touches real data:
//   RFQ_STORE_FILE=/tmp/procureai-test-performance.json npx tsx scripts/test-performance.ts
import { createRFQ, addQuote, awardRFQ, listRFQs } from "../lib/store";
import { calculateSupplierPerformance } from "../lib/supplier-performance";

if (!process.env.RFQ_STORE_FILE) {
  console.error(
    "Refusing to run without RFQ_STORE_FILE set — this test writes RFQs " +
      "and must not touch the real data/rfqs-store.json. Example:\n" +
      "  RFQ_STORE_FILE=/tmp/procureai-test-performance.json npx tsx scripts/test-performance.ts"
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

const baseRequirements = {
  product: "Test product",
  quantity: "100 units",
  location: "Bengaluru",
  budget: "",
  deadline: "",
  quality: "",
  additionalRequirements: [] as string[],
};

const baseQuote = {
  moq: 10,
  shippingCost: 0,
  taxPercent: 0,
  paymentTerms: "Net 30",
  validUntil: "",
  notes: "",
};

async function main() {
  console.log("=== Test 3: supplier performance from real events ===");

  // Supplier 100: invited to 3 RFQs, quotes on 2, wins 1.
  const rfq1 = await createRFQ({
    query: "q1",
    requirements: baseRequirements,
    suppliers: [
      { vendorId: 100, vendorName: "Perf Supplier" },
      { vendorId: 200, vendorName: "Other Supplier" },
    ],
  });
  const rfq2 = await createRFQ({
    query: "q2",
    requirements: baseRequirements,
    suppliers: [{ vendorId: 100, vendorName: "Perf Supplier" }],
  });
  await createRFQ({
    query: "q3 (no response from supplier 100)",
    requirements: baseRequirements,
    suppliers: [{ vendorId: 100, vendorName: "Perf Supplier" }],
  });

  await addQuote(rfq1.id, {
    ...baseQuote,
    vendorId: 100,
    vendorName: "Perf Supplier",
    unitPrice: 50,
    quotedQuantity: 100,
    leadTimeDays: 10,
  });
  await addQuote(rfq1.id, {
    ...baseQuote,
    vendorId: 200,
    vendorName: "Other Supplier",
    unitPrice: 60,
    quotedQuantity: 100,
    leadTimeDays: 8,
  });
  await addQuote(rfq2.id, {
    ...baseQuote,
    vendorId: 100,
    vendorName: "Perf Supplier",
    unitPrice: 55,
    quotedQuantity: 100,
    leadTimeDays: 10,
  });
  // rfq3: no quote submitted by supplier 100 — exercises response rate < 100%.

  const rfq1WithQuotes = (await listRFQs()).find((r) => r.id === rfq1.id)!;
  const quoteId = rfq1WithQuotes.quotes.find((q) => q.vendorId === 100)!.id;
  await awardRFQ(rfq1.id, quoteId);

  const rfqs = await listRFQs();
  const perf = calculateSupplierPerformance(100, rfqs);

  check("rfqsReceived counts all 3 invitations", perf.rfqsReceived === 3);
  check("quotesSubmitted counts both quotes", perf.quotesSubmitted === 2);
  check("ordersAwarded counts the 1 win", perf.ordersAwarded === 1);
  check(
    "quoteResponseRate = 2/3",
    perf.quoteResponseRate !== null &&
      Math.abs(perf.quoteResponseRate - 2 / 3) < 0.001
  );
  check(
    "winRate = 1/2",
    perf.winRate !== null && Math.abs(perf.winRate - 0.5) < 0.001
  );
  check(
    "averageQuotedPrice is the mean of 50 and 55",
    perf.averageQuotedPrice === Math.round((50 + 55) / 2)
  );
  check(
    "completedOrders is null — no confirmed-delivery event exists in the schema",
    perf.completedOrders === null
  );
  check(
    "onTimeDeliveryRate is null — no confirmed-delivery event exists in the schema",
    perf.onTimeDeliveryRate === null
  );
  check(
    "averageResponseHours is a real non-negative number",
    perf.averageResponseHours !== null && perf.averageResponseHours >= 0
  );

  // A supplier with zero history must show null rates, never 0% or
  // fabricated numbers — "do not claim a supplier is reliable simply
  // because they have existed in the database."
  const untouched = calculateSupplierPerformance(999999, rfqs);
  check("rfqsReceived is 0 for an untouched supplier", untouched.rfqsReceived === 0);
  check(
    "quoteResponseRate is null (not 0) when there's nothing to divide",
    untouched.quoteResponseRate === null
  );
  check(
    "winRate is null (not 0) when no quotes were submitted",
    untouched.winRate === null
  );
  check(
    "averageQuotedPrice is null when no quotes exist",
    untouched.averageQuotedPrice === null
  );
  check(
    "averageResponseHours is null when no quotes exist",
    untouched.averageResponseHours === null
  );

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
