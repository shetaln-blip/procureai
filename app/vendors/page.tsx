"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  type BadgeTone,
  buttonClasses,
  Card,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui";
import type { VendorLeaderboardEntry } from "@/app/api/suppliers/leaderboard/route";
import type { CategoryCount } from "@/app/api/suppliers/categories/route";
import type { TopSupplierEntry } from "@/app/api/suppliers/top/route";
import type { DataConfidence } from "@/lib/supplier-types";

type LeaderboardResponse = {
  ranked: VendorLeaderboardEntry[];
  totalSuppliersInCatalog: number;
  totalWithHistory: number;
  message: string | null;
};

type TopSuppliersResponse = {
  category: string;
  totalInCategory: number;
  results: TopSupplierEntry[];
};

const CONFIDENCE_TONE: Record<DataConfidence, BadgeTone> = {
  high: "success",
  medium: "warning",
  low: "neutral",
};

const CONFIDENCE_LABEL: Record<DataConfidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function formatHours(value: number | null): string {
  if (value === null) return "—";
  if (value < 24) return `${value.toFixed(1)} hrs`;
  return `${(value / 24).toFixed(1)} days`;
}

function formatPrice(value: number | null): string {
  return value === null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })
    : "Unknown";
}

export default function VendorsPage() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [categoryData, setCategoryData] = useState<TopSuppliersResponse | null>(null);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState("");

  useEffect(() => {
    fetch("/api/suppliers/leaderboard")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Failed to load.");
        return body as LeaderboardResponse;
      })
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load vendor performance.")
      )
      .finally(() => setLoading(false));
  }, []);

  const loadCategory = useCallback((category: string) => {
    setCategoryLoading(true);
    setCategoryError("");

    fetch(`/api/suppliers/top?category=${encodeURIComponent(category)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Failed to load.");
        return body as TopSuppliersResponse;
      })
      .then(setCategoryData)
      .catch((err) =>
        setCategoryError(
          err instanceof Error ? err.message : "Failed to load suppliers for this category."
        )
      )
      .finally(() => setCategoryLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/suppliers/categories")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Failed to load categories.");
        return body.categories as CategoryCount[];
      })
      .then((list) => {
        setCategories(list);
        if (list.length > 0) {
          setSelectedCategory(list[0].category);
          loadCategory(list[0].category);
        }
      })
      .catch(() => setCategories([]));
  }, [loadCategory]);

  return (
    <main className="min-h-screen bg-bg text-text-primary">
      <nav className="border-b border-border bg-bg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 sm:px-8">
          <Link
            href="/"
            className="font-ledger-serif text-xl font-medium tracking-tight text-text-primary"
          >
            Procure<span className="text-accent">AI</span>
          </Link>

          <div className="flex items-center gap-6 font-ledger-mono text-[11px] uppercase tracking-[0.06em] text-text-secondary sm:gap-8">
            <Link
              href="/"
              className="hidden transition hover:text-text-primary sm:block"
            >
              Dashboard
            </Link>

            <span className="text-text-primary">Vendors</span>

            <Link href="/rfqs" className="transition hover:text-text-primary">
              RFQs
            </Link>

            <Link href="/" className={buttonClasses("primary", "sm")}>
              New request
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-8 py-16">
        <PageHeader
          eyebrow="Vendor performance"
          title="Top performing vendors"
          description="Ranked by real activity inside ProcureAI — RFQs received, quotes submitted, and orders actually won. This is not a public review score."
        />

        {loading ? (
          <p className="mt-12 font-ledger-mono text-sm text-text-secondary">
            Loading vendor performance…
          </p>
        ) : error ? (
          <div className="mt-12">
            <Notice tone="danger">{error}</Notice>
          </div>
        ) : (
          <>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <span className="eyebrow text-text-tertiary">
                <span className="eyebrow-dot bg-text-tertiary" />
                {data?.totalWithHistory ?? 0} of {data?.totalSuppliersInCatalog ?? 0}{" "}
                catalog suppliers have RFQ history
              </span>
            </div>

            {!data || data.ranked.length === 0 ? (
              <div className="mt-8">
                <EmptyState
                  title="No vendor rankings yet"
                  description={
                    data?.message ??
                    "Send an RFQ and collect quotes to start building real performance history for suppliers."
                  }
                  action={
                    <Link href="/" className={buttonClasses("primary")}>
                      Start a procurement request
                    </Link>
                  }
                />
              </div>
            ) : (
              <div className="mt-8">
                <Table>
                  <thead>
                    <tr>
                      <Th>Rank</Th>
                      <Th>Vendor</Th>
                      <Th>RFQs / Quotes</Th>
                      <Th>Win rate</Th>
                      <Th>Response rate</Th>
                      <Th>Avg response time</Th>
                      <Th>Avg quoted price</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ranked.map((entry, index) => (
                      <tr key={entry.vendorId}>
                        <Td className="tabular font-ledger-mono text-text-tertiary">
                          {index + 1}
                        </Td>
                        <Td>
                          <div className="font-medium text-text-primary">
                            {entry.companyName}
                          </div>
                          <div className="mt-0.5 text-xs text-text-secondary">
                            {entry.location || "Location not listed"}
                          </div>
                        </Td>
                        <Td className="tabular">
                          {entry.performance.quotesSubmitted}/{entry.performance.rfqsReceived}
                          <span className="ml-1 text-xs text-text-tertiary">
                            · {entry.performance.ordersAwarded} won
                          </span>
                        </Td>
                        <Td className="tabular">{formatPercent(entry.performance.winRate)}</Td>
                        <Td className="tabular">
                          {formatPercent(entry.performance.quoteResponseRate)}
                        </Td>
                        <Td className="tabular">
                          {formatHours(entry.performance.averageResponseHours)}
                        </Td>
                        <Td className="tabular">
                          {formatPrice(entry.performance.averageQuotedPrice)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}

            <Card tone="sunken" padding="md" className="mt-8">
              <p className="text-sm leading-6 text-text-secondary">
                <span className="font-semibold text-text-primary">
                  Why no star ratings?
                </span>{" "}
                ProcureAI&apos;s supplier catalog doesn&apos;t currently have public
                review data for any vendor — showing a rating here would mean
                inventing one. These rankings are built entirely from real
                RFQ, quote, and award events that have actually happened
                inside ProcureAI, so a vendor with no history yet simply
                won&apos;t appear until they do.
              </p>
            </Card>
          </>
        )}
      </section>

      <section className="mx-auto max-w-6xl px-8 pb-24">
        <div className="border-t border-border pt-12">
          <PageHeader
            eyebrow="Supplier directory"
            eyebrowTone="neutral"
            title="Browse by category"
            description="The most thoroughly documented suppliers in each category — ranked by evidence on file (source count and how recently it was gathered), not by a quality or performance score."
          />

          {categories.length > 0 && (
            <div className="mt-6 max-w-xs">
              <Field label="Category">
                <Select
                  value={selectedCategory}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSelectedCategory(next);
                    loadCategory(next);
                  }}
                >
                  {categories.map((c) => (
                    <option key={c.category} value={c.category}>
                      {c.category} ({c.count})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          {categoryLoading ? (
            <p className="mt-8 font-ledger-mono text-sm text-text-secondary">
              Loading suppliers…
            </p>
          ) : categoryError ? (
            <div className="mt-8">
              <Notice tone="danger">{categoryError}</Notice>
            </div>
          ) : categoryData && categoryData.results.length > 0 ? (
            <>
              <p className="mt-6 font-ledger-mono text-[11px] uppercase tracking-[0.06em] text-text-tertiary">
                Showing top {categoryData.results.length} of {categoryData.totalInCategory}{" "}
                suppliers in &ldquo;{categoryData.category}&rdquo;
              </p>

              <div className="mt-4">
                <Table>
                  <thead>
                    <tr>
                      <Th>Rank</Th>
                      <Th>Vendor</Th>
                      <Th>Evidence</Th>
                      <Th>MOQ / Price / Lead time</Th>
                      <Th>Certifications</Th>
                      <Th>Last verified</Th>
                      <Th>ProcureAI activity</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryData.results.map((entry, index) => (
                      <tr key={entry.vendorId}>
                        <Td className="tabular font-ledger-mono text-text-tertiary">
                          {index + 1}
                        </Td>
                        <Td>
                          <div className="font-medium text-text-primary">
                            {entry.companyName}
                          </div>
                          <div className="mt-0.5 text-xs text-text-secondary">
                            {entry.location || "Location not listed"}
                          </div>
                        </Td>
                        <Td>
                          <Badge tone={CONFIDENCE_TONE[entry.dataConfidence]} dot>
                            {CONFIDENCE_LABEL[entry.dataConfidence]}
                          </Badge>
                          <div className="mt-1.5 text-xs text-text-tertiary">
                            {entry.sourceCount} source{entry.sourceCount === 1 ? "" : "s"}
                          </div>
                        </Td>
                        <Td className="text-xs leading-5">
                          <div>{entry.moq ?? "MOQ not listed"}</div>
                          <div>{entry.priceRange ?? "Pricing not public"}</div>
                          <div>{entry.leadTime ?? "Lead time not listed"}</div>
                        </Td>
                        <Td className="text-xs leading-5">
                          {entry.certifications.length > 0
                            ? entry.certifications.join(", ")
                            : "None listed"}
                        </Td>
                        <Td className="text-xs">{formatDate(entry.lastUpdated)}</Td>
                        <Td className="text-xs leading-5">
                          {entry.performance.rfqsReceived > 0 ? (
                            <>
                              {entry.performance.quotesSubmitted}/
                              {entry.performance.rfqsReceived} quoted ·{" "}
                              {entry.performance.ordersAwarded} won
                            </>
                          ) : (
                            <span className="text-text-tertiary">
                              Not yet contacted through ProcureAI
                            </span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          ) : (
            categoryData && (
              <div className="mt-8">
                <EmptyState
                  title="No suppliers in this category"
                  description="Try a different category from the selector above."
                />
              </div>
            )
          )}
        </div>
      </section>
    </main>
  );
}
