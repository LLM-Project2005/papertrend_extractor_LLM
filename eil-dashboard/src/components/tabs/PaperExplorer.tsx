"use client";

import { useEffect, useMemo, useState } from "react";
import { TRACK_COLS } from "@/lib/constants";
import { PaperIcon, SearchIcon } from "@/components/ui/Icons";
import type { TrendRow, TrackRow } from "@/types/database";

interface Props {
  trends: TrendRow[];
  tracksSingle: TrackRow[];
  linkedPaperId?: number | null;
}

const trackField = (track: string) =>
  track.toLowerCase() as "el" | "eli" | "lae" | "other";

export default function PaperExplorer({
  trends,
  tracksSingle,
  linkedPaperId = null,
}: Props) {
  const [search, setSearch] = useState("");
  const [selectedPaperId, setSelectedPaperId] = useState<number | null>(null);

  const papers = useMemo(() => {
    const map: Record<
      number,
      {
        paper_id: number;
        year: string;
        title: string;
        topics: Set<string>;
        keywords: Set<string>;
      }
    > = {};

    trends.forEach((row) => {
      const paper = (map[row.paper_id] ??= {
        paper_id: row.paper_id,
        year: row.year,
        title: row.title,
        topics: new Set(),
        keywords: new Set(),
      });
      paper.topics.add(row.topic);
      paper.keywords.add(row.keyword);
    });

    const trackMap = new Map(tracksSingle.map((row) => [row.paper_id, row]));

    let list = Object.values(map)
      .map((paper) => {
        const trackRow = trackMap.get(paper.paper_id);
        const tracks = trackRow
          ? TRACK_COLS.filter((track) => trackRow[trackField(track)] === 1)
          : [];
        return {
          paper_id: paper.paper_id,
          year: paper.year,
          title: paper.title,
          topics: [...paper.topics],
          keywords: [...paper.keywords],
          trackLabels: tracks,
        };
      })
      .sort((left, right) => right.year.localeCompare(left.year));

    if (search) {
      const query = search.toLowerCase();
      list = list.filter((paper) => paper.title.toLowerCase().includes(query));
    }

    return list;
  }, [search, tracksSingle, trends]);

  const detail = useMemo(() => {
    if (selectedPaperId === null) {
      return null;
    }

    const rows = trends.filter((row) => row.paper_id === selectedPaperId);
    if (rows.length === 0) {
      return null;
    }

    const trackRow = tracksSingle.find((row) => row.paper_id === selectedPaperId);
    const tracks = trackRow
      ? TRACK_COLS.filter((track) => trackRow[trackField(track)] === 1)
      : [];

    return {
      title: rows[0].title,
      year: rows[0].year,
      tracks,
      keywords: rows.map((row) => ({
        keyword: row.keyword,
        frequency: row.keyword_frequency,
        topic: row.topic,
        evidence: row.evidence,
      })),
    };
  }, [selectedPaperId, tracksSingle, trends]);

  useEffect(() => {
    if (linkedPaperId === null) {
      return;
    }
    if (papers.some((paper) => paper.paper_id === linkedPaperId)) {
      setSelectedPaperId(linkedPaperId);
    }
  }, [linkedPaperId, papers]);

  if (trends.length === 0) {
    return (
      <div className="app-surface px-5 py-5">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No papers match the current filters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="app-surface px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              Paper library
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
              Search titles, review the paper list, and inspect evidence without leaving the workspace flow.
            </p>
          </div>

          <label className="relative block w-full max-w-md">
            <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by title"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500"
            />
          </label>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
        <section className="app-surface overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800 sm:px-5">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              Papers
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {papers.length} result{papers.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="max-h-[640px] divide-y divide-slate-200 overflow-y-auto dark:divide-slate-800">
            {papers.map((paper) => {
              const active = selectedPaperId === paper.paper_id;
              return (
                <button
                  key={paper.paper_id}
                  type="button"
                  onClick={() => setSelectedPaperId(paper.paper_id)}
                  className={`flex w-full items-start gap-3 px-4 py-4 text-left transition-colors sm:gap-4 sm:px-5 ${
                    active
                      ? "bg-slate-100 dark:bg-slate-800/70"
                      : "hover:bg-slate-50 dark:hover:bg-slate-900"
                  }`}
                >
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    <PaperIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                        {paper.year}
                      </span>
                      {paper.trackLabels.map((track) => (
                        <span
                          key={track}
                          className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        >
                          {track}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                      {paper.title}
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                      {paper.topics.join(", ")}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="app-surface px-4 py-4 sm:px-5 sm:py-5">
          {detail ? (
            <div>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  <PaperIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                    Selected paper
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                    {detail.title}
                  </h3>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    {detail.year}
                  </p>
                </div>
              </div>

              {detail.tracks.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {detail.tracks.map((track) => (
                    <span
                      key={track}
                      className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    >
                      {track}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-5 space-y-3">
                {detail.keywords.map((keyword, index) => (
                  <article
                    key={`${keyword.keyword}-${index}`}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">
                        {keyword.keyword}
                      </p>
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                        {keyword.frequency}
                      </span>
                    </div>
                    <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                      {keyword.topic}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                      {keyword.evidence}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[280px] items-center justify-center text-center">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Choose a paper
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  Select a row from the library to inspect keywords, topic links, and evidence.
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
