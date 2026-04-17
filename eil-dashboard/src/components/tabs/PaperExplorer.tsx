"use client";

import { useEffect, useMemo, useState } from "react";
import { TRACK_COLS } from "@/lib/constants";
import { CloseIcon, PaperIcon } from "@/components/ui/Icons";
import Modal from "@/components/ui/Modal";
import type { PaperId, TrendRow, TrackRow } from "@/types/database";

interface Props {
  trends: TrendRow[];
  tracksSingle: TrackRow[];
  linkedPaperId?: string | null;
}

const trackField = (track: string) =>
  track.toLowerCase() as "el" | "eli" | "lae" | "other";

export default function PaperExplorer({
  trends,
  tracksSingle,
  linkedPaperId = null,
}: Props) {
  const [selectedPaperId, setSelectedPaperId] = useState<PaperId | null>(null);

  const papers = useMemo(() => {
    const map: Record<
      string,
      {
        paper_id: PaperId;
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

    return Object.values(map)
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
  }, [tracksSingle, trends]);

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
        <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
          No papers match the current filters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="app-surface overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-[#2f2f2f] sm:px-5">
          <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
            Papers
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-[#a3a3a3]">
            {papers.length} result{papers.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="max-h-[720px] divide-y divide-slate-200 overflow-y-auto dark:divide-[#2f2f2f]">
          {papers.map((paper) => (
            <button
              key={paper.paper_id}
              type="button"
              onClick={() => setSelectedPaperId(paper.paper_id)}
              className="flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-[#171717] sm:gap-4 sm:px-5"
            >
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-[#171717] dark:text-[#bdbdbd]">
                <PaperIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#8e8e8e]">
                    {paper.year}
                  </span>
                  {paper.trackLabels.map((track) => (
                    <span
                      key={track}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-[#171717] dark:text-[#c7c7c7]"
                    >
                      {track}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                  {paper.title}
                </p>
                <p className="mt-2 line-clamp-2 text-sm text-slate-500 dark:text-[#a3a3a3]">
                  {paper.topics.join(", ")}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {detail && (
        <Modal onClose={() => setSelectedPaperId(null)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-[#2f2f2f] dark:bg-[#212121]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 dark:border-[#2f2f2f] sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#8e8e8e]">
                  Selected paper
                </p>
                <h3 className="mt-2 text-xl font-semibold text-slate-900 dark:text-[#f2f2f2]">
                  {detail.title}
                </h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-[#a3a3a3]">
                  {detail.year}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPaperId(null)}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#353535] dark:bg-[#171717] dark:text-[#d0d0d0]"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 px-5 py-5 sm:px-6">
              {detail.tracks.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {detail.tracks.map((track) => (
                    <span
                      key={track}
                      className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-[#171717] dark:text-[#c7c7c7]"
                    >
                      {track}
                    </span>
                  ))}
                </div>
              )}

              <div className="space-y-3">
                {detail.keywords.map((keyword, index) => (
                  <article
                    key={`${keyword.keyword}-${index}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                        {keyword.keyword}
                      </p>
                      <span className="text-xs font-medium text-slate-400 dark:text-[#8e8e8e]">
                        {keyword.frequency}
                      </span>
                    </div>
                    <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-[#8e8e8e]">
                      {keyword.topic}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
                      {keyword.evidence}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
