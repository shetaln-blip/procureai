import { NextResponse } from "next/server";
import { getSupplierRepository } from "@/lib/supplier-store";

export type CategoryCount = { category: string; count: number };

// Real category labels straight from the catalog, with a real count —
// no invented taxonomy, just what actually appears on supplier records.
export async function GET() {
  try {
    const suppliers = await getSupplierRepository().listSuppliers();
    const counts = new Map<string, number>();

    for (const supplier of suppliers) {
      for (const rawCategory of supplier.capabilities.categories) {
        const category = rawCategory.trim();
        if (!category) continue;

        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }

    const categories: CategoryCount[] = Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

    return NextResponse.json({ categories });
  } catch (error) {
    console.error("Failed to list supplier categories:", error);

    return NextResponse.json(
      { error: "Failed to load supplier categories." },
      { status: 500 }
    );
  }
}
