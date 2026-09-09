import type { ProcurementRequirement } from "./extraction/schema";

export type Requirements = {
  product: string;
  quantity: string;
  location: string;
  budget: string;
  deadline: string;
  quality: string;
  additionalRequirements: string[];
};

export type InvitedSupplier = {
  vendorId: number;
  vendorName: string;
  status: "invited" | "quoted";
  // Secure invitation credential (P0 #2). `tokenHash` is a SHA-256 hash
  // of the plaintext token handed to this supplier — the plaintext
  // itself is never stored (see lib/invitations.ts). Both fields are
  // null for suppliers invited before this existed, or for suppliers
  // who haven't had a link (re)issued yet; those fall back to the
  // legacy vendorId-based link until a fresh one is copied for them
  // (see issueInvitationToken in lib/store.ts), at which point the
  // legacy link is disabled and this becomes their only valid route in.
  tokenHash: string | null;
  tokenIssuedAt: string | null;
};

export type Quote = {
  id: string;
  vendorId: number;
  vendorName: string;
  unitPrice: number;
  quotedQuantity: number;
  // `null` means the supplier left this blank — never assume a missing
  // MOQ/shipping/tax means 0 (or, for MOQ, means 1). Only an explicit 0
  // means "no minimum" / "free shipping" / "0% tax". See
  // lib/quote-cost.ts, which is the one place these get turned into
  // display text or totals.
  moq: number | null;
  leadTimeDays: number;
  shippingCost: number | null;
  taxPercent: number | null;
  paymentTerms: string;
  validUntil: string;
  notes: string;
  submittedAt: string;
};

export type PurchaseOrder = {
  poNumber: string;
  vendorId: number;
  vendorName: string;
  quoteId: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  shippingCost: number | null;
  taxPercent: number | null;
  taxAmount: number | null;
  totalValue: number;
  paymentTerms: string;
  deliveryBy: string;
  createdAt: string;
};

export type RFQStatus = "draft" | "sent" | "quotes_received" | "awarded";

export type RFQ = {
  id: string;
  query: string;
  requirements: Requirements;
  // The canonical structured requirement (P0 #1) that produced this RFQ,
  // when the request that created it went through the extraction
  // pipeline (lib/extraction). `requirements` above is kept as a
  // projection derived from this (see toLegacyRequirements in
  // lib/extraction/legacy-adapter.ts) rather than an independently
  // maintained duplicate, so every existing reader of the flat fields
  // (matching, scoring, older UI) keeps working unmodified. RFQs
  // created before this field existed, or from a raw flat-field POST
  // body with no structured requirement attached, have this as null —
  // the UI falls back to the flat fields for them.
  structuredRequirement: ProcurementRequirement | null;
  suppliers: InvitedSupplier[];
  quotes: Quote[];
  status: RFQStatus;
  purchaseOrder: PurchaseOrder | null;
  createdAt: string;
};
