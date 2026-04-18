"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/ui/Modal";
import {
  ChartIcon,
  CloseIcon,
  DownloadIcon,
  PencilSquareIcon,
  StarIcon,
} from "@/components/ui/Icons";
import type { IngestionRunRow, RunAnalysisDetail } from "@/types/database";

type PaperExplorerTab = "overview" | "keywords" | "topics" | "preview";

type Props = {
  run: IngestionRunRow;
  detail: RunAnalysisDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onResolvePreviewUrl: () => Promise<string | null>;
  onOpenInNewTab: () => Promise<void>;
  onDownload: () => Promise<void>;
  onDownloadReport: () => Promise<void>;
  onToggleFavorite: () => Promise<void>;
  onRename: () => Promise<void>;
  onOpenDashboard: () => void;
};

const TAB_LABELS: Array<{ id: PaperExplorerTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "keywords", label: "Keywords" },
  { id: "topics", label: "Topics" },
  { id: "preview", label: "Preview" },
];

function cleanDisplayText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/â€¢/g, " | ")
    .trim();
}

function splitIntoBullets(value: string | null | undefined, maxItems = 3): string[] {
  const cleaned = cleanDisplayText(value);
  if (!cleaned) {
    return [];
  }

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length > 0) {
    return sentences.slice(0, maxItems);
  }

  return [cleaned.slice(0, 260)];
}

function buildTrackBadges(detail: RunAnalysisDetail | null): string[] {
  return [
    ...new Set([
      ...(detail?.tracksSingle ?? []),
      ...(detail?.tracksMulti ?? []),
    ]),
  ];
}

function summarizeFacetGroups(detail: RunAnalysisDetail | null) {
  const groups = new Map<string, string[]>();
  for (const facet of detail?.facets ?? []) {
    const key = facet.facetType.replace(/_/g, " ").trim() || "analysis facet";
    const rows = groups.get(key) ?? [];
    rows.push(facet.label);
    groups.set(key, rows);
  }

  return [...groups.entries()].map(([label, items]) => ({
    label,
    items: [...new Set(items)].slice(0, 6),
  }));
}

function titleOf(run: IngestionRunRow) {
  return run.display_name || run.source_filename || run.id;
}

function SectionSummaryCard({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const bullets = splitIntoBullets(value);
  const fullText = cleanDisplayText(value);

  return (
    <article className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#8e8e8e]">
        {label}
      </p>
      {bullets.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700 dark:text-[#d0d0d0]">
          {bullets.map((bullet, index) => (
            <li key={`${label}-${index}`} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-slate-400 dark:bg-[#8e8e8e]" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
          No extracted text was available for this section.
        </p>
      )}

      {fullText ? (
        <details className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-[#242424] dark:bg-[#111111]">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-[#8e8e8e]">
            View full extracted text
          </summary>
          <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-[#cfcfcf]">
            {fullText}
          </p>
        </details>
      ) : null}
    </article>
  );
}

export default function PaperAnalysisExplorerModal({
  run,
  detail,
  loading,
  error,
  onClose,
  onResolvePreviewUrl,
  onOpenInNewTab,
  onDownload,
  onDownloadReport,
  onToggleFavorite,
  onRename,
  onOpenDashboard,
}: Props) {
  const [activeTab, setActiveTab] = useState<PaperExplorerTab>("overview");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const trackBadges = useMemo(() => buildTrackBadges(detail), [detail]);
  const facetGroups = useMemo(() => summarizeFacetGroups(detail), [detail]);

  useEffect(() => {
    setActiveTab("overview");
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }, [run.id]);

  useEffect(() => {
    if (activeTab !== "preview" || previewUrl || previewLoading) {
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);

    void onResolvePreviewUrl()
      .then((url) => {
        if (cancelled) {
          return;
        }
        if (!url) {
          setPreviewError("Preview URL was not available for this file.");
          return;
        }
        setPreviewUrl(url);
      })
      .catch((previewLoadError) => {
        if (cancelled) {
          return;
        }
        setPreviewError(
          previewLoadError instanceof Error
            ? previewLoadError.message
            : "Failed to load the file preview."
        );
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, onResolvePreviewUrl, previewLoading, previewUrl]);

  return (
    <Modal onClose={onClose}>
      <div className="max-h-[92vh] w-[min(1100px,94vw)] overflow-y-auto rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-[#2f2f2f] dark:bg-[#111111]">
        <div className="border-b border-slate-200 px-5 py-5 dark:border-[#2f2f2f] sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#8e8e8e]">
                Paper Explorer
              </p>
              <h2 className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                {detail?.title || titleOf(run)}
              </h2>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-[#171717] dark:text-[#d0d0d0]">
                  {detail?.year || "Year unavailable"}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-[#171717] dark:text-[#d0d0d0]">
                  {run.status === "succeeded" ? "Pipeline analysis ready" : run.status}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-[#171717] dark:text-[#d0d0d0]">
                  <ChartIcon className="h-3.5 w-3.5" />
                  <span>
                    {detail?.diagnostics?.dataSource === "canonical"
                      ? "Canonical node output"
                      : detail?.available
                        ? "Recovered node output"
                        : "Preview only"}
                  </span>
                </span>
              </div>
              {trackBadges.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {trackBadges.map((track) => (
                    <span
                      key={track}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-[#2f2f2f] dark:bg-[#171717] dark:text-[#d7d7d7]"
                    >
                      {track}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#353535] dark:bg-[#171717] dark:text-[#d0d0d0]"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onDownloadReport}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:border-[#2f2f2f] dark:text-[#d0d0d0]"
            >
              <DownloadIcon className="h-4 w-4" />
              <span>Download report</span>
            </button>
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:border-[#2f2f2f] dark:text-[#d0d0d0]"
            >
              <DownloadIcon className="h-4 w-4" />
              <span>Download PDF</span>
            </button>
            <button
              type="button"
              onClick={onToggleFavorite}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:border-[#2f2f2f] dark:text-[#d0d0d0]"
            >
              <StarIcon className="h-4 w-4" />
              <span>{run.is_favorite ? "Favorited" : "Favorite"}</span>
            </button>
            <button
              type="button"
              onClick={onRename}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:border-[#2f2f2f] dark:text-[#d0d0d0]"
            >
              <PencilSquareIcon className="h-4 w-4" />
              <span>Rename</span>
            </button>
            <button
              type="button"
              onClick={onOpenDashboard}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:border-[#2f2f2f] dark:text-[#d0d0d0]"
            >
              Open dashboard charts
            </button>
            <button
              type="button"
              onClick={() => void onOpenInNewTab()}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:border-[#2f2f2f] dark:text-[#d0d0d0]"
            >
              Open in new tab
            </button>
          </div>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-6">
          <nav className="flex flex-wrap gap-2" aria-label="Paper explorer tabs">
            {TAB_LABELS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-slate-900 text-white dark:bg-white dark:text-[#171717]"
                    : "border border-slate-200 bg-white text-slate-600 dark:border-[#2f2f2f] dark:bg-[#171717] dark:text-[#d0d0d0]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {loading ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-8 text-center dark:border-[#2f2f2f] dark:bg-[#171717]">
              <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-400 border-t-transparent dark:border-[#8e8e8e]" />
              <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                Loading the pipeline analysis for this paper...
              </p>
            </div>
          ) : null}

          {!loading && error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}

          {!loading && !error && !detail?.available ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-8 dark:border-[#2f2f2f] dark:bg-[#171717]">
              <p className="text-base font-medium text-slate-900 dark:text-[#f2f2f2]">
                Pipeline analysis is not ready yet for this file.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
                The PDF is still available, but the extracted node outputs have not been written
                back for this run yet.
              </p>
            </div>
          ) : null}

          {!loading && !error && detail?.available ? (
            <>
              {detail.warnings && detail.warnings.length > 0 ? (
                <section className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 dark:border-amber-900/60 dark:bg-amber-950/30">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800 dark:text-amber-200">
                    Pipeline warnings
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-800 dark:text-amber-100">
                    {detail.warnings.map((warning, index) => (
                      <li key={`warning-${index}`} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-amber-600 dark:bg-amber-300" />
                        <span>{warning}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {activeTab === "overview" ? (
                <div className="space-y-5">
                  <section className="grid gap-4 lg:grid-cols-3">
                    <article className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#8e8e8e]">
                        Topical coverage
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {detail.topics.length > 0 ? (
                          detail.topics.slice(0, 8).map((topic) => (
                            <span
                              key={topic}
                              className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#111111] dark:text-[#d0d0d0]"
                            >
                              {topic}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                            No topic labels were stored.
                          </span>
                        )}
                      </div>
                    </article>

                    <article className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#8e8e8e]">
                        Grounded keywords
                      </p>
                      <div className="mt-3 space-y-2">
                        {detail.keywords.length > 0 ? (
                          detail.keywords.slice(0, 5).map((keyword, index) => (
                            <div
                              key={`${keyword.keyword}-${index}`}
                              className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-[#242424] dark:bg-[#111111]"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                                  {keyword.keyword}
                                </p>
                                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-[#8e8e8e]">
                                  {keyword.topic || "Unclassified topic"}
                                </p>
                              </div>
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-[#171717] dark:text-[#d0d0d0]">
                                {keyword.frequency}
                              </span>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                            No grounded keyword rows were available.
                          </p>
                        )}
                      </div>
                    </article>

                    <article className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#8e8e8e]">
                        Facet highlights
                      </p>
                      <div className="mt-3 space-y-3">
                        {facetGroups.length > 0 ? (
                          facetGroups.map((group) => (
                            <div key={group.label}>
                              <p className="text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-[#8e8e8e]">
                                {group.label}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {group.items.map((item) => (
                                  <span
                                    key={`${group.label}-${item}`}
                                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#111111] dark:text-[#d0d0d0]"
                                  >
                                    {item}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                            No analytical facet labels were stored.
                          </p>
                        )}
                      </div>
                    </article>
                  </section>

                  {detail.concepts.length > 0 ? (
                    <section className="grid gap-3 lg:grid-cols-2">
                      {detail.concepts.slice(0, 6).map((concept) => (
                        <article
                          key={concept.label}
                          className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900 dark:text-[#f2f2f2]">
                                {concept.label}
                              </p>
                              {concept.matchedTerms.length > 0 ? (
                                <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-[#8e8e8e]">
                                  {concept.matchedTerms.slice(0, 5).join(" | ")}
                                </p>
                              ) : null}
                            </div>
                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-[#111111] dark:text-[#d0d0d0]">
                              {concept.totalFrequency}
                            </span>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-[#cfcfcf]">
                            {concept.firstEvidence ||
                              concept.evidenceSnippets[0] ||
                              "No concept evidence snippet was stored."}
                          </p>
                        </article>
                      ))}
                    </section>
                  ) : null}

                  <section className="grid gap-4 lg:grid-cols-2">
                    <SectionSummaryCard
                      label="Abstract claims"
                      value={detail.abstract_claims}
                    />
                    <SectionSummaryCard label="Methods" value={detail.methods} />
                    <SectionSummaryCard label="Results" value={detail.results} />
                    <SectionSummaryCard label="Conclusion" value={detail.conclusion} />
                  </section>
                </div>
              ) : null}

              {activeTab === "keywords" ? (
                <section className="space-y-3">
                  {detail.keywords.length > 0 ? (
                    detail.keywords.map((keyword, index) => (
                      <article
                        key={`${keyword.keyword}-${index}`}
                        className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 dark:text-[#f2f2f2]">
                              {keyword.keyword}
                            </p>
                            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-[#8e8e8e]">
                              {keyword.topic || "Unclassified topic"}
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-[#111111] dark:text-[#d0d0d0]">
                            {keyword.frequency}
                          </span>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-[#cfcfcf]">
                          {cleanDisplayText(keyword.evidence) ||
                            "No supporting keyword evidence was stored."}
                        </p>
                      </article>
                    ))
                  ) : (
                    <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-8 dark:border-[#2f2f2f] dark:bg-[#171717]">
                      <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                        No grounded keyword rows were available for this paper.
                      </p>
                    </div>
                  )}
                </section>
              ) : null}

              {activeTab === "topics" ? (
                <div className="space-y-5">
                  {detail.concepts.length > 0 ? (
                    <section className="grid gap-3 lg:grid-cols-2">
                      {detail.concepts.map((concept) => (
                        <article
                          key={concept.label}
                          className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-900 dark:text-[#f2f2f2]">
                              {concept.label}
                            </p>
                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-[#111111] dark:text-[#d0d0d0]">
                              {concept.totalFrequency}
                            </span>
                          </div>
                          {concept.relatedKeywords.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {concept.relatedKeywords.slice(0, 8).map((keyword) => (
                                <span
                                  key={`${concept.label}-${keyword}`}
                                  className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#111111] dark:text-[#d0d0d0]"
                                >
                                  {keyword}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-[#cfcfcf]">
                            {concept.firstEvidence ||
                              concept.evidenceSnippets[0] ||
                              "No concept evidence snippet was stored."}
                          </p>
                        </article>
                      ))}
                    </section>
                  ) : (
                    <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-8 dark:border-[#2f2f2f] dark:bg-[#171717]">
                      <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                        No canonical topic groups were available for this paper.
                      </p>
                    </div>
                  )}

                  {detail.facets.length > 0 ? (
                    <section className="grid gap-3 lg:grid-cols-2">
                      {detail.facets.map((facet, index) => (
                        <article
                          key={`${facet.facetType}-${facet.label}-${index}`}
                          className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]"
                        >
                          <p className="text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-[#8e8e8e]">
                            {facet.facetType.replace(/_/g, " ")}
                          </p>
                          <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-[#f2f2f2]">
                            {facet.label}
                          </p>
                          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-[#cfcfcf]">
                            {cleanDisplayText(facet.evidence) ||
                              "No supporting facet evidence was stored."}
                          </p>
                        </article>
                      ))}
                    </section>
                  ) : null}
                </div>
              ) : null}

              {activeTab === "preview" ? (
                <section className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewUrl(null);
                        setPreviewError(null);
                        setPreviewLoading(false);
                      }}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:border-[#2f2f2f] dark:text-[#d0d0d0]"
                    >
                      Refresh preview
                    </button>
                    <button
                      type="button"
                      onClick={() => void onOpenInNewTab()}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:border-[#2f2f2f] dark:text-[#d0d0d0]"
                    >
                      Open in new tab
                    </button>
                  </div>

                  {previewLoading ? (
                    <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-8 text-center dark:border-[#2f2f2f] dark:bg-[#171717]">
                      <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-400 border-t-transparent dark:border-[#8e8e8e]" />
                      <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                        Loading the paper preview...
                      </p>
                    </div>
                  ) : null}

                  {!previewLoading && previewError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                      {previewError}
                    </div>
                  ) : null}

                  {!previewLoading && !previewError && previewUrl ? (
                    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white dark:border-[#2f2f2f] dark:bg-[#171717]">
                      <iframe
                        src={previewUrl}
                        title={detail?.title || titleOf(run)}
                        className="h-[68vh] w-full bg-white"
                      />
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
