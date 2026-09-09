"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MatchedSupplier, SearchMeta } from "@/lib/matching";
import type { ProcurementRequirement } from "@/lib/extraction/schema";
import type { SupplierPerformance } from "@/lib/supplier-types";

// Realistic, person-centered example requests (Quote Intelligence
// Audit's companion product change) — replacing the old broad category
// words ("Packaging boxes"), which produced a generic, near-identical
// query for every click ("I need reliable X from suppliers in India")
// and were the actual source of the "From Suppliers" text bug in the
// old product-derivation logic. Each `query` here is a complete request
// carrying real quantity/use-case/location/deadline/budget detail, the
// same kind of request the extraction pipeline (lib/extraction) and
// matching (lib/matching.ts) are built to understand.
const suggestions: { label: string; query: string }[] = [
  {
    label: "Custom boxes for cosmetics",
    query:
      "I need 500 recyclable custom 5-ply corrugated boxes for cosmetics shipping, delivered to Hyderabad within 3 weeks, under ₹12 per box",
  },
  {
    label: "Ergonomic office chairs",
    query:
      "I need 20 ergonomic office chairs for a new office in Bengaluru, delivered within 20 days",
  },
  {
    label: "CNC milling machines",
    query:
      "I need 25 five-axis CNC milling machines for our manufacturing unit",
  },
];

export type Requirements = {
  product: string;
  quantity: string;
  location: string;
  budget: string;
  deadline: string;
  quality: string;
  additionalRequirements: string[];
  // The rich structured requirement from /api/analyze (lib/extraction),
  // when present — carried through so a saved/reopened request still
  // drives request-dependent supplier matching (see lib/matching.ts)
  // rather than falling back to these flat fields alone. Optional so
  // this stays compatible with any request saved before this existed.
  structured?: ProcurementRequirement | null;
};

type SavedRequest = {
  id: string;
  query: string;
  requirements: Requirements;
  createdAt: string;
  topVendorIds: number[];
};

const emptyRequirements: Requirements = {
  product: "",
  quantity: "",
  location: "",
  budget: "",
  deadline: "",
  quality: "",
  additionalRequirements: [],
};

// Shared style tokens — keeps the "no filled pills, no soft shadows"
// design language consistent across every card/chip/button in this file.
const chip =
  "rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600";
const pillPrimary =
  "rounded-full bg-amber-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50";
const pillDark =
  "rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800";
const pillOutline =
  "rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950";

// Supplier fields are increasingly `string | null` now that they carry
// real (possibly missing) public data instead of always-filled placeholder
// text — this keeps the display fallback consistent everywhere.
function orNotPublic(value: string | null): string {
  return value ?? "Not publicly listed";
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

// The "complete procurement intent" brief (Quote Intelligence Audit's
// companion product change) — replaces the old "We understood your
// requirement" display, which showed only the bare product category.
// Built ONLY from fields the extraction pipeline actually populated
// (lib/extraction) or, for RFQs saved before it existed, the flat
// legacy fields already derived from it — every clause is omitted, not
// guessed, when its field is null. This is deliberately a thin
// presentation layer over the canonical structured requirement, not a
// second place that re-derives meaning from raw text.
export function buildProcurementBrief(req: Requirements): string {
  const structured = req.structured ?? null;
  const specs = structured?.specifications;

  const descriptors = specs
    ? [
        ...specs.sustainabilityRequirements,
        ...specs.customizationRequirements,
        ...specs.construction,
      ]
    : [];

  const productName = structured?.product.value ?? req.product;

  const headParts = [req.quantity, descriptors.join(" "), productName].filter(
    (part) => part && part.trim().length > 0
  );

  let brief = headParts.join(" ").trim();

  if (!brief) return "Not specified";

  const useCase = structured?.intendedUse.value ?? null;
  const tailClauses = [
    useCase ? `for ${useCase}` : null,
    req.location ? `delivered to ${req.location}` : null,
    req.deadline ? lowerFirst(req.deadline) : null,
    req.budget ? lowerFirst(req.budget) : null,
  ].filter((clause): clause is string => Boolean(clause));

  if (tailClauses.length > 0) {
    brief += " " + tailClauses.join(", ");
  }

  return brief;
}

// "Specifications" for the brief grid — material/construction/
// certifications only (quality/sustainability/customization already
// have their own, more prominent home in the brief sentence and the
// "Additional requirements" panel below), so this stays a genuinely
// distinct row rather than repeating the same words twice.
export function buildSpecificationsSummary(req: Requirements): string {
  const specs = req.structured?.specifications;

  if (!specs) return "Not specified";

  const parts = [
    specs.material.value,
    ...specs.construction,
    ...specs.certifications,
  ].filter((part): part is string => Boolean(part && part.trim()));

  return parts.length > 0 ? parts.join(", ") : "Not specified";
}

// Renders a derived performance fraction (P0 #3) — null means there
// wasn't enough real activity to compute it, never 0%.
function formatPerformancePercent(value: number | null): string {
  return value === null ? "Not enough data yet" : `${Math.round(value * 100)}%`;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

// Match tier — how relevant a supplier is to THIS specific requirement
// (see lib/matching.ts). Deliberately separate from data confidence
// above: a supplier can have great public evidence and still be a weak
// match for what's being bought, or vice versa.
const TIER_LABEL: Record<string, string> = {
  strong: "Strong match",
  potential: "Potential match",
  weak: "Weak match — verify capability",
};

const TIER_BADGE_CLASS: Record<string, string> = {
  strong: "text-emerald-700",
  potential: "text-amber-700",
  weak: "text-zinc-500",
};

// Human-readable labels for the dot-path field ids that
// lib/ingestion/normalize.ts records against each source (e.g.
// "identity.companyName"). Falls back to a readable version of the raw
// path for anything not listed here, so a future source citing a field
// this map doesn't know about still renders something sensible.
const EVIDENCE_FIELD_LABELS: Record<string, string> = {
  "identity.companyName": "Company name",
  "identity.legalName": "Legal name",
  "identity.website": "Website",
  "identity.contact.email": "Email",
  "identity.contact.phone": "Phone",
  "identity.location": "Location",
  "identity.citiesServed": "Cities served",
  "capabilities.categories": "Category",
  "capabilities.products": "Products",
  "capabilities.productDescription": "Product description",
  "capabilities.manufacturingStatus": "Manufacturing status",
  "capabilities.manufacturingCapabilities": "Manufacturing capabilities",
  "capabilities.customizationCapabilities": "Customization capabilities",
  "capabilities.industriesServed": "Industries served",
  "capabilities.capacity": "Capacity",
  "commercial.moq": "Minimum order quantity",
  "commercial.priceRange": "Pricing",
  "commercial.leadTime": "Lead time",
  "commercial.shippingRegions": "Shipping regions",
  "commercial.paymentTerms": "Payment terms",
  "compliance.certifications": "Certifications",
  "compliance.gstNumber": "GST registration",
  "compliance.isoCertifications": "ISO certifications",
};

function evidenceFieldLabel(field: string): string {
  return (
    EVIDENCE_FIELD_LABELS[field] ||
    field
      .split(".")
      .pop()!
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (char) => char.toUpperCase())
  );
}

type EvidenceItem = {
  fieldLabel: string;
  sourceName: string;
  sourceUrl: string;
  retrievedAt: string;
};

// Flattens a supplier's sources into one row per (field, source) pair —
// this is the data behind the evidence drawer in the supplier detail
// modal. A supplier with no sources yields an empty array, which the
// modal renders as "No public evidence available" rather than inventing
// anything to fill the gap.
function buildEvidenceItems(vendor: MatchedSupplier): EvidenceItem[] {
  return vendor.intelligence.sources.flatMap((source) =>
    source.fields.map((field) => ({
      fieldLabel: evidenceFieldLabel(field),
      sourceName: source.sourceName,
      sourceUrl: source.url,
      retrievedAt: source.retrievedAt,
    }))
  );
}

function formatEvidenceDate(date: string): string {
  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) return "Unknown date";

  return parsed.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(
    null
  );
  const [performance, setPerformance] =
    useState<SupplierPerformance | null>(null);
  // Which vendor `performance` was actually fetched for — used to derive
  // the loading state below during render rather than setState-ing a
  // separate flag synchronously inside the effect.
  const [performanceForVendorId, setPerformanceForVendorId] = useState<
    number | null
  >(null);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [requirements, setRequirements] =
    useState<Requirements>(emptyRequirements);
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([]);
  const [showRequests, setShowRequests] = useState(false);
  const [rfqCount, setRfqCount] = useState(0);
  const [sendingRFQ, setSendingRFQ] = useState(false);
  const [matchedSuppliers, setMatchedSuppliers] = useState<
    MatchedSupplier[]
  >([]);
  const [matchMeta, setMatchMeta] = useState<SearchMeta | null>(null);
  // id -> company name for every supplier in the catalog, independent of
  // the current search. Needed for the saved-requests dashboard, which can
  // reference suppliers from a past search that isn't the current result
  // set.
  const [supplierNames, setSupplierNames] = useState<Record<number, string>>(
    {}
  );

  // Load saved requests (client-only — deferred to an effect on purpose,
  // so the first client render matches the server-rendered HTML before
  // localStorage is read).
  useEffect(() => {
    try {
      const stored = localStorage.getItem("procureai_requests");

      if (stored) {
        const parsed = JSON.parse(stored);

        if (Array.isArray(parsed)) {
          setSavedRequests(parsed);
        }
      }
    } catch (error) {
      console.error("Could not load saved requests:", error);
    }
  }, []);

  // Load RFQ count for the nav badge
  useEffect(() => {
    fetch("/api/rfqs")
      .then((res) => (res.ok ? res.json() : { rfqs: [] }))
      .then((data) => setRfqCount(Array.isArray(data.rfqs) ? data.rfqs.length : 0))
      .catch(() => setRfqCount(0));
  }, []);

  // Load the full supplier catalog once for id -> name lookups (saved
  // requests, RFQ recipient names). The scored/reasoned catalog for the
  // active search lives in `matchedSuppliers` instead — this is just names.
  useEffect(() => {
    fetch("/api/suppliers")
      .then((res) => (res.ok ? res.json() : { suppliers: [] }))
      .then((data) => {
        const suppliers: MatchedSupplier[] = Array.isArray(data.suppliers)
          ? data.suppliers
          : [];

        const names: Record<number, string> = {};

        for (const supplier of suppliers) {
          names[supplier.id] = supplier.identity.companyName;
        }

        setSupplierNames(names);
      })
      .catch(() => setSupplierNames({}));
  }, []);

  const persistRequests = (requests: SavedRequest[]) => {
    setSavedRequests(requests);

    try {
      localStorage.setItem(
        "procureai_requests",
        JSON.stringify(requests)
      );
    } catch (error) {
      console.error("Could not save requests:", error);
    }
  };

  const handleAnalyze = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setShowResults(false);
    setSelectedVendorId(null);
    setCompareIds([]);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });

      const text = await response.text();

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          "The analysis service returned an invalid response."
        );
      }

      if (!response.ok) {
        throw new Error(data.error || "Failed to analyze request.");
      }

      setRequirements(data);

      const searchResponse = await fetch("/api/suppliers/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const searchData = await searchResponse.json();

      setMatchedSuppliers(
        Array.isArray(searchData.suppliers) ? searchData.suppliers : []
      );
      setMatchMeta(searchData.meta ?? null);
      setShowResults(true);

      setTimeout(() => {
        document
          .getElementById("suppliers")
          ?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      }, 100);
    } catch (error) {
      console.error(error);

      alert(
        error instanceof Error
          ? error.message
          : "Something went wrong while analyzing your request."
      );
    } finally {
      setLoading(false);
    }
  };

  const selectedVendor =
    matchedSuppliers.find(
      (vendor) => vendor.id === selectedVendorId
    ) || null;

  // Derived supplier performance (P0 #3) — fetched fresh on demand
  // whenever the detail modal opens for a real supplier (not the -1
  // sentinel used for the comparison modal). Computed from real
  // RFQ/quote/award history each time; never cached against stale data.
  useEffect(() => {
    if (selectedVendorId === null || selectedVendorId === -1) {
      return;
    }

    let cancelled = false;

    fetch(`/api/suppliers/${selectedVendorId}/performance`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setPerformance(data?.performance ?? null);
        setPerformanceForVendorId(selectedVendorId);
      })
      .catch(() => {
        if (cancelled) return;
        setPerformance(null);
        setPerformanceForVendorId(selectedVendorId);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedVendorId]);

  const performanceLoading =
    selectedVendorId !== null &&
    selectedVendorId !== -1 &&
    performanceForVendorId !== selectedVendorId;

  const comparisonVendors =
    matchedSuppliers.filter((vendor) =>
      compareIds.includes(vendor.id)
    );

  // Suppliers actually worth showing as candidates for THIS requirement.
  // "no_match" suppliers have no evidence of relevance at all (see
  // lib/matching.ts) — they're accounted for in matchMeta's counts, not
  // rendered here, so an unrelated request doesn't read as "these are
  // our recommendations."
  const visibleSuppliers = matchedSuppliers.filter(
    (vendor) => vendor.tier !== "no_match"
  );

  const toggleCompare = (id: number) => {
    setCompareIds((current) => {
      if (current.includes(id)) {
        return current.filter(
          (vendorId) => vendorId !== id
        );
      }

      if (current.length >= 5) {
        alert("You can select up to 5 suppliers at once.");
        return current;
      }

      return [...current, id];
    });
  };

  const handleSendRFQ = async () => {
    if (compareIds.length === 0) return;

    setSendingRFQ(true);

    try {
      const suppliers = compareIds.map((id) => {
        const vendor = matchedSuppliers.find((v) => v.id === id);

        return {
          vendorId: id,
          vendorName: vendor?.identity.companyName || "Supplier",
        };
      });

      const response = await fetch("/api/rfqs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          requirements,
          // Carries the structured requirement through to the RFQ
          // itself (P0 #1) so the supplier ends up quoting against the
          // same requirement the buyer submitted, not just a flat
          // string projection of it.
          structuredRequirement: requirements.structured ?? null,
          suppliers,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send RFQ.");
      }

      router.push(`/rfqs/${data.id}`);
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Something went wrong while sending the RFQ."
      );
    } finally {
      setSendingRFQ(false);
    }
  };

  const saveCurrentRequest = () => {
    if (!query.trim() || !showResults) return;

    const alreadySaved = savedRequests.some(
      (request) =>
        request.query.trim().toLowerCase() ===
        query.trim().toLowerCase()
    );

    if (alreadySaved) {
      alert("This request is already saved.");
      return;
    }

    const newRequest: SavedRequest = {
      id: Date.now().toString(),
      query: query.trim(),
      requirements,
      createdAt: new Date().toISOString(),
      topVendorIds: visibleSuppliers
        .slice(0, 3)
        .map((vendor) => vendor.id),
    };

    persistRequests([
      newRequest,
      ...savedRequests,
    ]);

    alert("Request saved successfully.");
  };

  const openSavedRequest = async (
    request: SavedRequest
  ) => {
    setQuery(request.query);
    setRequirements(request.requirements);
    setShowRequests(false);
    setSelectedVendorId(null);
    setCompareIds([]);

    try {
      const response = await fetch("/api/suppliers/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request.requirements),
      });

      const data = await response.json();

      setMatchedSuppliers(
        Array.isArray(data.suppliers) ? data.suppliers : []
      );
      setMatchMeta(data.meta ?? null);
    } catch {
      setMatchedSuppliers([]);
      setMatchMeta(null);
    }

    setShowResults(true);

    setTimeout(() => {
      document
        .getElementById("suppliers")
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    }, 100);
  };

  const deleteSavedRequest = (id: string) => {
    const updated = savedRequests.filter(
      (request) => request.id !== id
    );

    persistRequests(updated);
  };

  const clearAllRequests = () => {
    if (savedRequests.length === 0) return;

    const confirmed = window.confirm(
      "Are you sure you want to delete all saved requests?"
    );

    if (!confirmed) return;

    persistRequests([]);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(
      "en-IN",
      {
        day: "numeric",
        month: "short",
        year: "numeric",
      }
    );
  };

  const getVendorName = (id: number) => {
    return supplierNames[id] || "Supplier";
  };

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">

      {/* NAVBAR */}
      <nav className="bg-zinc-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-5">

          <button
            onClick={() => {
              setShowRequests(false);

              window.scrollTo({
                top: 0,
                behavior: "smooth",
              });
            }}
            className="font-display text-xl font-semibold tracking-tight text-white"
          >
            Procure<span className="text-amber-500">AI</span>
          </button>

          <div className="flex items-center gap-8 text-sm text-zinc-400">

            <button
              onClick={() => {
                setShowRequests(false);

                window.scrollTo({
                  top: 0,
                  behavior: "smooth",
                });
              }}
              className="transition hover:text-white"
            >
              Dashboard
            </button>

            <a
              href="#suppliers"
              className="transition hover:text-white"
            >
              Vendors
            </a>

            <button
              onClick={() => setShowRequests(true)}
              className="relative flex items-center gap-2 transition hover:text-white"
            >
              Requests

              {savedRequests.length > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold text-zinc-950">
                  {savedRequests.length}
                </span>
              )}
            </button>

            <Link
              href="/rfqs"
              className="relative flex items-center gap-2 transition hover:text-white"
            >
              RFQs

              {rfqCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold text-zinc-950">
                  {rfqCount}
                </span>
              )}
            </Link>

            <button
              onClick={() => {
                setShowRequests(false);

                document
                  .getElementById("procurement-search")
                  ?.scrollIntoView({
                    behavior: "smooth",
                  });
              }}
              className="rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400"
            >
              Get started
            </button>

          </div>
        </div>
      </nav>

      {/* REQUESTS DASHBOARD */}
      {showRequests && (
        <section className="mx-auto max-w-6xl px-8 py-16">

          <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">

            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Procurement workspace
              </div>

              <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
                Saved requests
              </h1>

              <p className="mt-3 text-zinc-500">
                Revisit previous procurement requirements
                and supplier matches.
              </p>
            </div>

            <div className="flex gap-3">

              {savedRequests.length > 0 && (
                <button
                  onClick={clearAllRequests}
                  className={pillOutline}
                >
                  Clear all
                </button>
              )}

              <button
                onClick={() => setShowRequests(false)}
                className={pillDark}
              >
                New request
              </button>

            </div>
          </div>

          {savedRequests.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-300 bg-white px-8 py-20 text-center">

              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-zinc-200 text-2xl text-zinc-400">
                +
              </div>

              <h2 className="mt-5 font-display text-xl font-semibold">
                No saved requests yet
              </h2>

              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">
                Analyze a procurement requirement and
                save it here to build your procurement
                history.
              </p>

              <button
                onClick={() => setShowRequests(false)}
                className={`mt-6 ${pillPrimary}`}
              >
                Create your first request
              </button>

            </div>
          ) : (
            <div className="grid gap-4">

              {savedRequests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-md border border-zinc-200 bg-white p-6"
                >

                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">

                    <div className="min-w-0">

                      <div className="flex flex-wrap items-center gap-3">

                        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                          Procurement request
                        </span>

                        <span className="text-xs text-zinc-400">
                          {formatDate(request.createdAt)}
                        </span>

                      </div>

                      <h3 className="mt-3 font-display text-lg font-semibold">
                        {request.requirements.product ||
                          request.query}
                      </h3>

                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-500">
                        {request.query}
                      </p>

                      <div className="mt-4 flex flex-wrap gap-2">

                        {request.requirements.quantity && (
                          <span className={chip}>
                            {request.requirements.quantity}
                          </span>
                        )}

                        {request.requirements.location && (
                          <span className={chip}>
                            {request.requirements.location}
                          </span>
                        )}

                        {request.requirements.budget && (
                          <span className={chip}>
                            {request.requirements.budget}
                          </span>
                        )}

                        {request.requirements.deadline && (
                          <span className={chip}>
                            {request.requirements.deadline}
                          </span>
                        )}

                      </div>

                      {/* TOP SUPPLIERS */}
                      {request.topVendorIds.length > 0 && (
                        <div className="mt-5">

                          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                            Top supplier matches
                          </p>

                          <div className="mt-2 flex flex-wrap gap-2">

                            {request.topVendorIds.map(
                              (vendorId, index) => (
                                <span
                                  key={vendorId}
                                  className={chip}
                                >
                                  #{index + 1}{" "}
                                  {getVendorName(vendorId)}
                                </span>
                              )
                            )}

                          </div>
                        </div>
                      )}

                    </div>

                    <div className="flex shrink-0 gap-2">

                      <button
                        onClick={() =>
                          openSavedRequest(request)
                        }
                        className={pillDark}
                      >
                        Open request
                      </button>

                      <button
                        onClick={() =>
                          deleteSavedRequest(request.id)
                        }
                        className="rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-500 transition hover:border-red-300 hover:text-red-600"
                      >
                        Delete
                      </button>

                    </div>

                  </div>
                </div>
              ))}

            </div>
          )}

        </section>
      )}

      {/* MAIN DASHBOARD */}
      {!showRequests && (
        <>
          {/* HERO */}
          <section
            id="procurement-search"
            className="bg-zinc-950 pb-24 pt-16"
          >

            <div className="mx-auto max-w-5xl px-8">

              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                AI Procurement Intelligence
              </div>

              <h1 className="mt-5 max-w-2xl font-display text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
                What do you need to{" "}
                <span className="text-amber-500">
                  procure?
                </span>
              </h1>

              <p className="mt-6 max-w-xl text-lg leading-8 text-zinc-400">
                Describe what you&apos;re looking for in plain
                English. ProcureAI will understand your
                requirements and find the best supplier
                matches.
              </p>

            </div>

            {/* SEARCH — floats up over the hero/workspace boundary */}
            <div className="relative z-10 mx-auto -mb-24 mt-10 max-w-4xl px-8">

              <div className="rounded-md border border-zinc-200 bg-white p-3">

                <textarea
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setShowResults(false);
                  }}
                  placeholder="Example: I need 500 recyclable custom 5-ply boxes for cosmetics shipping, delivered to Hyderabad within 3 weeks, under ₹12 per box..."
                  className="min-h-32 w-full resize-none border-none bg-transparent px-4 py-3 text-lg outline-none placeholder:text-zinc-400"
                />

                <div className="flex items-center justify-between border-t border-zinc-100 px-3 pt-3">

                  <div className="text-sm text-zinc-400">
                    {query.length > 0
                      ? `${query.length} characters`
                      : "Describe your procurement requirement"}
                  </div>

                  <button
                    onClick={handleAnalyze}
                    disabled={loading}
                    className={pillPrimary}
                  >
                    {loading
                      ? "Analyzing…"
                      : "Find suppliers"}
                  </button>

                </div>
              </div>
            </div>
          </section>

          <div className="mx-auto max-w-5xl px-8">
            <div className="mx-auto max-w-4xl pt-28">

              {/* SUGGESTIONS */}
              <div className="flex flex-wrap justify-center gap-3">

                <span className="mr-1 py-2 text-sm text-zinc-400">
                  Try searching:
                </span>

                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    onClick={() => setQuery(suggestion.query)}
                    className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950"
                  >
                    {suggestion.label}
                  </button>
                ))}

              </div>

              {/* RESULTS */}
              {showResults && (
                <div
                  id="suppliers"
                  className="mt-12 pb-24"
                >

                  {/* REQUIREMENT */}
                  <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">

                    <div>
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Procurement intelligence
                      </div>

                      <h2 className="mt-2 font-display text-2xl font-semibold">
                        We understood your requirement
                      </h2>
                    </div>

                    <button
                      onClick={saveCurrentRequest}
                      className={pillOutline}
                    >
                      Save request
                    </button>

                  </div>

                  {/* Concise, human-readable procurement brief — the
                      complete intent in one line, not just the product
                      category. Never fabricates a clause for a field
                      that wasn't actually stated. */}
                  <p className="mb-6 max-w-3xl text-lg leading-8 text-zinc-700">
                    {buildProcurementBrief(requirements)}
                  </p>

                  <div className="mb-10 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">

                    <Requirement
                      label="Quantity"
                      value={
                        requirements.quantity ||
                        "Not specified"
                      }
                    />

                    <Requirement
                      label="Destination"
                      value={
                        requirements.location ||
                        "Not specified"
                      }
                    />

                    <Requirement
                      label="Deadline"
                      value={
                        requirements.deadline ||
                        "Not specified"
                      }
                    />

                    <Requirement
                      label="Budget"
                      value={
                        requirements.budget ||
                        "Not specified"
                      }
                    />

                    <Requirement
                      label="Specifications"
                      value={buildSpecificationsSummary(requirements)}
                    />

                    <Requirement
                      label="Use case"
                      value={
                        requirements.structured?.intendedUse.value ||
                        "Not specified"
                      }
                    />

                  </div>

                  {/* EXTRA REQUIREMENTS — Deadline and Specifications now
                      have their own row in the brief grid above, so this
                      panel is just the remaining raw detail (packaging,
                      shipping, capability, and certification phrases)
                      that doesn't fit a dedicated row. */}
                  {requirements.additionalRequirements.length > 0 && (

                    <div className="mb-10 rounded-md border border-zinc-200 bg-white p-6">

                      <h3 className="font-display font-semibold">
                        Additional requirements
                      </h3>

                      <div className="mt-5 flex flex-wrap gap-2">

                        {requirements.additionalRequirements.map(
                          (requirement, index) => (
                            <span
                              key={index}
                              className={chip}
                            >
                              {requirement}
                            </span>
                          )
                        )}

                      </div>

                    </div>
                  )}

                  {/* SUPPLIER HEADER */}
                  <div className="mb-6 flex items-end justify-between">

                    <div>
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Supplier intelligence
                      </div>

                      <h2 className="mt-2 font-display text-2xl font-semibold">
                        Best matches for your requirement
                      </h2>
                    </div>

                    <div className="text-right">
                      <span className="text-sm text-zinc-500">
                        {matchedSuppliers.length} suppliers analyzed
                      </span>
                      {matchMeta?.searchRegion && (
                        <p className="text-xs text-zinc-400">
                          Searching {matchMeta.searchRegion}-wide
                          {requirements.location
                            ? ` · prioritizing ${requirements.location}`
                            : ""}
                        </p>
                      )}
                    </div>

                  </div>

                  {/* FALLBACK / DATASET-COVERAGE MESSAGE — shown instead
                      of pretending irrelevant suppliers are good matches
                      when the database doesn't have enough (or any)
                      strong matches for this specific requirement. */}
                  {matchMeta?.message && (
                    <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
                      {matchMeta.message}
                    </div>
                  )}

                  {/* COMPARISON BAR */}
                  {compareIds.length > 0 && (
                    <div className="sticky top-4 z-20 mb-6 flex items-center justify-between rounded-md bg-zinc-950 px-5 py-4">

                      <div>
                        <p className="text-sm font-semibold text-white">
                          <span className="text-amber-500">
                            {compareIds.length}
                          </span>{" "}
                          supplier
                          {compareIds.length > 1
                            ? "s"
                            : ""}{" "}
                          selected
                        </p>

                        <p className="text-xs text-zinc-400">
                          Compare side-by-side, or send them an RFQ
                        </p>
                      </div>

                      <div className="flex gap-3">

                        <button
                          onClick={() => {
                            if (compareIds.length < 2) {
                              alert(
                                "Select at least 2 suppliers to compare."
                              );
                              return;
                            }

                            setSelectedVendorId(-1);
                          }}
                          className="rounded-full border border-zinc-700 px-5 py-2.5 text-sm font-medium text-white transition hover:border-white"
                        >
                          Compare suppliers
                        </button>

                        <button
                          onClick={handleSendRFQ}
                          disabled={sendingRFQ}
                          className={pillPrimary}
                        >
                          {sendingRFQ ? "Sending…" : "Send RFQ"}
                        </button>

                      </div>

                    </div>
                  )}

                  {/* SUPPLIER CARDS — suppliers with no relevant evidence
                      for this requirement ("no_match" tier) are excluded
                      here rather than ranked alongside real candidates;
                      matchMeta above already accounts for them. Weak-tier
                      suppliers (thin, mostly-unconfirmed overlap) get a
                      section divider so they read as "worth a second
                      look", not as recommendations on equal footing. */}
                  <div className="grid gap-5">

                    {visibleSuppliers.map(
                      (vendor, index) => {
                        const isCompared =
                          compareIds.includes(
                            vendor.id
                          );

                        const previousTier =
                          index > 0 ? visibleSuppliers[index - 1].tier : null;
                        const showWeakDivider =
                          vendor.tier === "weak" && previousTier !== "weak";

                        return (
                          <div key={vendor.id}>

                          {showWeakDivider && (
                            <div className="mb-5 mt-2 flex items-center gap-3">
                              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                                Potential matches — verify capability directly
                              </span>
                              <span className="h-px flex-1 bg-zinc-200" />
                            </div>
                          )}

                          <div
                            className={`rounded-md border bg-white p-6 transition ${
                              isCompared
                                ? "border-zinc-950"
                                : "border-zinc-200 hover:border-zinc-400"
                            }`}
                          >

                            {/* TOP */}
                            <div className="flex items-start justify-between gap-5">

                              <div className="flex gap-4">

                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 font-display font-semibold text-zinc-950">
                                  #{index + 1}
                                </div>

                                <div>

                                  <div className="flex flex-wrap items-center gap-3">

                                    <h3 className="font-display text-lg font-semibold">
                                      {vendor.identity.companyName}
                                    </h3>

                                    {vendor.intelligence.sources.length > 0 && (
                                      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                        Publicly sourced
                                      </span>
                                    )}

                                    {vendor.sourcing.verification.status ===
                                      "verified" && (
                                      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                        Verified by ProcureAI
                                      </span>
                                    )}

                                  </div>

                                  <p className="mt-1 text-sm text-zinc-500">
                                    {vendor.capabilities.categories.join(", ") ||
                                      "Uncategorized"}{" "}
                                    · {vendor.identity.location}
                                  </p>

                                </div>

                              </div>

                              <div className="text-right">

                                <div className="font-display text-3xl font-bold text-zinc-950">
                                  {vendor.score}%
                                </div>

                                <div className="mt-1 flex items-center justify-end gap-1.5">
                                  <span className="h-1 w-4 bg-amber-500" />
                                  <p className="text-[11px] uppercase tracking-wider text-zinc-400">
                                    match score
                                  </p>
                                </div>

                                <p
                                  className={`mt-1 text-[11px] font-semibold uppercase tracking-wider ${
                                    TIER_BADGE_CLASS[vendor.tier] ?? "text-zinc-400"
                                  }`}
                                >
                                  {TIER_LABEL[vendor.tier] ?? vendor.tier}
                                </p>

                                <p className="mt-1 text-[11px] text-zinc-400">
                                  {CONFIDENCE_LABEL[
                                    vendor.intelligence.dataConfidence
                                  ]}
                                </p>

                              </div>

                            </div>

                            {/* DESCRIPTION */}
                            <p className="mt-5 text-sm leading-6 text-zinc-600">
                              {vendor.capabilities.productDescription ||
                                "No public description available."}
                            </p>

                            {/* WHY IT MATCHED */}
                            {vendor.reasons.length > 0 && (
                              <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5">
                                {vendor.reasons.map((reason, reasonIndex) => (
                                  <li
                                    key={reasonIndex}
                                    className={`flex items-center gap-1.5 text-xs font-medium ${
                                      reason.type === "positive"
                                        ? "text-emerald-700"
                                        : "text-amber-700"
                                    }`}
                                  >
                                    <span>
                                      {reason.type === "positive" ? "✓" : "⚠"}
                                    </span>
                                    {reason.label}
                                  </li>
                                ))}
                              </ul>
                            )}

                            {/* DATA */}
                            <div className="mt-5 grid gap-4 border-t border-zinc-100 pt-5 sm:grid-cols-4">

                              <SupplierDetail
                                label="Pricing"
                                value={orNotPublic(vendor.commercial.priceRange)}
                              />

                              <SupplierDetail
                                label="Delivery"
                                value={orNotPublic(vendor.commercial.leadTime)}
                              />

                              <SupplierDetail
                                label="Minimum order"
                                value={orNotPublic(vendor.commercial.moq)}
                              />

                              <SupplierDetail
                                label="Rating"
                                value={
                                  vendor.intelligence.publicRating !== null
                                    ? `★ ${vendor.intelligence.publicRating}`
                                    : "Not publicly listed"
                                }
                              />

                            </div>

                            {/* ACTIONS */}
                            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-5">

                              <button
                                onClick={() =>
                                  toggleCompare(
                                    vendor.id
                                  )
                                }
                                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                                  isCompared
                                    ? "border-zinc-950 bg-zinc-950 text-white"
                                    : "border-zinc-200 text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"
                                }`}
                              >
                                {isCompared
                                  ? "✓ Selected"
                                  : "Compare"}
                              </button>

                              <div className="flex gap-3">

                                <button
                                  onClick={() =>
                                    setSelectedVendorId(
                                      vendor.id
                                    )
                                  }
                                  className={pillOutline}
                                >
                                  View supplier
                                </button>

                                {vendor.identity.website && (
                                  <a
                                    href={vendor.identity.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={pillDark}
                                  >
                                    Website ↗
                                  </a>
                                )}

                              </div>

                            </div>

                          </div>

                          </div>
                        );
                      }
                    )}

                  </div>

                </div>
              )}

            </div>
          </div>
        </>
      )}

      {/* SUPPLIER DETAIL MODAL */}
      {selectedVendor &&
        selectedVendorId !== -1 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-6">

            <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-md border border-zinc-200 bg-white">

              <div className="flex items-start justify-between border-b border-zinc-100 p-7">

                <div>

                  <div className="flex flex-wrap items-center gap-3">

                    <h2 className="font-display text-2xl font-semibold">
                      {selectedVendor.identity.companyName}
                    </h2>

                    {selectedVendor.intelligence.sources.length > 0 && (
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Publicly sourced
                      </span>
                    )}

                    {selectedVendor.sourcing.verification.status ===
                      "verified" && (
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Verified by ProcureAI
                      </span>
                    )}

                  </div>

                  <p className="mt-2 text-sm text-zinc-500">
                    {selectedVendor.capabilities.categories.join(", ") ||
                      "Uncategorized"}{" "}
                    · {selectedVendor.identity.location}
                  </p>

                </div>

                <button
                  onClick={() =>
                    setSelectedVendorId(null)
                  }
                  className="rounded-md px-3 py-2 text-xl text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                >
                  ×
                </button>

              </div>

              <div className="grid gap-4 p-7 sm:grid-cols-2">

                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-6">

                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    ProcureAI match
                  </p>

                  <div className="mt-2 font-display text-5xl font-bold text-zinc-950">
                    {selectedVendor.score}%
                  </div>

                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="h-1 w-5 bg-amber-500" />
                    <p className="text-xs text-zinc-500">
                      Based on your procurement requirements
                    </p>
                  </div>

                </div>

                <div className="rounded-md border border-zinc-200 p-6">

                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Supplier category
                  </p>

                  <p className="mt-2 font-display text-xl font-semibold">
                    {selectedVendor.capabilities.categories.join(", ") ||
                      "Uncategorized"}
                  </p>

                  <p className="mt-1 text-sm text-zinc-500">
                    {selectedVendor.identity.location}
                  </p>

                </div>

              </div>

              {selectedVendor.reasons.length > 0 && (
                <div className="px-7 pb-2">

                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Why this matched
                  </p>

                  <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
                    {selectedVendor.reasons.map((reason, reasonIndex) => (
                      <li
                        key={reasonIndex}
                        className={`flex items-center gap-1.5 text-xs font-medium ${
                          reason.type === "positive"
                            ? "text-emerald-700"
                            : "text-amber-700"
                        }`}
                      >
                        <span>{reason.type === "positive" ? "✓" : "⚠"}</span>
                        {reason.label}
                      </li>
                    ))}
                  </ul>

                </div>
              )}

              <div className="px-7">

                <h3 className="font-display font-semibold">
                  About this supplier
                </h3>

                <p className="mt-3 text-sm leading-7 text-zinc-600">
                  {selectedVendor.capabilities.productDescription ||
                    "No public description available."}
                </p>

              </div>

              <div className="grid gap-4 p-7 sm:grid-cols-2">

                <InfoBox
                  label="Pricing"
                  value={orNotPublic(selectedVendor.commercial.priceRange)}
                />

                <InfoBox
                  label="Delivery"
                  value={orNotPublic(selectedVendor.commercial.leadTime)}
                />

                <InfoBox
                  label="Minimum order"
                  value={orNotPublic(selectedVendor.commercial.moq)}
                />

                <InfoBox
                  label="Public rating"
                  value={
                    selectedVendor.intelligence.publicRating !== null
                      ? `★ ${selectedVendor.intelligence.publicRating}${
                          selectedVendor.intelligence.reviewCount
                            ? ` (${selectedVendor.intelligence.reviewCount} reviews)`
                            : ""
                        }`
                      : "Not publicly listed"
                  }
                />

              </div>

              {/* EVIDENCE */}
              <div className="border-t border-zinc-100 px-7 py-6">

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display font-semibold">
                    Evidence
                  </h3>

                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    {
                      CONFIDENCE_LABEL[
                        selectedVendor.intelligence.dataConfidence
                      ]
                    }
                  </span>
                </div>

                {(() => {
                  const evidenceItems = buildEvidenceItems(selectedVendor);

                  if (evidenceItems.length === 0) {
                    return (
                      <p className="mt-3 text-sm text-zinc-500">
                        No public evidence available for this supplier.
                      </p>
                    );
                  }

                  return (
                    <>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">
                        Only the facts listed below are backed by a public
                        source ProcureAI has on file. Anything else shown
                        for this supplier is not independently sourced.
                      </p>

                      <ul className="mt-4 divide-y divide-zinc-100 rounded-md border border-zinc-200">
                        {evidenceItems.map((item, index) => (
                          <li
                            key={index}
                            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-zinc-800">
                                {item.fieldLabel}
                              </p>

                              <p className="mt-0.5 text-xs text-zinc-500">
                                {item.sourceName} · Retrieved{" "}
                                {formatEvidenceDate(item.retrievedAt)}
                              </p>
                            </div>

                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-xs font-semibold text-amber-600 transition hover:text-amber-700"
                            >
                              Evidence ↗
                            </a>
                          </li>
                        ))}
                      </ul>
                    </>
                  );
                })()}

              </div>

              {/* PERFORMANCE (P0 #3) — derived from real RFQ/quote/award
                  history, deliberately kept visually and structurally
                  separate from the sourced Evidence section above so it's
                  never mistaken for an externally verified fact. */}
              <div className="border-t border-zinc-100 px-7 py-6">

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display font-semibold">
                    Performance
                  </h3>

                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    ProcureAI-derived
                  </span>
                </div>

                <p className="mt-2 text-xs leading-5 text-zinc-500">
                  Calculated from this supplier&apos;s actual RFQ, quote,
                  and award activity on ProcureAI. This is not an
                  externally verified fact, and it is not a judgment of
                  reliability beyond what&apos;s shown here.
                </p>

                {performanceLoading ? (
                  <p className="mt-3 text-sm text-zinc-500">
                    Calculating…
                  </p>
                ) : performance ? (
                  <ul className="mt-4 grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
                    <li>RFQs received: {performance.rfqsReceived}</li>
                    <li>Quotes submitted: {performance.quotesSubmitted}</li>
                    <li>Orders awarded: {performance.ordersAwarded}</li>
                    <li>
                      Quote response rate: {formatPerformancePercent(
                        performance.quoteResponseRate
                      )}
                    </li>
                    <li>Win rate: {formatPerformancePercent(performance.winRate)}</li>
                    <li>
                      Average quoted price:{" "}
                      {performance.averageQuotedPrice !== null
                        ? `₹${performance.averageQuotedPrice.toLocaleString("en-IN")}`
                        : "Not enough quotes yet"}
                    </li>
                    <li>
                      Completed orders:{" "}
                      {performance.completedOrders !== null
                        ? performance.completedOrders
                        : "Not tracked yet"}
                    </li>
                    <li>
                      On-time delivery:{" "}
                      {performance.onTimeDeliveryRate !== null
                        ? formatPerformancePercent(performance.onTimeDeliveryRate)
                        : "Not enough completed orders"}
                    </li>
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-zinc-500">
                    Performance data unavailable.
                  </p>
                )}

              </div>

              <div className="mx-7 rounded-md bg-zinc-50 p-4">

                <p className="text-xs leading-5 text-zinc-500">
                  Supplier information is based on publicly
                  available sources. ProcureAI has not independently
                  verified this supplier&apos;s claims, pricing,
                  availability, or fulfillment performance unless
                  explicitly marked &quot;Verified by ProcureAI&quot; above.
                </p>

              </div>

              <div className="flex flex-wrap justify-end gap-3 p-7">

                <button
                  onClick={() =>
                    toggleCompare(
                      selectedVendor.id
                    )
                  }
                  className={pillOutline}
                >
                  {compareIds.includes(
                    selectedVendor.id
                  )
                    ? "✓ In comparison"
                    : "Add to comparison"}
                </button>

                {selectedVendor.identity.website && (
                  <a
                    href={selectedVendor.identity.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={pillDark}
                  >
                    Visit supplier website ↗
                  </a>
                )}

              </div>

            </div>
          </div>
        )}

      {/* COMPARISON MODAL */}
      {selectedVendorId === -1 &&
        comparisonVendors.length >= 2 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-6">

            <div className="max-h-[90vh] w-full max-w-6xl overflow-auto rounded-md border border-zinc-200 bg-white">

              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 bg-white p-7">

                <div>

                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    Procurement comparison
                  </div>

                  <h2 className="mt-1 font-display text-2xl font-semibold">
                    Compare suppliers
                  </h2>

                </div>

                <button
                  onClick={() =>
                    setSelectedVendorId(null)
                  }
                  className="rounded-md px-3 py-2 text-xl text-zinc-400 transition hover:bg-zinc-100"
                >
                  ×
                </button>

              </div>

              <div className="overflow-x-auto p-7">

                <table className="w-full min-w-[800px] border-collapse text-left">

                  <thead>

                    <tr>

                      <th className="w-48 border-b border-zinc-200 p-4 text-sm font-medium text-zinc-400">
                        Attribute
                      </th>

                      {comparisonVendors.map(
                        (vendor) => (
                          <th
                            key={vendor.id}
                            className="border-b border-zinc-200 p-4"
                          >

                            <div className="font-display text-lg font-semibold">
                              {vendor.identity.companyName}
                            </div>

                            <div className="mt-1 text-sm font-normal text-zinc-500">
                              {vendor.identity.location}
                            </div>

                          </th>
                        )
                      )}

                    </tr>

                  </thead>

                  <tbody>

                    <ComparisonRow
                      label="ProcureAI match"
                      values={comparisonVendors.map(
                        (v) => `${v.score}%`
                      )}
                      highlight
                    />

                    <ComparisonRow
                      label="Category"
                      values={comparisonVendors.map(
                        (v) =>
                          v.capabilities.categories.join(", ") ||
                          "Uncategorized"
                      )}
                    />

                    <ComparisonRow
                      label="Pricing"
                      values={comparisonVendors.map(
                        (v) => orNotPublic(v.commercial.priceRange)
                      )}
                    />

                    <ComparisonRow
                      label="Delivery"
                      values={comparisonVendors.map(
                        (v) => orNotPublic(v.commercial.leadTime)
                      )}
                    />

                    <ComparisonRow
                      label="Minimum order"
                      values={comparisonVendors.map(
                        (v) => orNotPublic(v.commercial.moq)
                      )}
                    />

                    <ComparisonRow
                      label="Rating"
                      values={comparisonVendors.map(
                        (v) =>
                          v.intelligence.publicRating !== null
                            ? `★ ${v.intelligence.publicRating}`
                            : "Not publicly listed"
                      )}
                    />

                    <ComparisonRow
                      label="Public source"
                      values={comparisonVendors.map(
                        (v) =>
                          v.intelligence.sources.length > 0
                            ? "Yes"
                            : "No"
                      )}
                    />

                    <ComparisonRow
                      label="Data confidence"
                      values={comparisonVendors.map(
                        (v) => CONFIDENCE_LABEL[v.intelligence.dataConfidence]
                      )}
                    />

                  </tbody>

                </table>

              </div>

              <div className="flex justify-end gap-3 border-t border-zinc-100 p-7">

                <button
                  onClick={() =>
                    setSelectedVendorId(null)
                  }
                  className={pillOutline}
                >
                  Close
                </button>

                {comparisonVendors
                  .filter((vendor) => vendor.identity.website)
                  .map((vendor) => (
                    <a
                      key={vendor.id}
                      href={vendor.identity.website ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={pillDark}
                    >
                      {vendor.identity.companyName} ↗
                    </a>
                  ))}

              </div>

            </div>
          </div>
        )}

    </main>
  );
}

function Requirement({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-5">

      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </p>

      <p className="mt-2 font-display text-lg font-semibold">
        {value}
      </p>

    </div>
  );
}

function SupplierDetail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>

      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </p>

      <p className="mt-1 text-sm font-medium text-zinc-800">
        {value}
      </p>

    </div>
  );
}

function InfoBox({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-zinc-200 p-5">

      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </p>

      <p className="mt-2 text-base font-semibold">
        {value}
      </p>

    </div>
  );
}

function ComparisonRow({
  label,
  values,
  highlight = false,
}: {
  label: string;
  values: string[];
  highlight?: boolean;
}) {
  return (
    <tr>

      <td className="border-b border-zinc-100 p-4 text-sm font-medium text-zinc-500">
        {label}
      </td>

      {values.map((value, index) => (
        <td
          key={index}
          className={`border-b border-zinc-100 p-4 text-sm font-medium ${
            highlight
              ? "font-display text-lg font-bold text-zinc-950"
              : "text-zinc-800"
          }`}
        >
          {value}
        </td>
      ))}

    </tr>
  );
}
