import { NextResponse } from "next/server";
import { getRFQ, listRFQs, toPublicRfq } from "@/lib/store";
import { getSupplierRepository } from "@/lib/supplier-store";
import { calculateSupplierPerformance } from "@/lib/supplier-performance";
import type { DataConfidence } from "@/lib/supplier-types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rfq = await getRFQ(id);

    if (!rfq) {
      return NextResponse.json(
        { error: "RFQ not found." },
        { status: 404 }
      );
    }

    // Additive fields only — nothing here touches the RFQ record, its
    // security fields, or the `RFQ` type itself (Quote Intelligence
    // Audit's ranking factor "supplier confidence and evidence quality",
    // plus the "supplier-specific historical price" price-intelligence
    // item). Both are plain reads of already-public supplier data keyed
    // by the vendorIds already on this RFQ, so this carries none of the
    // invitation-token/auth logic in lib/store.ts.
    const vendorIds = Array.from(
      new Set(rfq.suppliers.map((supplier) => supplier.vendorId))
    );

    const repo = getSupplierRepository();
    const supplierConfidence: Record<number, DataConfidence | null> = {};

    await Promise.all(
      vendorIds.map(async (vendorId) => {
        const supplier = await repo.getSupplier(vendorId);
        supplierConfidence[vendorId] =
          supplier?.intelligence.dataConfidence ?? null;
      })
    );

    const allRfqs = await listRFQs();
    const supplierHistoricalPrice: Record<number, number | null> = {};
    const supplierHistoricalQuoteCount: Record<number, number> = {};

    for (const vendorId of vendorIds) {
      const performance = calculateSupplierPerformance(vendorId, allRfqs);
      supplierHistoricalPrice[vendorId] = performance.averageQuotedPrice;
      supplierHistoricalQuoteCount[vendorId] = performance.quotesSubmitted;
    }

    return NextResponse.json({
      ...toPublicRfq(rfq),
      supplierConfidence,
      supplierHistoricalPrice,
      supplierHistoricalQuoteCount,
    });
  } catch (error) {
    console.error("Failed to load RFQ:", error);

    return NextResponse.json(
      { error: "Failed to load RFQ." },
      { status: 500 }
    );
  }
}
