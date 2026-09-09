import { NextResponse } from "next/server";
import { issueInvitationToken } from "@/lib/store";

// Buyer-facing action: (re)issues a secure invitation token for one
// supplier on one RFQ (P0 #2). Called from the "Copy response link"
// button on the RFQ detail page — every time, for both first-time
// issuance and reissuance, so there is exactly one code path that ever
// mints a token. The plaintext token is returned exactly once, in this
// response; only its hash is ever persisted (see lib/store.ts /
// lib/invitations.ts).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; vendorId: string }> }
) {
  try {
    const { id, vendorId } = await params;
    const parsedVendorId = Number(vendorId);

    if (!Number.isFinite(parsedVendorId)) {
      return NextResponse.json(
        { error: "Invalid supplier id." },
        { status: 400 }
      );
    }

    const issued = await issueInvitationToken(id, parsedVendorId);

    if (!issued) {
      return NextResponse.json(
        { error: "RFQ or supplier not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ token: issued.token });
  } catch (error) {
    console.error("Failed to issue invitation token:", error);

    return NextResponse.json(
      { error: "Failed to generate a response link." },
      { status: 500 }
    );
  }
}
