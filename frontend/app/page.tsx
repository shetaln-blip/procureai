"use client";

import { useState } from "react";

export default function Home() {
  const [showNew, setShowNew] = useState(false);
  const [created, setCreated] = useState(false);

  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [requirements, setRequirements] = useState("");
  const [files, setFiles] = useState<string[]>([]);

  function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    const names = selected.map(function (file) {
      return file.name;
    });

    setFiles(names);
  }

  function createProcurement() {
    if (name.trim() === "") {
      return;
    }

    setShowNew(false);
    setCreated(true);
  }

  if (created) {
    const requirementsList = requirements
      .split("\n")
      .map(function (item) {
        return item.trim();
      })
      .filter(function (item) {
        return item.length > 0;
      });

    return (
      <main className="min-h-screen bg-[#fafafa] text-[#171717]">
        <header className="border-b border-[#e5e5e5] bg-white">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between px-10 py-5">
            <button
              onClick={function () {
                setCreated(false);
              }}
              className="text-[12px] text-[#777] hover:text-black"
            >
              ← Dashboard
            </button>

            <span className="rounded-full bg-[#f2f2f2] px-3 py-1.5 text-[10px] text-[#666]">
              Ready for analysis
            </span>
          </div>
        </header>

        <section className="mx-auto max-w-[1200px] px-10 py-10">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#999]">
            Procurement
          </p>

          <h1 className="mt-2 text-[28px] font-semibold tracking-tight">
            {name}
          </h1>

          <p className="mt-2 text-[13px] text-[#777]">
            Review your requirements and vendor proposals.
          </p>

          <div className="mt-9 grid grid-cols-[1fr_300px] gap-8">
            <div>
              <div className="border border-[#e5e5e5] bg-white">
                <div className="border-b border-[#e8e8e8] px-6 py-4">
                  <h2 className="text-[14px] font-semibold">
                    Requirements
                  </h2>
                </div>

                <div className="p-6">
                  {requirementsList.length > 0 ? (
                    <div>
                      {requirementsList.map(function (requirement, index) {
                        return (
                          <div
                            key={index}
                            className="flex items-center gap-3 border-b border-[#eeeeee] py-3 last:border-0"
                          >
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f2f2f2] text-[10px] text-[#666]">
                              {index + 1}
                            </div>

                            <span className="text-[13px]">
                              {requirement}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[13px] text-[#999]">
                      No requirements added.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-6 border border-[#e5e5e5] bg-white">
                <div className="border-b border-[#e8e8e8] px-6 py-4">
                  <h2 className="text-[14px] font-semibold">
                    Vendor proposals
                  </h2>
                </div>

                <div className="p-6">
                  {files.length > 0 ? (
                    <div className="space-y-2">
                      {files.map(function (file, index) {
                        return (
                          <div
                            key={index}
                            className="flex items-center justify-between border border-[#eeeeee] px-4 py-3"
                          >
                            <span className="text-[12px]">
                              {file}
                            </span>

                            <span className="text-[10px] text-[#999]">
                              Uploaded
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-8 text-center">
                      <p className="text-[13px] font-medium">
                        No vendor proposals
                      </p>

                      <p className="mt-1 text-[11px] text-[#999]">
                        Upload vendor quotes to compare them.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <aside>
              <div className="border border-[#e5e5e5] bg-white">
                <div className="border-b border-[#e8e8e8] px-5 py-4">
                  <h2 className="text-[13px] font-semibold">
                    Procurement details
                  </h2>
                </div>

                <div className="space-y-6 p-5">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[#999]">
                      Budget
                    </p>

                    <p className="mt-1 text-[15px] font-semibold">
                      {budget || "Not specified"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[#999]">
                      Vendors
                    </p>

                    <p className="mt-1 text-[15px] font-semibold">
                      {files.length}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[#999]">
                      Status
                    </p>

                    <p className="mt-1 text-[13px] font-medium">
                      Ready
                    </p>
                  </div>
                </div>

                <div className="border-t border-[#e8e8e8] p-5">
                  <button
                    disabled={files.length === 0}
                    className="w-full bg-black py-3 text-[12px] font-medium text-white disabled:bg-[#ddd]"
                  >
                    Analyze vendors →
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fafafa] text-[#171717]">
      <aside className="fixed left-0 top-0 flex h-screen w-[230px] flex-col border-r border-[#e5e5e5] bg-white px-5 py-6">
        <div className="mb-10 flex items-center gap-2 px-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-black text-xs font-bold text-white">
            P
          </div>

          <span className="text-[15px] font-semibold">
            ProcureAI
          </span>
        </div>

        <nav className="space-y-1">
          <p className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-wide text-[#999]">
            Workspace
          </p>

          <button className="w-full rounded-md bg-[#f1f1f1] px-3 py-2.5 text-left text-[13px] font-medium">
            Dashboard
          </button>

          <button className="w-full rounded-md px-3 py-2.5 text-left text-[13px] text-[#666] hover:bg-[#f5f5f5]">
            Procurements
          </button>

          <button className="w-full rounded-md px-3 py-2.5 text-left text-[13px] text-[#666] hover:bg-[#f5f5f5]">
            Vendors
          </button>
        </nav>

        <div className="mt-auto border-t border-[#eeeeee] pt-4">
          <button className="w-full px-3 py-2 text-left text-[13px] text-[#666]">
            Settings
          </button>

          <div className="mt-4 flex items-center gap-3 px-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8e8e8] text-xs font-semibold">
              K
            </div>

            <div>
              <p className="text-[12px] font-medium">
                Kanishk
              </p>

              <p className="text-[11px] text-[#999]">
                Workspace
              </p>
            </div>
          </div>
        </div>
      </aside>

      <section className="ml-[230px]">
        <div className="mx-auto max-w-[1200px] px-10 py-9">
          <header className="flex items-center justify-between">
            <div>
              <p className="text-[12px] text-[#999]">
                Sunday, September 6
              </p>

              <h1 className="mt-1 text-[24px] font-semibold tracking-tight">
                Dashboard
              </h1>
            </div>

            <button
              onClick={function () {
                setShowNew(true);
              }}
              className="rounded-md bg-black px-4 py-2.5 text-[13px] font-medium text-white hover:bg-[#292929]"
            >
              + New procurement
            </button>
          </header>

          <div className="mt-9 grid grid-cols-3 border-y border-[#e7e7e7] bg-white">
            <div className="border-r border-[#e7e7e7] px-6 py-5">
              <p className="text-[10px] uppercase tracking-wide text-[#999]">
                Active
              </p>

              <p className="mt-2 text-[25px] font-semibold">
                0
              </p>
            </div>

            <div className="border-r border-[#e7e7e7] px-6 py-5">
              <p className="text-[10px] uppercase tracking-wide text-[#999]">
                Vendors analyzed
              </p>

              <p className="mt-2 text-[25px] font-semibold">
                0
              </p>
            </div>

            <div className="px-6 py-5">
              <p className="text-[10px] uppercase tracking-wide text-[#999]">
                Potential savings
              </p>

              <p className="mt-2 text-[25px] font-semibold">
                ₹0
              </p>
            </div>
          </div>

          <section className="mt-10">
            <h2 className="mb-4 text-[15px] font-semibold">
              Recent procurements
            </h2>

            <div className="border border-[#e5e5e5] bg-white">
              <div className="grid grid-cols-4 border-b border-[#eeeeee] bg-[#fafafa] px-5 py-3">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#999]">
                  Procurement
                </span>

                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#999]">
                  Vendors
                </span>

                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#999]">
                  Budget
                </span>

                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#999]">
                  Status
                </span>
              </div>

              <div className="grid grid-cols-4 items-center px-5 py-5">
                <div>
                  <p className="text-[13px] font-medium">
                    No procurements yet
                  </p>

                  <p className="mt-1 text-[11px] text-[#999]">
                    Create your first procurement
                  </p>
                </div>

                <span className="text-[12px] text-[#999]">
                  —
                </span>

                <span className="text-[12px] text-[#999]">
                  —
                </span>

                <span className="text-[11px] text-[#999]">
                  —
                </span>
              </div>
            </div>
          </section>

          <div className="mt-10 grid grid-cols-2 gap-8">
            <section>
              <h2 className="mb-4 text-[15px] font-semibold">
                Start with an example
              </h2>

              <div className="border border-[#e5e5e5] bg-white p-6">
                <p className="text-[10px] uppercase tracking-wide text-[#999]">
                  Example
                </p>

                <h3 className="mt-2 text-[17px] font-semibold">
                  Laptop procurement
                </h3>

                <p className="mt-2 text-[12px] leading-5 text-[#777]">
                  Compare laptop vendors based on price,
                  specifications, warranty, and delivery.
                </p>

                <button
                  onClick={function () {
                    setName("Laptop procurement");
                    setBudget("₹12,00,000");
                    setRequirements(
                      "16GB RAM\n512GB SSD\n3-year warranty\nDelivery within 30 days"
                    );
                    setFiles([
                      "vendor-lenovo.pdf",
                      "vendor-dell.pdf",
                      "vendor-hp.pdf",
                    ]);
                    setShowNew(true);
                  }}
                  className="mt-6 w-full border border-[#dcdcdc] py-2.5 text-[12px] font-medium hover:bg-[#f7f7f7]"
                >
                  Use example →
                </button>
              </div>
            </section>

            <section>
              <h2 className="mb-4 text-[15px] font-semibold">
                Procurement assistant
              </h2>

              <div className="border border-[#e5e5e5] bg-white p-6">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-black text-[9px] font-bold text-white">
                  AI
                </div>

                <h3 className="mt-4 text-[15px] font-semibold">
                  Compare before you buy.
                </h3>

                <p className="mt-2 text-[12px] leading-5 text-[#777]">
                  Upload vendor proposals and let the system
                  identify pricing differences, requirement
                  matches, and potential risks.
                </p>

                <button
                  onClick={function () {
                    setShowNew(true);
                  }}
                  className="mt-6 text-[12px] font-medium hover:underline"
                >
                  Start a procurement →
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-[560px] bg-white p-7 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#999]">
                  New procurement
                </p>

                <h2 className="mt-1 text-[21px] font-semibold">
                  Start a procurement
                </h2>

                <p className="mt-1 text-[12px] text-[#888]">
                  Define what you need and upload vendor proposals.
                </p>
              </div>

              <button
                onClick={function () {
                  setShowNew(false);
                }}
                className="text-[#999] hover:text-black"
              >
                ✕
              </button>
            </div>

            <div className="mt-7 space-y-5">
              <div>
                <label className="text-[12px] font-medium">
                  What are you purchasing?
                </label>

                <input
                  value={name}
                  onChange={function (event) {
                    setName(event.target.value);
                  }}
                  placeholder="e.g. Laptops"
                  className="mt-2 w-full border border-[#ddd] px-3.5 py-3 text-[13px] outline-none focus:border-black"
                />
              </div>

              <div>
                <label className="text-[12px] font-medium">
                  Budget
                </label>

                <input
                  value={budget}
                  onChange={function (event) {
                    setBudget(event.target.value);
                  }}
                  placeholder="₹12,00,000"
                  className="mt-2 w-full border border-[#ddd] px-3.5 py-3 text-[13px] outline-none focus:border-black"
                />
              </div>

              <div>
                <label className="text-[12px] font-medium">
                  Requirements
                </label>

                <textarea
                  value={requirements}
                  onChange={function (event) {
                    setRequirements(event.target.value);
                  }}
                  rows={5}
                  placeholder={
                    "16GB RAM\n512GB SSD\n3-year warranty\nDelivery within 30 days"
                  }
                  className="mt-2 w-full resize-none border border-[#ddd] px-3.5 py-3 text-[13px] outline-none focus:border-black"
                />
              </div>

              <div>
                <label className="text-[12px] font-medium">
                  Vendor proposals
                </label>

                <label className="mt-2 block cursor-pointer border border-dashed border-[#ccc] px-5 py-7 text-center hover:bg-[#fafafa]">
                  <p className="text-[13px] font-medium">
                    Choose vendor files
                  </p>

                  <p className="mt-1 text-[11px] text-[#999]">
                    PDF, DOCX, XLSX
                  </p>

                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.xls,.xlsx"
                    onChange={handleFiles}
                    className="hidden"
                  />
                </label>

                {files.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {files.map(function (file, index) {
                      return (
                        <p
                          key={index}
                          className="text-[11px] text-[#666]"
                        >
                          ✓ {file}
                        </p>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                onClick={createProcurement}
                disabled={name.trim() === ""}
                className="w-full bg-black py-3 text-[12px] font-medium text-white disabled:bg-[#ddd]"
              >
                Create procurement →
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}