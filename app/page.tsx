"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MatchedSupplier, SearchMeta } from "@/lib/matching";
import type { ProcurementRequirement } from "@/lib/extraction/schema";
import type { RetrievalMeta } from "@/lib/moss/types";
import type { SupplierPerformance } from "@/lib/supplier-types";
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  EmptyState,
  Modal,
  ModalCloseButton,
  Notice,
  PageHeader,
  Table,
  Th,
  Td,
} from "@/components/ui";

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
      "I need 25 commercial 5-axis CNC milling machines with automatic tool changers, delivered to Hyderabad within 45 days.",
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

type AnalysisStage = "idle" | "understanding" | "retrieving" | "matching" | "evidence";

const ANALYSIS_STAGES: { key: Exclude<AnalysisStage, "idle">; label: string }[] = [
  { key: "understanding", label: "Understanding requirements" },
  { key: "retrieving", label: "Searching suppliers with Moss" },
  { key: "matching", label: "Matching suppliers" },
  { key: "evidence", label: "Checking evidence" },
];

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

const TIER_BADGE_TONE: Record<string, "success" | "warning" | "neutral"> = {
  strong: "success",
  potential: "warning",
  weak: "neutral",
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
  const [retrievalMeta, setRetrievalMeta] = useState<RetrievalMeta | null>(
    null
  );
  const [searchError, setSearchError] = useState<string | null>(null);
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage>("idle");
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
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
    const timeoutId = window.setTimeout(() => {
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

    }, 0);

    return () => window.clearTimeout(timeoutId);
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
    setSearchError(null);
    setSelectionNotice(null);
    setAnalysisStage("understanding");

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
      setAnalysisStage("retrieving");

      const searchResponse = await fetch("/api/suppliers/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const searchText = await searchResponse.text();
      let searchData: {
        suppliers?: MatchedSupplier[];
        meta?: SearchMeta;
        retrieval?: RetrievalMeta;
        error?: string;
      };

      try {
        searchData = JSON.parse(searchText);
      } catch {
        throw new Error("The supplier search service returned an invalid response.");
      }

      if (!searchResponse.ok) {
        throw new Error(searchData.error || "Failed to search suppliers.");
      }

      setAnalysisStage("matching");
      setMatchedSuppliers(
        Array.isArray(searchData.suppliers) ? searchData.suppliers : []
      );
      setMatchMeta(searchData.meta ?? null);
      setRetrievalMeta(searchData.retrieval ?? null);
      setAnalysisStage("evidence");
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
      setSearchError(
        error instanceof Error
          ? error.message
          : "Something went wrong while searching suppliers."
      );

    } finally {
      setLoading(false);
      setAnalysisStage("idle");
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
        setSelectionNotice("You can select up to 5 suppliers at once.");
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
      setSelectionNotice(
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
      setSaveNotice("This request is already saved.");
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

    setSaveNotice("Request saved.");
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
      setRetrievalMeta(data.retrieval ?? null);
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
    <main className="min-h-screen bg-bg text-text-primary">

      {/* NAVBAR */}
      <nav className="border-b border-border bg-bg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 sm:px-8">

          <button
            onClick={() => {
              setShowRequests(false);

              window.scrollTo({
                top: 0,
                behavior: "smooth",
              });
            }}
            className="font-ledger-serif text-xl font-medium tracking-tight text-text-primary"
          >
            Procure<span className="text-accent">AI</span>
          </button>

          <div className="hidden items-center gap-6 font-ledger-mono text-[11px] uppercase tracking-[0.02em] text-text-secondary sm:flex sm:gap-8">

            <button
              onClick={() => {
                setShowRequests(false);

                window.scrollTo({
                  top: 0,
                  behavior: "smooth",
                });
              }}
              className="transition hover:text-text-primary"
            >
              Dashboard
            </button>

            <button
              onClick={() => {
                setShowRequests(false);

                // Smart-scroll: jump straight to the results if they're
                // already on screen, otherwise scroll up to the search
                // box so there's something to click through to — "Vendors"
                // previously linked to #suppliers, an id that only exists
                // once a search has run, so before that it did nothing.
                const target = showResults
                  ? document.getElementById("suppliers")
                  : document.getElementById("procurement-search");

                target?.scrollIntoView({ behavior: "smooth" });
              }}
              className="transition hover:text-text-primary"
            >
              Vendors
            </button>

            <button
              onClick={() => setShowRequests(true)}
              className="relative flex items-center gap-2 transition hover:text-text-primary"
            >
              Requests

              {savedRequests.length > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-contrast">
                  {savedRequests.length}
                </span>
              )}
            </button>

            <Link
              href="/rfqs"
              className="relative flex items-center gap-2 transition hover:text-text-primary"
            >
              RFQs

              {rfqCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-contrast">
                  {rfqCount}
                </span>
              )}
            </Link>

          </div>
        </div>
      </nav>

      {/* REQUESTS DASHBOARD */}
      {showRequests && (
        <section className="mx-auto max-w-6xl px-8 py-16">

          <PageHeader
            eyebrow="Procurement workspace"
            title="Saved requests"
            description="Revisit previous procurement requirements and supplier matches."
            actions={
              <>
                {savedRequests.length > 0 && (
                  <Button variant="secondary" onClick={clearAllRequests}>
                    Clear all
                  </Button>
                )}

                <Button variant="secondary" onClick={() => setShowRequests(false)}>
                  New request
                </Button>
              </>
            }
          />

          <div className="mt-10">
          {savedRequests.length === 0 ? (
            <EmptyState
              title="No saved requests yet"
              description="Analyze a procurement requirement and save it here to build your procurement history."
              action={
                <Button variant="primary" onClick={() => setShowRequests(false)}>
                  Create your first request
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4">

              {savedRequests.map((request) => (
                <Card key={request.id} padding="md">

                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">

                    <div className="min-w-0">

                      <div className="flex flex-wrap items-center gap-3">

                        <span className="eyebrow text-text-secondary">
                          <span className="eyebrow-dot bg-text-secondary" />
                          Procurement request
                        </span>

                        <span className="text-xs text-text-tertiary">
                          {formatDate(request.createdAt)}
                        </span>

                      </div>

                      <h3 className="mt-3 font-ledger-serif text-lg font-medium text-text-primary">
                        {request.requirements.product ||
                          request.query}
                      </h3>

                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-text-secondary">
                        {request.query}
                      </p>

                      <div className="mt-4 flex flex-wrap gap-2">

                        {request.requirements.quantity && (
                          <Badge tone="neutral">
                            {request.requirements.quantity}
                          </Badge>
                        )}

                        {request.requirements.location && (
                          <Badge tone="neutral">
                            {request.requirements.location}
                          </Badge>
                        )}

                        {request.requirements.budget && (
                          <Badge tone="neutral">
                            {request.requirements.budget}
                          </Badge>
                        )}

                        {request.requirements.deadline && (
                          <Badge tone="neutral">
                            {request.requirements.deadline}
                          </Badge>
                        )}

                      </div>

                      {/* TOP SUPPLIERS */}
                      {request.topVendorIds.length > 0 && (
                        <div className="mt-5">

                          <p className="font-ledger-mono text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                            Top supplier matches
                          </p>

                          <div className="mt-2 flex flex-wrap gap-2">

                            {request.topVendorIds.map(
                              (vendorId, index) => (
                                <Badge key={vendorId} tone="neutral">
                                  #{index + 1}{" "}
                                  {getVendorName(vendorId)}
                                </Badge>
                              )
                            )}

                          </div>
                        </div>
                      )}

                    </div>

                    <div className="flex shrink-0 gap-2">

                      <Button
                        variant="secondary"
                        onClick={() =>
                          openSavedRequest(request)
                        }
                      >
                        Open request
                      </Button>

                      <Button
                        variant="danger"
                        onClick={() =>
                          deleteSavedRequest(request.id)
                        }
                      >
                        Delete
                      </Button>

                    </div>

                  </div>
                </Card>
              ))}

            </div>
          )}
          </div>

        </section>
      )}

      {/* MAIN DASHBOARD */}
      {!showRequests && (
        <>
          {/* HERO */}
          <section
            id="procurement-search"
            className="bg-bg pb-24 pt-16"
          >

            <div className="mx-auto max-w-5xl px-8">

              <div className="eyebrow text-text-secondary">
                <span className="eyebrow-dot bg-accent" />
                Procurement intelligence / workspace
              </div>

              <h1 className="mt-5 max-w-3xl font-ledger-serif text-5xl font-medium leading-[1.02] tracking-tight text-text-primary sm:text-7xl">
                Turn a requirement into a{" "}
                <span className="italic text-accent">
                  supplier shortlist.
                </span>
              </h1>

              <p className="mt-6 max-w-[54ch] text-base leading-7 text-text-secondary sm:text-lg">
                Describe what you need in plain English. ProcureAI extracts
                the buying brief, finds evidence-backed matches, and helps
                you move from shortlist to RFQ.
              </p>

              <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 font-ledger-mono text-[10px] uppercase tracking-[0.02em] text-text-tertiary">
                <span>01 Understand the brief</span>
                <span>02 Match suppliers</span>
                <span>03 Compare quotes</span>
              </div>

            </div>

            {/* SEARCH — floats up over the hero/workspace boundary */}
            <div className="relative z-10 mx-auto -mb-24 mt-10 max-w-4xl px-8">

              <div className="rounded-lg border border-border-strong bg-surface p-3">

                <div className="mb-4 grid border-b border-border sm:grid-cols-3">
                  {[
                    ["01", "Understand the brief"],
                    ["02", "Find supplier matches"],
                    ["03", "Compare quotes"],
                  ].map(([number, label], index) => (
                    <div
                      key={number}
                      className={`flex items-center gap-3 border-border px-3 py-3 font-ledger-mono text-[10px] uppercase tracking-[0.02em] sm:px-4 ${
                        index < 2 ? "border-b sm:border-b-0 sm:border-r" : ""
                      }`}
                    >
                      <span
                        className={`flex h-6 w-7 items-center justify-center rounded-md ${
                          index === 0
                            ? "bg-accent text-accent-contrast"
                            : "border border-border-strong text-text-tertiary"
                        }`}
                      >
                        {number}
                      </span>
                      <span className={index === 0 ? "text-text-primary" : "text-text-tertiary"}>
                        {label}
                      </span>
                    </div>
                  ))}
                </div>

                <label className="block px-2 sm:px-4">
                  <span className="font-ledger-mono text-[10px] uppercase tracking-[0.02em] text-text-secondary">
                    Procurement requirement
                  </span>
                <textarea
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setShowResults(false);
                  }}
                  placeholder="Example: I need 500 recyclable custom 5-ply boxes for cosmetics shipping, delivered to Hyderabad within 3 weeks, under ₹12 per box..."
                  className="min-h-32 w-full resize-none rounded-md border border-transparent bg-transparent py-3 text-lg leading-7 text-text-primary outline-none transition placeholder:text-text-tertiary focus:border-accent"
                />
                </label>

                <div className="flex flex-col items-start justify-between gap-3 border-t border-border px-3 pt-3 sm:flex-row sm:items-center sm:px-4">

                  <div className="font-ledger-mono text-[10px] uppercase tracking-[0.02em] text-text-tertiary">
                    {query.length > 0
                      ? `${query.length} characters`
                      : "Describe your procurement requirement"}
                  </div>

                  <Button
                    variant="primary"
                    onClick={handleAnalyze}
                    disabled={loading}
                  >
                    {loading
                      ? "Building shortlist…"
                      : "Find supplier matches →"}
                  </Button>

                </div>
              </div>

              {loading && (
                <div className="mt-3 rounded-lg border border-border-strong bg-surface-raised px-5 py-4 text-text-primary">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold">
                      Preparing your supplier shortlist
                    </p>
                    <span className="text-xs text-text-secondary">
                      {ANALYSIS_STAGES.find((stage) => stage.key === analysisStage)?.label}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-4">
                    {ANALYSIS_STAGES.map((stage, index) => {
                      const activeIndex = ANALYSIS_STAGES.findIndex(
                        (item) => item.key === analysisStage
                      );
                      const complete = index < activeIndex;
                      const active = stage.key === analysisStage;

                      return (
                        <div key={stage.key} className="flex items-center gap-2 text-xs">
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                              complete
                                ? "border-success bg-success text-accent-contrast"
                                : active
                                  ? "border-warning text-warning"
                                  : "border-border-strong text-text-secondary"
                            }`}
                          >
                            {complete ? "✓" : index + 1}
                          </span>
                          <span className={active ? "text-text-primary" : "text-text-secondary"}>
                            {stage.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {searchError && (
                <Notice tone="danger" className="mt-6">
                  Supplier search failed: {searchError}
                </Notice>
              )}

            </div>
          </section>

          <div className="-mt-24 bg-bg px-6 pb-12 sm:px-8">
            <div className="mx-auto max-w-5xl pt-28">
              <div className="mx-auto max-w-4xl">

              {/* SUGGESTIONS */}
              <div className="flex flex-wrap justify-center gap-3">

                <span className="mr-1 py-2 font-ledger-mono text-[10px] uppercase tracking-[0.02em] text-text-tertiary">
                  Try searching:
                </span>

                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    onClick={() => setQuery(suggestion.query)}
                    className="rounded-md border border-border-strong px-4 py-2 text-sm text-text-secondary transition hover:border-accent hover:text-text-primary"
                  >
                    {suggestion.label}
                  </button>
                ))}

              </div>
              </div>

              {/* RESULTS */}
              {showResults && (
                <div
                  id="suppliers"
                  className="mt-12 bg-bg px-6 pb-24 pt-8 sm:px-8"
                >

                  {/* REQUIREMENT */}
                  <PageHeader
                    eyebrow="Procurement intelligence"
                    title="We understood your requirement"
                    actions={
                      <Button variant="secondary" onClick={saveCurrentRequest}>
                        Save request
                      </Button>
                    }
                  />

                  <div className="mb-8" />

                  {saveNotice && (
                    <Notice tone="success" className="mb-5">
                      {saveNotice}
                    </Notice>
                  )}

                  {/* Concise, human-readable procurement brief — the
                      complete intent in one line, not just the product
                      category. Never fabricates a clause for a field
                      that wasn't actually stated. */}
                  <p className="mb-6 max-w-3xl text-lg leading-8 text-text-secondary">
                    {buildProcurementBrief(requirements)}
                  </p>

                  <Card padding="sm" className="mb-6">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Requirement
                        label="Product"
                        value={
                          requirements.structured?.product.value ||
                          requirements.product ||
                          "Not specified"
                        }
                      />
                      <Requirement label="Quantity" value={requirements.quantity || "Not specified"} />
                      <Requirement label="Destination" value={requirements.location || "Not specified"} />
                      <Requirement label="Deadline" value={requirements.deadline || "Not specified"} />
                      <Requirement
                        label="Quality preference"
                        value={
                          requirements.structured?.specifications.qualityRequirements.join(", ") ||
                          "Not specified"
                        }
                      />
                      <Requirement
                        label="Pricing preference"
                        value={
                          requirements.structured?.specifications.pricingPreferences.join(", ") ||
                          "Not specified"
                        }
                      />
                    </div>
                  </Card>

                  {/* EXTRA REQUIREMENTS — Deadline and Specifications now
                      are already represented in the structured summary
                      above, so this panel is just the remaining raw detail
                      (packaging, shipping, capability, and certification
                      phrases) that doesn't fit a dedicated row. */}
                  {requirements.additionalRequirements.length > 0 && (

                    <Card padding="md" className="mb-10">

                      <h3 className="font-ledger-serif font-medium text-text-primary">
                        Additional requirements
                      </h3>

                      <div className="mt-5 flex flex-wrap gap-2">

                        {requirements.additionalRequirements.map(
                          (requirement, index) => (
                            <Badge key={index} tone="neutral">
                              {requirement}
                            </Badge>
                          )
                        )}

                      </div>

                    </Card>
                  )}

                  {/* SUPPLIER HEADER */}
                  <PageHeader
                    eyebrow="Supplier intelligence"
                    title="Best matches for your requirement"
                    actions={
                      <div className="text-right">
                        <span className="text-sm text-text-secondary">
                          {matchedSuppliers.length} suppliers analyzed
                        </span>
                        {matchMeta?.searchRegion && (
                          <p className="text-xs text-text-tertiary">
                            Searching {matchMeta.searchRegion}-wide
                            {requirements.location
                              ? ` · prioritizing ${requirements.location}`
                              : ""}
                          </p>
                        )}
                      </div>
                    }
                  />

                  <div className="mb-6" />

                  {retrievalMeta && (
                    <div
                      className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 ${
                        retrievalMeta.method === "moss"
                          ? "border-border bg-surface"
                          : "border-warning/30 bg-warning-soft"
                      }`}
                    >
                      <div>
                        <p className="font-ledger-mono text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                          Retrieval source
                        </p>
                        <p className="mt-1 text-sm font-semibold text-text-primary">
                          {retrievalMeta.method === "moss"
                            ? "Moss retrieval"
                            : `Catalog scan fallback${
                                retrievalMeta.fallbackReason
                                  ? ` · ${retrievalMeta.fallbackReason.replace(/_/g, " ")}`
                                  : ""
                              }`}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-text-secondary">
                        {retrievalMeta.method === "moss"
                          ? `${retrievalMeta.mossCandidates} candidates recalled · ${retrievalMeta.hydrated} suppliers matched`
                          : `${retrievalMeta.hydrated} suppliers scanned`}
                      </span>
                    </div>
                  )}

                  {matchMeta && (
                    <div className="mb-6 rounded-md border border-warning/30 bg-warning-soft px-5 py-4 text-text-primary">
                      {matchMeta.strong === 0 && (
                        <p className="font-ledger-serif text-lg font-medium">
                          No suppliers fully match your requirements yet.
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                        <span className="font-semibold">
                          {matchMeta.strong} strong match
                          {matchMeta.strong === 1 ? "" : "es"}
                        </span>
                        <span className="font-semibold text-warning">
                          {matchMeta.potential} potential match
                          {matchMeta.potential === 1 ? "" : "es"}
                        </span>
                        {matchMeta.weak > 0 && (
                          <span className="text-text-secondary">
                            {matchMeta.weak} weak match
                            {matchMeta.weak === 1 ? "" : "es"}
                          </span>
                        )}
                      </div>

                      <p className="mt-2 max-w-3xl text-sm leading-6 text-warning/80">
                        Potential matches have partial evidence for your
                        requirements and should be verified directly with the
                        supplier before you send an RFQ.
                      </p>
                    </div>
                  )}

                  {/* COMPARISON BAR */}
                  {compareIds.length > 0 && (
                    <div className="sticky top-4 z-20 mb-6 flex items-center justify-between rounded-md border border-border-strong bg-surface-raised px-5 py-4">

                      <div>
                        <p className="text-sm font-semibold text-text-primary">
                          <span className="text-accent">
                            {compareIds.length}
                          </span>{" "}
                          supplier
                          {compareIds.length > 1
                            ? "s"
                            : ""}{" "}
                          selected
                        </p>

                        <p className="text-xs text-text-secondary">
                          Compare side-by-side, or send them an RFQ
                        </p>
                      </div>

                      <div className="flex gap-3">

                        <Button
                          variant="secondary"
                          onClick={() => {
                            if (compareIds.length < 2) {
                              setSelectionNotice(
                                "Select at least 2 suppliers to compare."
                              );
                              return;
                            }

                            setSelectedVendorId(-1);
                          }}
                        >
                          Compare suppliers
                        </Button>

                        <Button
                          variant="primary"
                          onClick={handleSendRFQ}
                          disabled={sendingRFQ}
                        >
                          {sendingRFQ ? "Sending…" : "Send RFQ"}
                        </Button>

                      </div>

                    </div>
                  )}

                  {selectionNotice && (
                    <Notice tone="danger" className="mb-5">
                      {selectionNotice}
                    </Notice>
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
                              <span className="font-ledger-mono text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                                Potential matches — verify capability directly
                              </span>
                              <span className="h-px flex-1 bg-border" />
                            </div>
                          )}

                          <Card
                            padding="md"
                            className={`transition ${
                              isCompared
                                ? "border-border-strong"
                                : "hover:border-border-strong"
                            }`}
                          >

                            {/* TOP */}
                            <div className="flex items-start justify-between gap-5">

                              <div className="flex gap-4">

                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised font-ledger-mono font-semibold text-text-primary">
                                  #{index + 1}
                                </div>

                                <div>

                                  <div className="flex flex-wrap items-center gap-3">

                                    <h3 className="font-ledger-serif text-lg font-medium text-text-primary">
                                      {vendor.identity.companyName}
                                    </h3>

                                    {vendor.sourcing.verification.status ===
                                      "verified" ? (
                                      <Badge tone="success" dot>
                                        Verified / evidence-backed
                                      </Badge>
                                    ) : vendor.intelligence.sources.length > 0 ? (
                                      <Badge tone="warning" dot>
                                        Public evidence found · Not independently verified
                                      </Badge>
                                    ) : (
                                      <Badge tone="neutral" dot>
                                        No public evidence available
                                      </Badge>
                                    )}

                                  </div>

                                  <p className="mt-1 text-sm text-text-secondary">
                                    {vendor.capabilities.categories.join(", ") ||
                                      "Uncategorized"}{" "}
                                    · {vendor.identity.location}
                                  </p>

                                </div>

                              </div>

                              <div className="text-right">

                                <div className="tabular font-ledger-mono text-3xl font-bold text-text-primary">
                                  {vendor.score}%
                                </div>

                                <div className="mt-1 flex items-center justify-end gap-1.5">
                                  <span className="h-1 w-4 bg-accent" />
                                  <p className="text-[11px] uppercase tracking-wider text-text-tertiary">
                                    match score
                                  </p>
                                </div>

                                <div className="mt-1.5 flex justify-end">
                                  <Badge tone={TIER_BADGE_TONE[vendor.tier] ?? "neutral"}>
                                    {TIER_LABEL[vendor.tier] ?? vendor.tier}
                                  </Badge>
                                </div>

                                <p className="mt-1.5 text-[11px] text-text-tertiary">
                                  {CONFIDENCE_LABEL[
                                    vendor.intelligence.dataConfidence
                                  ]}
                                </p>

                                <p className="mt-2 max-w-[220px] text-[10px] leading-4 text-text-tertiary">
                                  Based on product, specifications, use case,
                                  location, and requirement completeness.
                                </p>

                              </div>

                            </div>

                            {/* DESCRIPTION */}
                            <p className="mt-5 text-sm leading-6 text-text-secondary">
                              {vendor.capabilities.productDescription ||
                                "No public description available."}
                            </p>

                            {/* WHY IT MATCHED */}
                            {vendor.reasons.length > 0 && (
                              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                {vendor.reasons.slice(0, 4).map((reason, reasonIndex) => (
                                  <Badge
                                    key={reasonIndex}
                                    tone={reason.type === "positive" ? "success" : "warning"}
                                    className="justify-self-start normal-case tracking-normal"
                                  >
                                    {reason.type === "positive" ? "✓" : "⚠"} {reason.label}
                                  </Badge>
                                ))}
                              </div>
                            )}

                            {requirements.location &&
                              vendor.explanation.locationMatch !== "match" && (
                                <Notice tone="warning" className="mt-4">
                                  <p className="font-ledger-mono text-xs font-semibold uppercase tracking-wider">
                                    Destination: {requirements.location}
                                  </p>
                                  <p className="mt-1 text-sm font-medium">
                                    ⚠ {requirements.location} delivery
                                    capability not confirmed
                                  </p>
                                </Notice>
                              )}

                            {/* DATA */}
                            <div className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-4">

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
                            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">

                              <Button
                                variant="secondary"
                                onClick={() =>
                                  toggleCompare(
                                    vendor.id
                                  )
                                }
                                className={isCompared ? "border-accent text-accent" : ""}
                              >
                                {isCompared
                                  ? "✓ Selected"
                                  : "Compare"}
                              </Button>

                              <div className="flex gap-3">

                                <Button
                                  variant="secondary"
                                  onClick={() =>
                                    setSelectedVendorId(
                                      vendor.id
                                    )
                                  }
                                >
                                  View supplier
                                </Button>

                                {vendor.identity.website && (
                                  <a
                                    href={vendor.identity.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={buttonClasses("secondary")}
                                  >
                                    Website ↗
                                  </a>
                                )}

                              </div>

                            </div>

                          </Card>

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
          <Modal onClose={() => setSelectedVendorId(null)} maxWidth="max-w-3xl">

              <div className="flex items-start justify-between border-b border-border p-7">

                <div>

                  <div className="flex flex-wrap items-center gap-3">

                    <h2 className="font-ledger-serif text-2xl font-medium text-text-primary">
                      {selectedVendor.identity.companyName}
                    </h2>

                    {selectedVendor.sourcing.verification.status ===
                      "verified" ? (
                      <Badge tone="success" dot>
                        Verified / evidence-backed
                      </Badge>
                    ) : selectedVendor.intelligence.sources.length > 0 ? (
                      <Badge tone="warning" dot>
                        Public evidence found · Not independently verified
                      </Badge>
                    ) : (
                      <Badge tone="neutral" dot>
                        No public evidence available
                      </Badge>
                    )}

                  </div>

                  <p className="mt-2 text-sm text-text-secondary">
                    {selectedVendor.capabilities.categories.join(", ") ||
                      "Uncategorized"}{" "}
                    · {selectedVendor.identity.location}
                  </p>

                </div>

                <ModalCloseButton onClose={() => setSelectedVendorId(null)} />

              </div>

              <div className="grid gap-4 p-7 sm:grid-cols-2">

                <Card tone="sunken" padding="md">

                  <p className="font-ledger-mono text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    ProcureAI match
                  </p>

                  <div className="tabular mt-2 font-ledger-mono text-5xl font-bold text-text-primary">
                    {selectedVendor.score}%
                  </div>

                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="h-1 w-5 bg-accent" />
                    <p className="text-xs text-text-secondary">
                      Based on your procurement requirements
                    </p>
                  </div>

                </Card>

                <Card padding="md">

                  <p className="font-ledger-mono text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    Supplier category
                  </p>

                  <p className="mt-2 font-ledger-serif text-xl font-medium text-text-primary">
                    {selectedVendor.capabilities.categories.join(", ") ||
                      "Uncategorized"}
                  </p>

                  <p className="mt-1 text-sm text-text-secondary">
                    {selectedVendor.identity.location}
                  </p>

                </Card>

              </div>

              {selectedVendor.reasons.length > 0 && (
                <div className="px-7 pb-2">

                  <p className="font-ledger-mono text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    Why this matched
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedVendor.reasons.map((reason, reasonIndex) => (
                      <Badge
                        key={reasonIndex}
                        tone={reason.type === "positive" ? "success" : "warning"}
                        className="normal-case tracking-normal"
                      >
                        {reason.type === "positive" ? "✓" : "⚠"} {reason.label}
                      </Badge>
                    ))}
                  </div>

                </div>
              )}

              <div className="px-7">

                <h3 className="font-ledger-serif font-medium text-text-primary">
                  About this supplier
                </h3>

                <p className="mt-3 text-sm leading-7 text-text-secondary">
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
              <div className="border-t border-border px-7 py-6">

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-ledger-serif font-medium text-text-primary">
                    Evidence
                  </h3>

                  <span className="font-ledger-mono text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
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
                      <p className="mt-3 text-sm text-text-secondary">
                        No public evidence available for this supplier.
                      </p>
                    );
                  }

                  return (
                    <>
                      <p className="mt-2 text-xs leading-5 text-text-secondary">
                        Only the facts listed below are backed by a public
                        source ProcureAI has on file. Anything else shown
                        for this supplier is not independently sourced.
                      </p>

                      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
                        {evidenceItems.map((item, index) => (
                          <li
                            key={index}
                            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-text-primary">
                                {item.fieldLabel}
                              </p>

                              <p className="mt-0.5 text-xs text-text-secondary">
                                {item.sourceName} · Retrieved{" "}
                                {formatEvidenceDate(item.retrievedAt)}
                              </p>
                            </div>

                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-xs font-semibold text-accent transition hover:text-accent-hover"
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
              <div className="border-t border-border px-7 py-6">

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-ledger-serif font-medium text-text-primary">
                    Performance
                  </h3>

                  <span className="font-ledger-mono text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    ProcureAI-derived
                  </span>
                </div>

                <p className="mt-2 text-xs leading-5 text-text-secondary">
                  Calculated from this supplier&apos;s actual RFQ, quote,
                  and award activity on ProcureAI. This is not an
                  externally verified fact, and it is not a judgment of
                  reliability beyond what&apos;s shown here.
                </p>

                {performanceLoading ? (
                  <p className="mt-3 text-sm text-text-secondary">
                    Calculating…
                  </p>
                ) : performance ? (
                  <ul className="mt-4 grid gap-2 text-sm text-text-secondary sm:grid-cols-2">
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
                  <p className="mt-3 text-sm text-text-secondary">
                    Performance data unavailable.
                  </p>
                )}

              </div>

              <div className="mx-7 rounded-md bg-surface-raised p-4">

                <p className="text-xs leading-5 text-text-secondary">
                  Supplier information is based on publicly
                  available sources. ProcureAI has not independently
                  verified this supplier&apos;s claims, pricing,
                  availability, or fulfillment performance unless
                  explicitly marked &quot;Verified by ProcureAI&quot; above.
                </p>

              </div>

              <div className="flex flex-wrap justify-end gap-3 p-7">

                <Button
                  variant="secondary"
                  onClick={() =>
                    toggleCompare(
                      selectedVendor.id
                    )
                  }
                >
                  {compareIds.includes(
                    selectedVendor.id
                  )
                    ? "✓ In comparison"
                    : "Add to comparison"}
                </Button>

                {selectedVendor.identity.website && (
                  <a
                    href={selectedVendor.identity.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClasses("secondary")}
                  >
                    Visit supplier website ↗
                  </a>
                )}

              </div>

          </Modal>
        )}

      {/* COMPARISON MODAL */}
      {selectedVendorId === -1 &&
        comparisonVendors.length >= 2 && (
          <Modal onClose={() => setSelectedVendorId(null)} maxWidth="max-w-6xl">

              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface p-7">

                <div>

                  <div className="eyebrow text-accent">
                    <span className="eyebrow-dot bg-accent" />
                    Procurement comparison
                  </div>

                  <h2 className="mt-1 font-ledger-serif text-2xl font-medium text-text-primary">
                    Compare suppliers
                  </h2>

                </div>

                <ModalCloseButton onClose={() => setSelectedVendorId(null)} />

              </div>

              <div className="p-7">

                <Table>

                  <thead>

                    <tr>

                      <Th className="w-48">
                        Attribute
                      </Th>

                      {comparisonVendors.map(
                        (vendor) => (
                          <Th key={vendor.id}>

                            <div className="font-ledger-serif text-sm normal-case tracking-normal text-text-primary">
                              {vendor.identity.companyName}
                            </div>

                            <div className="mt-1 font-ledger-sans text-sm font-normal normal-case tracking-normal text-text-secondary">
                              {vendor.identity.location}
                            </div>

                          </Th>
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

                </Table>

              </div>

              <div className="flex justify-end gap-3 border-t border-border p-7">

                <Button
                  variant="secondary"
                  onClick={() =>
                    setSelectedVendorId(null)
                  }
                >
                  Close
                </Button>

                {comparisonVendors
                  .filter((vendor) => vendor.identity.website)
                  .map((vendor) => (
                    <a
                      key={vendor.id}
                      href={vendor.identity.website ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClasses("secondary")}
                    >
                      {vendor.identity.companyName} ↗
                    </a>
                  ))}

              </div>

          </Modal>
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
    <div className="rounded-md border border-border bg-surface p-5">

      <p className="font-ledger-mono text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
        {label}
      </p>

      <p className="mt-2 font-ledger-serif text-lg font-medium text-text-primary">
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

      <p className="font-ledger-mono text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
        {label}
      </p>

      <p className="mt-1 text-sm font-medium text-text-primary">
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
    <div className="rounded-md border border-border p-5">

      <p className="font-ledger-mono text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
        {label}
      </p>

      <p className="mt-2 text-base font-semibold text-text-primary">
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

      <Td className="font-medium text-text-secondary">
        {label}
      </Td>

      {values.map((value, index) => (
        <Td
          key={index}
          className={
            highlight
              ? "tabular font-ledger-mono text-lg font-bold text-text-primary"
              : "font-medium text-text-primary"
          }
        >
          {value}
        </Td>
      ))}

    </tr>
  );
}
