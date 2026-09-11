import { promises as fs } from "fs";
import path from "path";
import type {
  InvitedSupplier,
  PurchaseOrder,
  Quote,
  RFQ,
  Requirements,
} from "./rfq-types";
import type { ProcurementRequirement } from "./extraction/schema";
import { toLegacyRequirements } from "./extraction/legacy-adapter";
import {
  generateInvitationToken,
  hashInvitationToken,
  verifyInvitationToken,
} from "./invitations";
import { calculateQuoteCost, getRequestedQuantity } from "./quote-cost";
import { resolveDeadlineDate } from "./deadline";

// File-backed store for RFQs and quotes. There's no database configured
// for this project yet, so this keeps everything in a single JSON file
// under data/. It's fine for local/demo use on a single dev server —
// swap this out for a real database before deploying anywhere shared.
//
// RFQ_STORE_FILE lets callers (currently just the P0 test scripts in
// scripts/test-*.ts) point this at a throwaway file instead of the real
// data/rfqs-store.json, so tests can create/quote/award RFQs freely
// without writing fake data into the real store. Unset, this resolves
// to exactly the same path as before.
const DATA_FILE = process.env.RFQ_STORE_FILE
  ? path.resolve(process.env.RFQ_STORE_FILE)
  : path.join(process.cwd(), "data", "rfqs-store.json");

// Normalizes an RFQ record loaded from disk so every reader can rely on
// the current shape regardless of when the record was created —
// (P0 #1) `structuredRequirement` and (P0 #2) each supplier's
// `tokenHash`/`tokenIssuedAt` were both added after RFQs already
// existed in some deployments' data files, so old records won't have
// them yet.
function normalizeRfq(rfq: RFQ): RFQ {
  return {
    ...rfq,
    structuredRequirement: rfq.structuredRequirement ?? null,
    suppliers: (rfq.suppliers ?? []).map((supplier) => ({
      ...supplier,
      tokenHash: supplier.tokenHash ?? null,
      tokenIssuedAt: supplier.tokenIssuedAt ?? null,
    })),
  };
}

async function readStore(): Promise<RFQ[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const rfqs = Array.isArray(parsed?.rfqs) ? parsed.rfqs : [];

    return rfqs.map(normalizeRfq);
  } catch {
    return [];
  }
}

async function writeStore(rfqs: RFQ[]): Promise<void> {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(
    DATA_FILE,
    JSON.stringify({ rfqs }, null, 2),
    "utf-8"
  );
}

function generateId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();

  return `${prefix}-${Date.now().toString(36).toUpperCase()}${random}`;
}

function addDays(days: number): string {
  const date = new Date();

  date.setDate(date.getDate() + days);

  return date.toISOString().slice(0, 10);
}

export async function listRFQs(): Promise<RFQ[]> {
  const rfqs = await readStore();

  return [...rfqs].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

export async function getRFQ(id: string): Promise<RFQ | null> {
  const rfqs = await readStore();

  return rfqs.find((rfq) => rfq.id === id) ?? null;
}

export async function createRFQ(input: {
  query: string;
  requirements: Requirements;
  // The rich structured requirement (P0 #1), when the request that
  // produced this RFQ went through the extraction pipeline. When
  // present, it becomes the canonical requirement stored on the RFQ,
  // and `requirements` below is derived from it (rather than trusting
  // whatever flat fields the caller separately sent) so the two can
  // never drift apart. Optional/nullable so this stays backward
  // compatible with any caller that only has the flat shape.
  structuredRequirement?: ProcurementRequirement | null;
  suppliers: { vendorId: number; vendorName: string }[];
}): Promise<RFQ> {
  const rfqs = await readStore();

  const structuredRequirement = input.structuredRequirement ?? null;
  const requirements = structuredRequirement
    ? toLegacyRequirements({
        rawQuery: input.query,
        requirement: structuredRequirement,
        warnings: [],
      })
    : input.requirements;

  const rfq: RFQ = {
    id: generateId("RFQ"),
    query: input.query,
    requirements,
    structuredRequirement,
    suppliers: input.suppliers.map((supplier) => ({
      ...supplier,
      status: "invited",
      tokenHash: null,
      tokenIssuedAt: null,
    })),
    quotes: [],
    // Generating the RFQ in this flow is the "send" action — there's no
    // email integration yet, so the buyer shares response links manually.
    status: "sent",
    purchaseOrder: null,
    createdAt: new Date().toISOString(),
  };

  rfqs.unshift(rfq);
  await writeStore(rfqs);

  return rfq;
}

export async function addQuote(
  id: string,
  quote: Omit<Quote, "id" | "submittedAt">
): Promise<RFQ | null> {
  const rfqs = await readStore();
  const rfq = rfqs.find((item) => item.id === id);

  if (!rfq) return null;

  const newQuote: Quote = {
    ...quote,
    id: generateId("Q"),
    submittedAt: new Date().toISOString(),
  };

  const existingIndex = rfq.quotes.findIndex(
    (existing) => existing.vendorId === quote.vendorId
  );

  if (existingIndex >= 0) {
    rfq.quotes[existingIndex] = newQuote;
  } else {
    rfq.quotes.push(newQuote);
  }

  rfq.suppliers = rfq.suppliers.map((supplier) =>
    supplier.vendorId === quote.vendorId
      ? { ...supplier, status: "quoted" }
      : supplier
  );

  rfq.status = "quotes_received";

  await writeStore(rfqs);

  return rfq;
}

// Discriminated result rather than `RFQ | null` (Quote Intelligence
// Audit): "the RFQ/quote don't exist" and "we can't honestly compute a
// total for this quote" are different failures with different messages,
// and the buyer's override must still work end-to-end when the total
// IS computable — this never blocks a legitimate award, it only refuses
// to fabricate a PO total out of missing data.
export type AwardResult =
  | { ok: true; rfq: RFQ }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_awarded" }
  | { ok: false; reason: "uncomputable" };

export async function awardRFQ(
  id: string,
  quoteId: string
): Promise<AwardResult> {
  const rfqs = await readStore();
  const rfq = rfqs.find((item) => item.id === id);

  if (!rfq) return { ok: false, reason: "not_found" };
  if (rfq.status === "awarded") return { ok: false, reason: "already_awarded" };

  const quote = rfq.quotes.find((item) => item.id === quoteId);

  if (!quote) return { ok: false, reason: "not_found" };

  // Same shared calculation used everywhere else money is shown to the
  // buyer (lib/quote-cost.ts) — the award/PO step used to do its own
  // separate, silently-zero-defaulting math here, which is exactly the
  // audit's finding that the comparison view and the PO could disagree
  // on a quote's real total. Uses the actual quoted quantity, falling
  // back to the buyer's requested quantity only when the supplier left
  // quotedQuantity blank.
  const requestedQuantity = getRequestedQuantity(rfq);
  const cost = calculateQuoteCost(quote, requestedQuantity);

  if (cost.total === null || cost.subtotal === null) {
    // Refuse to fabricate a PO total — the buyer needs to get the
    // missing figure (unit price or quantity) from the supplier before
    // this quote can be awarded, rather than seeing an invented ₹0 or
    // ₹NaN purchase order.
    return { ok: false, reason: "uncomputable" };
  }

  const purchaseOrder: PurchaseOrder = {
    poNumber: `PO-${new Date().getFullYear()}-${Math.floor(
      10000 + Math.random() * 89999
    )}`,
    vendorId: quote.vendorId,
    vendorName: quote.vendorName,
    quoteId: quote.id,
    unitPrice: quote.unitPrice,
    quantity: cost.quantityUsed,
    subtotal: cost.subtotal,
    shippingCost: cost.shippingCost,
    taxPercent: cost.taxPercent,
    taxAmount: cost.taxAmount,
    totalValue: Math.round(cost.total),
    paymentTerms: quote.paymentTerms,
    deliveryBy: resolveDeadlineDate(rfq)?.toISOString().slice(0, 10) ??
      addDays(quote.leadTimeDays),
    createdAt: new Date().toISOString(),
  };

  rfq.purchaseOrder = purchaseOrder;
  rfq.status = "awarded";

  await writeStore(rfqs);

  return { ok: true, rfq };
}

// --- P0 #2: secure supplier invitations ------------------------------

// Issues (or reissues) a secure invitation token for one supplier on
// one RFQ. Called from the buyer's "Copy response link" action — the
// same code path handles first-time issuance and later reissuance, so
// there's only one place tokens ever get minted. Reissuing overwrites
// the supplier's previous tokenHash, which immediately invalidates
// whatever link was generated before (there's no separate "revoked"
// flag — a supplier only ever has one valid token at a time). This is
// also the point at which a supplier's old, guessable `?vendor=` link
// stops working (see resolveInvitationByVendorId below).
export async function issueInvitationToken(
  rfqId: string,
  vendorId: number
): Promise<{ token: string; supplier: InvitedSupplier } | null> {
  const rfqs = await readStore();
  const rfq = rfqs.find((item) => item.id === rfqId);

  if (!rfq) return null;

  const supplierIndex = rfq.suppliers.findIndex(
    (item) => item.vendorId === vendorId
  );

  if (supplierIndex < 0) return null;

  const token = generateInvitationToken();

  rfq.suppliers[supplierIndex] = {
    ...rfq.suppliers[supplierIndex],
    tokenHash: hashInvitationToken(token),
    tokenIssuedAt: new Date().toISOString(),
  };

  await writeStore(rfqs);

  // The plaintext token is only ever available right here — the store
  // only ever persists its hash.
  return { token, supplier: rfq.suppliers[supplierIndex] };
}

export type ResolvedInvitation = {
  rfq: RFQ;
  supplier: InvitedSupplier;
};

// Resolves a supplier's identity from a secure invitation token
// (P0 #2, preferred path). Only ever checks the suppliers invited to
// THIS rfqId — a token is meaningless outside the RFQ/supplier pair it
// was issued for, since it's only ever compared against the hash
// stored on that one InvitedSupplier record, so there's no separate
// cross-RFQ lookup that could leak a match.
export async function resolveInvitationByToken(
  rfqId: string,
  token: string
): Promise<ResolvedInvitation | null> {
  if (!token) return null;

  const rfq = await getRFQ(rfqId);

  if (!rfq) return null;

  const supplier = rfq.suppliers.find(
    (item) => item.tokenHash && verifyInvitationToken(token, item.tokenHash)
  );

  return supplier ? { rfq, supplier } : null;
}

// Legacy fallback for links generated before secure tokens existed
// (`/respond/[id]?vendor=...`). Only resolves for a supplier who has
// NEVER had a secure token issued for them on this RFQ — the moment a
// buyer copies a fresh response link for a supplier
// (issueInvitationToken above), that supplier's old vendorId link stops
// working here and they must use the new token link instead. This lets
// links already shared with real suppliers keep working without
// leaving the guessable path open forever: it closes itself, per
// supplier, the next time a link is (re)shared.
export async function resolveInvitationByVendorId(
  rfqId: string,
  vendorId: number
): Promise<ResolvedInvitation | null> {
  const rfq = await getRFQ(rfqId);

  if (!rfq) return null;

  const supplier = rfq.suppliers.find(
    (item) => item.vendorId === vendorId && !item.tokenHash
  );

  return supplier ? { rfq, supplier } : null;
}

// Strips fields buyer-facing RFQ responses should never leak — the
// invitation token hashes. Safe (and expected) on every RFQ returned
// from a buyer-facing API route (list/get/create/award).
export function toPublicRfq(rfq: RFQ): RFQ {
  return {
    ...rfq,
    suppliers: rfq.suppliers.map((supplier) => ({
      ...supplier,
      tokenHash: null,
      tokenIssuedAt: null,
    })),
  };
}
