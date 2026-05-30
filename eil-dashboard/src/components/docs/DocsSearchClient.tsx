"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  docsSearchItems,
  docsSuggestedQueries,
  type DocsSearchItem,
} from "@/lib/docs-content";
import { ArrowRightIcon, SearchIcon } from "@/components/ui/Icons";

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreItem(item: DocsSearchItem, query: string) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return item.sectionId ? 0 : 1;

  const title = normalizeSearch(item.title);
  const category = normalizeSearch(item.category);
  const haystack = normalizeSearch(
    `${item.title} ${item.description} ${item.category} ${item.tags.join(" ")} ${item.searchText}`
  );
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  let score = 0;

  if (title === normalizedQuery) score += 90;
  if (title.startsWith(normalizedQuery)) score += 54;
  if (category.includes(normalizedQuery)) score += 18;
  if (haystack.includes(normalizedQuery)) score += 32;

  for (const token of tokens) {
    if (title.includes(token)) score += 14;
    if (haystack.includes(token)) score += 7;
  }

  if (tokens.length > 0 && tokens.every((token) => haystack.includes(token))) {
    score += 16;
  }

  if (!item.sectionId) score += 5;

  return score;
}

export default function DocsSearchClient() {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      return docsSearchItems
        .filter((item) => !item.sectionId)
        .slice(0, 8);
    }

    return docsSearchItems
      .map((item) => ({ item, score: scoreItem(item, trimmed) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item)
      .slice(0, 18);
  }, [query]);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-28 sm:px-6">
      <section className="border-b border-slate-200 pb-8 dark:border-[#1f1f1f]">
        <p className="text-sm font-medium text-slate-500 dark:text-[#8f8f8f]">Documentation search</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-normal text-slate-950 dark:text-white sm:text-5xl">
          Search Papertrend docs.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 dark:text-[#a3a3a3]">
          Search across public feature guides, troubleshooting, evaluation notes,
          and workspace concepts. Search runs locally in your browser.
        </p>
      </section>

      <div className="sticky top-16 z-10 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur dark:border-[#1f1f1f] dark:bg-black/95 sm:-mx-6 sm:px-6">
        <label className="relative block">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 dark:text-[#777777]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
            placeholder="Search upload, chart mode, queue stuck, unknown year..."
            className="h-14 w-full rounded-lg border border-slate-200 bg-white pl-12 pr-4 text-base text-slate-950 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-950/5 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white dark:placeholder:text-[#6f6f6f] dark:focus:border-[#3a3a3a] dark:focus:ring-white/10"
          />
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          {docsSuggestedQueries.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setQuery(suggestion)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#a3a3a3] dark:hover:border-[#3a3a3a] dark:hover:text-white"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
            {query.trim() ? `${results.length} result${results.length === 1 ? "" : "s"}` : "Suggested docs"}
          </h2>
          <Link
            href="/docs"
            className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-950 dark:text-[#a3a3a3] dark:hover:text-white"
          >
            Docs home
          </Link>
        </div>

        <div className="mt-5 space-y-3">
          {results.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="group block rounded-lg border border-slate-200 bg-white p-5 transition-colors hover:border-slate-300 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:border-[#3a3a3a]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#666666]">
                    {item.category}
                    {item.sectionId ? " / Section" : " / Guide"}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-[#a3a3a3]">
                    {item.description}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.tags.slice(0, 5).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500 dark:border-[#1f1f1f] dark:bg-[#030303] dark:text-[#8f8f8f]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <ArrowRightIcon className="mt-2 h-4 w-4 flex-none text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-950 dark:text-[#666666] dark:group-hover:text-white" />
              </div>
            </Link>
          ))}
        </div>

        {results.length === 0 ? (
          <div className="mt-5 rounded-lg border border-slate-200 bg-white px-6 py-10 text-center dark:border-[#1f1f1f] dark:bg-[#050505]">
            <p className="text-base font-semibold text-slate-950 dark:text-white">No docs found</p>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#8f8f8f]">
              Try a feature name, a task, or a symptom like failed file, dashboard filters, or queue stuck.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
