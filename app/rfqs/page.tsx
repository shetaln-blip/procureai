"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { RFQ, RFQStatus } from "@/lib/rfq-types";
import {
  Badge,
  type BadgeTone,
  buttonClasses,
  Card,
  EmptyState,
  PageHeader,
} from "@/components/ui";

const STATUS_LABEL: Record<RFQStatus, string> = {
  draft: "Draft",
  sent: "Awaiting quotes",
  quotes_received: "Quotes received",
  awarded: "Awarded",
};

const STATUS_TONE: Record<RFQStatus, BadgeTone> = {
  draft: "neutral",
  sent: "accent",
  quotes_received: "accent",
  awarded: "success",
};

export default function RFQsPage() {
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/rfqs")
      .then((res) => res.json())
      .then((data) =>
        setRfqs(Array.isArray(data.rfqs) ? data.rfqs : [])
      )
      .catch(() => setRfqs([]))
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

            <Link href="/rfqs" className="text-text-primary">
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
          eyebrow="RFQ workflow"
          title="Requests for quotation"
          description="Every RFQ you've sent, who's responded, and how their quotes compare — all in one place."
        />

        {loading ? (
          <p className="mt-12 font-ledger-mono text-sm text-text-secondary">
            Loading RFQs…
          </p>
        ) : rfqs.length === 0 ? (
          <div className="mt-12">
            <EmptyState
              title="No RFQs yet"
              description="Find suppliers for a requirement, select the ones you want to source from, then send them an RFQ."
              action={
                <Link href="/" className={buttonClasses("primary")}>
                  Start a procurement request
                </Link>
              }
            />
          </div>
        ) : (
          <div className="mt-10 grid gap-4">
            {rfqs.map((rfq) => {
              const quoted = rfq.suppliers.filter(
                (supplier) => supplier.status === "quoted"
              ).length;

              return (
                <Link key={rfq.id} href={`/rfqs/${rfq.id}`} className="block">
                  <Card interactive>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-ledger-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                            {rfq.id}
                          </span>

                          <Badge tone={STATUS_TONE[rfq.status]} dot>
                            {STATUS_LABEL[rfq.status]}
                          </Badge>
                        </div>

                        <h3 className="mt-3 font-ledger-serif text-lg font-medium text-text-primary">
                          {rfq.requirements.product || rfq.query}
                        </h3>

                        <p className="mt-1 text-sm text-text-secondary">
                          {rfq.requirements.quantity ||
                            "Quantity not specified"}
                          {rfq.requirements.location
                            ? ` · ${rfq.requirements.location}`
                            : ""}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="tabular font-ledger-serif text-2xl font-medium text-text-primary">
                          {quoted}/{rfq.suppliers.length}
                        </p>

                        <p className="font-ledger-mono text-[11px] uppercase tracking-[0.06em] text-text-tertiary">
                          quotes received
                        </p>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
