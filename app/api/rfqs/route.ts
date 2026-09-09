import { NextResponse } from "next/server";
import { createRFQ, listRFQs, toPublicRfq } from "@/lib/store";
import { isProcurementRequirement } from "@/lib/extraction/guards";

export async function GET() {
  try {
    const rfqs = await listRFQs();

    return NextResponse.json({ rfqs: rfqs.map(toPublicRfq) });
  } catch (error) {
    console.error("Failed to list RFQs:", error);

    return NextResponse.json(
      { error: "Failed to load RFQs." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query, requirements, suppliers } = body ?? {};

    if (
      !requirements ||
      !Array.isArray(suppliers) ||
      suppliers.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Select at least one supplier and a requirement before sending an RFQ.",
        },
        { status: 400 }
      );
    }

    // The structured requirement (P0 #1) is what makes this RFQ carry
    // the same requirement the buyer actually submitted all the way
    // through to supplier response and comparison. It's optional here
    // only for backward compatibility with any caller that still only
    // has the flat `requirements` shape.
    const structuredRequirement = isProcurementRequirement(
      body?.structuredRequirement
    )
      ? body.structuredRequirement
      : null;

    const rfq = await createRFQ({
      query: typeof query === "string" ? query : "",
      requirements,
      structuredRequirement,
      suppliers,
    });

    return NextResponse.json(toPublicRfq(rfq));
  } catch (error) {
    console.error("Failed to create RFQ:", error);

    return NextResponse.json(
      { error: "Failed to create RFQ." },
      { status: 500 }
    );
  }
}
