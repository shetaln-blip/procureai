"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  buttonClasses,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui";
import type { VendorLeaderboardEntry } from "@/app/api/suppliers/leaderboard/route";

type LeaderboardResponse = {
  ranked: VendorLeaderboardEntry[];
  totalSuppliersInCatalog: number;
  totalWithHistory: number;
  message: string | null;
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

export default function VendorsPage() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    </main>
  );
}
