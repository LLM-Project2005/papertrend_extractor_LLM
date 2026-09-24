"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The sentence a reader would otherwise have to work out from the charts.
 *
 * Always computed from the numbers on the tab, never written by a model: it is
 * a summary of what is drawn below it, so it can be checked against the charts.
 */
export function Takeaway({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700 dark:text-[#d4d4d4]" data-takeaway>
      {children}
    </p>
  );
}

/**
 * Shown instead of category charts when a repository does not classify papers.
 *
 * The charts used to render anyway and could only draw one solid "Other /
 * Unclassified" - built from default rows written when there was nothing to
 * classify against - while dropping every paper that had none.
 */
export function CategoriesOffNotice({ compact = false }: { compact?: boolean }) {
  return (
    <section className="app-surface px-4 py-4 sm:px-5 sm:py-5">
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">Categories are off for this repository</h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-[#bdbdbd]">
        {compact
          ? "This repository uses General Research, which groups papers by theme but does not sort them into categories."
          : "This repository uses General Research, which groups papers by theme but does not sort them into categories. Choose EIL Tracks or your own categories and this tab will show how papers divide between them, how that changes by year, and which themes lead each category."}
      </p>
      <Link
        href="/workspace/settings?section=analysis"
        className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-[#2a2a2a] dark:bg-[#050505] dark:text-[#e5e5e5] dark:hover:border-[#3a3a3a] dark:hover:text-white"
      >
        Choose categories in Settings
      </Link>
    </section>
  );
}
