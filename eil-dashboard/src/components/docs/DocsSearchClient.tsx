"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Accept ?q= so a search can be linked to and shared, and so the tag pills on
  // a documentation page have somewhere to lead. Read from location rather than
  // useSearchParams: this route is statically rendered, and useSearchParams
  // would force it behind a Suspense boundary for no gain.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const initial = new URLSearchParams(window.location.search).get("q");
    if (initial) {
      setQuery(initial);
    } else if (window.matchMedia("(pointer: fine)").matches) {
      // Straight into the field on a desktop; on a phone the keyboard would
      // cover the page before the reader has seen it.
      inputRef.current?.focus();
    }
  }, []);

  // The address follows the query, so reload, Back and a copied link keep it.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = query.trim();
      window.history.replaceState(null, "", trimmed ? `?q=${encodeURIComponent(trimmed)}` : window.location.pathname);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [query]);

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
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-32 sm:px-6 sm:pt-36">
      <header>
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-mute">
          <Link href="/docs/getting-started" className="transition-colors hover:text-ink">
            Docs
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Search</span>
        </nav>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.03em] text-ink">Search the docs</h1>
        <p className="mt-3 text-[15px] leading-7 text-body">
          Every guide and section, searched in your browser as you type.
        </p>
      </header>

      <div className="sticky top-16 z-10 -mx-4 mt-8 border-b border-hairline bg-white/85 px-4 pb-4 pt-4 backdrop-blur-md dark:bg-black/80 sm:-mx-6 sm:px-6">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
        <label className="relative block">
          <span className="sr-only">Search the documentation</span>
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-mute" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            ref={inputRef}
            name="q"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Upload failed, unknown year, deep research…"
            className="h-12 w-full rounded-xl border border-hairline bg-surface pl-12 pr-4 text-base text-ink shadow-raise outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-mute hover:border-hairline-strong focus:border-accent focus:ring-4 focus:ring-accent/15"
          />
        </label>
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {docsSuggestedQueries.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setQuery(suggestion)}
              className="rounded-full bg-subtle px-3 py-1 text-[13px] text-body transition-colors hover:text-ink"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      {/* Only the count is announced; the list itself changes on every key. */}
      <p role="status" className="sr-only">
        {query.trim() ? `${results.length} result${results.length === 1 ? "" : "s"}` : ""}
      </p>
      <section className="mt-6">
        <h2 className="text-sm font-medium text-mute">
          {query.trim() ? `${results.length} result${results.length === 1 ? "" : "s"}` : "Suggested pages"}
        </h2>
        <ul className="mt-3 divide-y divide-hairline border-y border-hairline">
          {results.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="group flex items-start justify-between gap-4 py-4">
                <span className="min-w-0">
                  <span className="block text-[13px] text-mute">
                    {item.category}
                    {item.sectionId ? ` · ${item.description}` : ""}
                  </span>
                  <span className="mt-0.5 block text-[15px] font-medium text-ink">{item.title}</span>
                  {!item.sectionId ? (
                    <span className="mt-1 block text-sm leading-6 text-body">{item.description}</span>
                  ) : null}
                </span>
                <ArrowRightIcon className="mt-5 h-4 w-4 flex-none text-mute transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink" />
              </Link>
            </li>
          ))}
        </ul>

        {results.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-base font-medium text-ink">Nothing matches that yet</p>
            <p className="mt-1.5 text-sm leading-6 text-body">
              Try the name of a screen, a task, or the message you saw, such as &ldquo;failed&rdquo; or
              &ldquo;queue&rdquo;.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
