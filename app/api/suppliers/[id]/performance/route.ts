import { NextResponse } from "next/server";
import { getSupplierRepository } from "@/lib/supplier-store";
import { listRFQs } from "@/lib/store";
import { calculateSupplierPerformance } from "@/lib/supplier-performance";

// On-demand derived-performance endpoint (P0 #3). Computes fresh from
// real RFQ/quote/award history every call — nothing here is read from
// or written to data/suppliers.json, and nothing is cached/persisted,
// so this always reflects the current state of the actual procurement
// events. The response is explicitly labeled `source: "derived"` so
// callers never conflate it with the sourced/verified supplier facts
// in the Evidence Drawer.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const vendorId = Number(id);

    if (!Number.isFinite(vendorId)) {
      return NextResponse.json(
        { error: "Invalid supplier id." },
        { status: 400 }
      );
    }

    const supplier = await getSupplierRepository().getSupplier(vendorId);

    if (!supplier) {
      return NextResponse.json(
        { error: "Supplier not found." },
        { status: 404 }
      );
    }

    const rfqs = await listRFQs();
    const performance = calculateSupplierPerformance(vendorId, rfqs);

    return NextResponse.json({
      supplierId: vendorId,
      source: "derived" as const,
      computedAt: new Date().toISOString(),
      performance,
    });
  } catch (error) {
    console.error("Failed to compute supplier performance:", error);

    return NextResponse.json(
      { error: "Failed to compute supplier performance." },
      { status: 500 }
    );
  }
}
