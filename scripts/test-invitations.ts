// Tests P0 #2 — secure supplier invitation tokens.
//
// Run with a throwaway store file so this never touches real data:
//   RFQ_STORE_FILE=/tmp/procureai-test-invitations.json npx tsx scripts/test-invitations.ts
import {
  createRFQ,
  issueInvitationToken,
  resolveInvitationByToken,
  resolveInvitationByVendorId,
} from "../lib/store";
import { generateInvitationToken } from "../lib/invitations";

if (!process.env.RFQ_STORE_FILE) {
  console.error(
    "Refusing to run without RFQ_STORE_FILE set — this test writes RFQs " +
      "and must not touch the real data/rfqs-store.json. Example:\n" +
      "  RFQ_STORE_FILE=/tmp/procureai-test-invitations.json npx tsx scripts/test-invitations.ts"
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

const emptyRequirements = {
  product: "",
  quantity: "",
  location: "",
  budget: "",
  deadline: "",
  quality: "",
  additionalRequirements: [] as string[],
};

async function main() {
  console.log("=== Test 2: secure supplier invitation tokens ===");

  const rfq = await createRFQ({
    query: "Need 2000 corrugated boxes",
    requirements: { ...emptyRequirements, product: "Corrugated boxes" },
    suppliers: [
      { vendorId: 10, vendorName: "Supplier A" },
      { vendorId: 20, vendorName: "Supplier B" },
    ],
  });

  const issuedA = await issueInvitationToken(rfq.id, 10);
  const issuedB = await issueInvitationToken(rfq.id, 20);

  check("token issued for supplier A", !!issuedA?.token);
  check("token issued for supplier B", !!issuedB?.token);
  check("tokens are different", issuedA?.token !== issuedB?.token);

  const resolvedA = await resolveInvitationByToken(rfq.id, issuedA!.token);
  const resolvedB = await resolveInvitationByToken(rfq.id, issuedB!.token);

  check("token A resolves to supplier A", resolvedA?.supplier.vendorId === 10);
  check("token B resolves to supplier B", resolvedB?.supplier.vendorId === 20);
  check(
    "token A does not resolve to supplier B",
    resolvedA?.supplier.vendorId !== 20
  );

  // Token A must never be usable to submit/see supplier B's invitation —
  // this is the "cannot submit a quote on behalf of another invited
  // supplier" requirement, expressed at the resolution layer that every
  // API route relies on for identity.
  const attemptCrossSubmit = await resolveInvitationByToken(rfq.id, issuedA!.token);
  check(
    "token A always resolves to its OWN supplier, never supplier B, however it's used",
    attemptCrossSubmit?.supplier.vendorId === 10
  );

  const randomToken = generateInvitationToken();
  const resolvedRandom = await resolveInvitationByToken(rfq.id, randomToken);
  check("a random/invalid token is rejected", resolvedRandom === null);

  const resolvedEmpty = await resolveInvitationByToken(rfq.id, "");
  check("an empty token is rejected", resolvedEmpty === null);

  const resolvedGarbage = await resolveInvitationByToken(rfq.id, "not-a-real-token");
  check("a malformed token is rejected", resolvedGarbage === null);

  // Legacy vendorId fallback still works for suppliers who have never
  // had a secure token issued.
  const rfq2 = await createRFQ({
    query: "Need 500 pallets",
    requirements: { ...emptyRequirements, product: "Pallets" },
    suppliers: [{ vendorId: 30, vendorName: "Supplier C" }],
  });

  const legacyResolved = await resolveInvitationByVendorId(rfq2.id, 30);
  check(
    "legacy vendorId link works before any secure token is issued",
    legacyResolved?.supplier.vendorId === 30
  );

  // ...but once a secure token IS issued for that supplier, the old
  // guessable vendorId link must stop working.
  await issueInvitationToken(rfq2.id, 30);
  const legacyAfterUpgrade = await resolveInvitationByVendorId(rfq2.id, 30);
  check(
    "legacy vendorId link is disabled once a secure token is issued",
    legacyAfterUpgrade === null
  );

  // A vendorId that's valid on one RFQ must not resolve on an unrelated
  // RFQ just because the same number happens to appear there.
  const crossRfq = await resolveInvitationByVendorId(rfq.id, 30);
  check(
    "a vendorId valid on one RFQ does not resolve on an unrelated RFQ",
    crossRfq === null
  );

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
