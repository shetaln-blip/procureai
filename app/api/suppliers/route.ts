import { NextResponse } from "next/server";
import { getSupplierRepository } from "@/lib/supplier-store";

// Unscored supplier listing — used for name lookups (saved-request
// history, RFQ supplier resolution) that need the catalog but not a
// requirement-driven ranking. See app/api/suppliers/search/route.ts for
// the scored/reasoned search used by the discovery flow.
export async function GET() {
  try {
    const suppliers = await getSupplierRepository().listSuppliers();

    return NextResponse.json({ suppliers });
  } catch (error) {
    console.error("Failed to list suppliers:", error);

    return NextResponse.json(
      { error: "Failed to list suppliers." },
      { status: 500 }
    );
  }
}
