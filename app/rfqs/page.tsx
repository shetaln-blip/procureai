"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { RFQ, RFQStatus } from "@/lib/rfq-types";

const STATUS_LABEL: Record<RFQStatus, string> = {
  draft: "Draft",
  sent: "Awaiting quotes",
  quotes_received: "Quotes received",
  awarded: "Awarded",
};

const STATUS_DOT: Record<RFQStatus, string> = {
  draft: "bg-zinc-400",
  sent: "bg-amber-500",
  quotes_received: "bg-zinc-950",
  awarded: "bg-emerald-500",
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
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <nav className="bg-zinc-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-5">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-white"
          >
            Procure<span className="text-amber-500">AI</span>
          </Link>

          <Link
            href="/"
            className="rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400"
          >
            New request
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-8 py-16">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          RFQ workflow
        </div>

        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          Requests for quotation
        </h1>

        <p className="mt-3 max-w-2xl text-zinc-500">
          Every RFQ you&apos;ve sent, who&apos;s responded, and how
          their quotes compare — all in one place.
        </p>

        {loading ? (
          <p className="mt-12 text-sm text-zinc-400">
            Loading RFQs…
          </p>
        ) : rfqs.length === 0 ? (
          <div className="mt-12 rounded-md border border-dashed border-zinc-300 bg-white px-8 py-20 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-zinc-200 text-2xl text-zinc-400">
              +
            </div>

            <h2 className="mt-5 font-display text-xl font-semibold">
              No RFQs yet
            </h2>

            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">
              Find suppliers for a requirement, select the ones you
              want to source from, then send them an RFQ.
            </p>

            <Link
              href="/"
              className="mt-6 inline-block rounded-full bg-amber-500 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400"
            >
              Start a procurement request
            </Link>
          </div>
        ) : (
          <div className="mt-10 grid gap-4">
            {rfqs.map((rfq) => {
              const quoted = rfq.suppliers.filter(
                (supplier) => supplier.status === "quoted"
              ).length;

              return (
                <Link
                  key={rfq.id}
                  href={`/rfqs/${rfq.id}`}
                  className="block rounded-md border border-zinc-200 bg-white p-6 transition hover:border-zinc-400"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                          {rfq.id}
                        </span>

                        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[rfq.status]}`}
                          />
                          {STATUS_LABEL[rfq.status]}
                        </span>
                      </div>

                      <h3 className="mt-3 font-display text-lg font-semibold">
                        {rfq.requirements.product || rfq.query}
                      </h3>

                      <p className="mt-1 text-sm text-zinc-500">
                        {rfq.requirements.quantity ||
                          "Quantity not specified"}
                        {rfq.requirements.location
                          ? ` · ${rfq.requirements.location}`
                          : ""}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="font-display text-2xl font-bold text-zinc-950">
                        {quoted}/{rfq.suppliers.length}
                      </p>

                      <p className="text-[11px] uppercase tracking-wider text-zinc-400">
                        quotes received
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
