import { NextResponse } from "next/server";
import { awardRFQ, toPublicRfq } from "@/lib/store";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!body?.quoteId || typeof body.quoteId !== "string") {
      return NextResponse.json(
        { error: "A quoteId is required to award this RFQ." },
        { status: 400 }
      );
    }

    const result = await awardRFQ(id, body.quoteId);

    if (!result.ok) {
      if (result.reason === "uncomputable") {
        return NextResponse.json(
          {
            error:
              "Can't generate a purchase order — this quote is missing information (unit price or quantity) needed to calculate a total cost. Ask the supplier to provide it before awarding.",
          },
          { status: 422 }
        );
      }

      return NextResponse.json(
        { error: "RFQ or quote not found." },
        { status: 404 }
      );
    }

    return NextResponse.json(toPublicRfq(result.rfq));
  } catch (error) {
    console.error("Failed to award RFQ:", error);

    return NextResponse.json(
      { error: "Failed to award RFQ." },
      { status: 500 }
    );
  }
}
