import type { RFQ } from "./rfq-types";

// Resolves the buyer's actual required-by date from the canonical
// structured requirement (P0 #1), for comparing against a quote's lead
// time (Quote Intelligence Audit, "do not invent delivery dates").
//
// Only ever computed from real stored fields:
//  - "absolute" timeframes use the resolved calendar date.
//  - "relative" timeframes ("within 20 days") are anchored to the RFQ's
//    own createdAt — not "today" — so a 20-day deadline stays fixed to
//    when the buyer actually asked, rather than silently sliding forward
//    every time someone reloads the page.
//  - "urgent" (a vague "ASAP" with no stated number of days) and
//    anything unextracted resolve to `null` — there is no date to
//    invent, so deadline-compatibility for that RFQ is simply unknown,
//    never assumed met or missed.
export function resolveDeadlineDate(rfq: RFQ): Date | null {
  const timeframe = rfq.structuredRequirement?.deliveryTimeframe;
  if (!timeframe) return null;

  if (timeframe.kind === "absolute" && timeframe.absoluteDate) {
    const parsed = new Date(timeframe.absoluteDate);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  if (timeframe.kind === "relative" && typeof timeframe.relativeDays === "number") {
    const created = new Date(rfq.createdAt);
    const base = Number.isFinite(created.getTime()) ? created : new Date();
    const deadline = new Date(base);
    deadline.setDate(deadline.getDate() + timeframe.relativeDays);
    return deadline;
  }

  return null;
}
