import { NextResponse } from "next/server";
import {
  addQuote,
  resolveInvitationByToken,
  resolveInvitationByVendorId,
  type ResolvedInvitation,
} from "@/lib/store";
import { toSupplierFacingRequirement } from "@/lib/extraction/supplier-view";
import { parseOptionalNumber } from "@/lib/quote-cost";

// The single endpoint the public /respond/[id] page talks to (P0 #1 +
// P0 #2). Authenticates every request against the supplier's own
// invitation — a secure token when present (`?token=`), falling back
// to the legacy vendorId (`?vendor=`) only for suppliers who have never
// had a secure token issued (see resolveInvitationByVendorId). Every
// response is scoped to that one supplier's own invitation: it never
// includes other invited suppliers' identities, statuses, or quotes,
// and the structured requirement it returns has confidence metadata
// stripped out (see toSupplierFacingRequirement).
async function resolveFromRequest(
  rfqId: string,
  url: URL
): Promise<ResolvedInvitation | null> {
  const token = url.searchParams.get("token");

  if (token) {
    return resolveInvitationByToken(rfqId, token);
  }

  const vendorParam = url.searchParams.get("vendor");
  const vendorId = vendorParam ? Number(vendorParam) : NaN;

  if (Number.isFinite(vendorId)) {
    return resolveInvitationByVendorId(rfqId, vendorId);
  }

  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const resolved = await resolveFromRequest(id, new URL(request.url));

    if (!resolved) {
      return NextResponse.json(
        {
          error:
            "This invitation link is invalid or no longer active. Ask the buyer to resend it.",
        },
        { status: 404 }
      );
    }

    const { rfq, supplier } = resolved;
    const existingQuote =
      rfq.quotes.find((quote) => quote.vendorId === supplier.vendorId) ??
      null;

    return NextResponse.json({
      rfqId: rfq.id,
      status: rfq.status,
      supplierName: supplier.vendorName,
      // Flat fallback for RFQs created before the structured
      // requirement existed.
      requirements: rfq.requirements,
      structuredRequirement: rfq.structuredRequirement
        ? toSupplierFacingRequirement(rfq.structuredRequirement)
        : null,
      existingQuote,
    });
  } catch (error) {
    console.error("Failed to load invitation:", error);

    return NextResponse.json(
      { error: "Failed to load this invitation." },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const resolved = await resolveFromRequest(id, new URL(request.url));

    if (!resolved) {
      return NextResponse.json(
        {
          error:
            "This invitation link is invalid or no longer active. Ask the buyer to resend it.",
        },
        { status: 404 }
      );
    }

    const { supplier } = resolved;
    const body = await request.json();

    const unitPrice = Number(body?.unitPrice);
    const leadTimeDays = Number(body?.leadTimeDays);

    if (!unitPrice || unitPrice <= 0 || !leadTimeDays || leadTimeDays <= 0) {
      return NextResponse.json(
        { error: "Unit price and lead time are required." },
        { status: 400 }
      );
    }

    // addQuote is keyed on supplier.vendorId taken from the AUTHENTICATED
    // invitation, never from the request body — a supplier cannot submit
    // a quote on behalf of another invited supplier no matter what a
    // tampered request body claims.
    const updated = await addQuote(id, {
      vendorId: supplier.vendorId,
      vendorName: supplier.vendorName,
      unitPrice,
      quotedQuantity: Number(body?.quotedQuantity) || 0,
      // Missing/blank stays `null`, not 0 — see lib/quote-cost.ts. Only
      // an explicit 0 means "no minimum" / "free shipping" / "0% tax".
      moq: parseOptionalNumber(body?.moq),
      leadTimeDays,
      shippingCost: parseOptionalNumber(body?.shippingCost),
      taxPercent: parseOptionalNumber(body?.taxPercent),
      paymentTerms:
        typeof body?.paymentTerms === "string" && body.paymentTerms
          ? body.paymentTerms
          : "Not specified",
      validUntil:
        typeof body?.validUntil === "string" ? body.validUntil : "",
      notes: typeof body?.notes === "string" ? body.notes : "",
    });

    if (!updated) {
      return NextResponse.json(
        { error: "This RFQ is no longer available." },
        { status: 404 }
      );
    }

    const submittedQuote = updated.quotes.find(
      (quote) => quote.vendorId === supplier.vendorId
    );

    // Scoped ack — never the full RFQ.
    return NextResponse.json({ ok: true, quote: submittedQuote ?? null });
  } catch (error) {
    console.error("Failed to submit quote:", error);

    return NextResponse.json(
      { error: "Failed to submit quote." },
      { status: 500 }
    );
  }
}
