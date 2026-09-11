import { NextResponse } from "next/server";
import { addQuote, resolveInvitationByVendorId } from "@/lib/store";
import { parseOptionalNumber, validateQuoteNumbers } from "@/lib/quote-cost";

// Legacy quote-submission endpoint, kept only for `/respond/[id]?vendor=`
// links that predate secure invitation tokens (P0 #2). It now goes
// through the same invitation check the new token-based flow uses
// (app/api/rfqs/[id]/respond/route.ts): a vendorId only authenticates
// here if that supplier has NEVER had a secure token issued. The
// moment a buyer copies a fresh response link for a supplier, this
// endpoint stops accepting submissions for them and they must use the
// token-authenticated link instead. New links always go through
// /api/rfqs/[id]/respond.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const vendorId = Number(body?.vendorId);
    const resolved = await resolveInvitationByVendorId(id, vendorId);

    if (!resolved) {
      return NextResponse.json(
        {
          error:
            "This response link is no longer valid. Ask the buyer to resend it.",
        },
        { status: 403 }
      );
    }

    const { supplier } = resolved;

    const unitPrice = Number(body?.unitPrice);
    const leadTimeDays = Number(body?.leadTimeDays);

    const validationError = validateQuoteNumbers({
      unitPrice: body?.unitPrice,
      leadTimeDays: body?.leadTimeDays,
      quotedQuantity: body?.quotedQuantity,
      moq: body?.moq,
      shippingCost: body?.shippingCost,
      taxPercent: body?.taxPercent,
    });

    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
    }

    const updated = await addQuote(id, {
      vendorId: supplier.vendorId,
      vendorName: supplier.vendorName,
      unitPrice,
      quotedQuantity: parseOptionalNumber(body?.quotedQuantity) ?? 0,
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

    // Scoped ack, not the full RFQ — a responding supplier's browser
    // should never see other invited suppliers' identities or quotes.
    return NextResponse.json({ ok: true, quote: submittedQuote ?? null });
  } catch (error) {
    console.error("Failed to submit quote:", error);

    return NextResponse.json(
      { error: "Failed to submit quote." },
      { status: 500 }
    );
  }
}
