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

type PaperExplorerTab = "overview" | "keywords" | "evidence" | "topics" | "preview";

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
  { id: "evidence", label: "Evidence" },
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSearchText(value: string | null | undefined): string {
  return cleanDisplayText(value).toLowerCase();
}

function findContextWindow(text: string, index: number, radius = 340): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return cleanDisplayText(`${prefix}${text.slice(start, end)}${suffix}`);
}

function findKeywordContext(
  rawText: string | null | undefined,
  keyword: string,
  evidence: string
) {
  const text = cleanDisplayText(rawText);
  if (!text) {
    return { context: "", matchType: "no_full_text" as const };
  }

  const lowerText = text.toLowerCase();
  const evidenceProbe = cleanDisplayText(evidence).slice(0, 180).toLowerCase();
  if (evidenceProbe.length >= 24) {
    const evidenceIndex = lowerText.indexOf(evidenceProbe);
    if (evidenceIndex >= 0) {
      return {
        context: findContextWindow(text, evidenceIndex + Math.floor(evidenceProbe.length / 2)),
        matchType: "evidence_match" as const,
      };
    }
  }

  const keywordProbe = cleanDisplayText(keyword).toLowerCase();
  if (keywordProbe.length >= 3) {
    const keywordIndex = lowerText.indexOf(keywordProbe);
    if (keywordIndex >= 0) {
      return {
        context: findContextWindow(text, keywordIndex + Math.floor(keywordProbe.length / 2)),
        matchType: "keyword_match" as const,
      };
    }
  }

  return { context: "", matchType: "stored_evidence_only" as const };
}

function inferEvidenceSection(
  detail: RunAnalysisDetail | null,
  evidence: string,
  context: string
): string {
  const probe = normalizeSearchText(evidence || context).slice(0, 120);
  if (!probe) {
    return "Section not resolved";
  }

  const sections: Array<[string, string | null | undefined]> = [
    ["Abstract / claims", detail?.abstract_claims],
    ["Methods", detail?.methods],
    ["Results", detail?.results],
    ["Conclusion", detail?.conclusion],
    ["Full text", detail?.raw_text],
  ];

  for (const [label, value] of sections) {
    if (normalizeSearchText(value).includes(probe)) {
      return label;
    }
  }

  return "Full text";
}

function HighlightedText({
  text,
  terms,
}: {
  text: string;
  terms: string[];
}) {
  const activeTerms = terms.map(cleanDisplayText).filter((term) => term.length >= 3);
  if (!text || activeTerms.length === 0) {
    return <>{text}</>;
  }

  const pattern = new RegExp(`(${activeTerms.map(escapeRegExp).join("|")})`, "ig");
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, index) => {
        const isMatch = activeTerms.some(
          (term) => part.toLowerCase() === term.toLowerCase()
        );
        return isMatch ? (
          <mark
            key={`${part}-${index}`}
            className="rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-400/20 dark:text-amber-100"
          >
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        );
      })}
    </>
  );
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

function buildKeywordEvidenceRows(detail: RunAnalysisDetail | null) {
  return (detail?.keywords ?? []).map((keyword, index) => {
    const evidence = cleanDisplayText(keyword.evidence);
    const match = findKeywordContext(detail?.raw_text, keyword.keyword, evidence);
    return {
      ...keyword,
      index,
      evidence,
      context: match.context,
      matchType: match.matchType,
      section: inferEvidenceSection(detail, evidence, match.context),
    };
  });
}

function buildPdfEvidenceUrl(
  url: string,
  evidence: { keyword: string; evidence: string; context: string }
): string {
  const baseUrl = url.split("#", 1)[0];
  const searchText = cleanDisplayText(
    evidence.evidence || evidence.context || evidence.keyword
  ).slice(0, 120);
  return searchText
    ? `${baseUrl}#zoom=page-width&search=${encodeURIComponent(searchText)}`
    : `${baseUrl}#zoom=page-width`;
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
    <article className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-5 dark:border-[#1f1f1f] dark:bg-[#050505]">
      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
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
        <details className="mt-4 border-t border-slate-200 pt-4 dark:border-[#242424]">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
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
  const [selectedEvidenceIndex, setSelectedEvidenceIndex] = useState(0);
  const trackBadges = useMemo(() => buildTrackBadges(detail), [detail]);
  const facetGroups = useMemo(() => summarizeFacetGroups(detail), [detail]);
  const keywordEvidenceRows = useMemo(
    () => buildKeywordEvidenceRows(detail),
    [detail]
  );
  const fullTextEvidenceMatchCount = useMemo(
    () =>
      keywordEvidenceRows.filter(
        (row) =>
          row.matchType === "evidence_match" || row.matchType === "keyword_match"
      ).length,
    [keywordEvidenceRows]
  );
  const selectedEvidence = keywordEvidenceRows[selectedEvidenceIndex] ?? null;
  const locatedPreviewUrl = useMemo(
    () =>
      previewUrl && selectedEvidence
        ? buildPdfEvidenceUrl(previewUrl, selectedEvidence)
        : previewUrl,
    [previewUrl, selectedEvidence]
  );

  useEffect(() => {
    setActiveTab("overview");
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setSelectedEvidenceIndex(0);
  }, [run.id]);

  useEffect(() => {
    if (
      (activeTab !== "preview" && activeTab !== "evidence") ||
      previewUrl ||
      previewLoading
    ) {
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
      <div className="flex max-h-[92vh] w-[min(1180px,94vw)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#030303]">
        <div className="flex-none border-b border-slate-200 px-5 py-5 dark:border-[#1f1f1f] sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
                Paper Explorer
              </p>
              <h2 className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                {detail?.title || titleOf(run)}
              </h2>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-[#050505] dark:text-[#d0d0d0]">
                  {detail?.year || "Year unavailable"}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-[#050505] dark:text-[#d0d0d0]">
                  {run.status === "succeeded" ? "Pipeline analysis ready" : run.status}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-[#050505] dark:text-[#d0d0d0]">
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
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d7d7d7]"
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
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0]"
              aria-label="Close paper explorer"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 flex items-center gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={onDownloadReport}
              className="inline-flex flex-none items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#1f1f1f] dark:text-[#d0d0d0] dark:hover:bg-[#0a0a0a]"
            >
              <DownloadIcon className="h-4 w-4" />
              <span>Download report</span>
            </button>
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex flex-none items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#1f1f1f] dark:text-[#d0d0d0] dark:hover:bg-[#0a0a0a]"
            >
              <DownloadIcon className="h-4 w-4" />
              <span>Download PDF</span>
            </button>
            <button
              type="button"
              onClick={onToggleFavorite}
              className="inline-flex flex-none items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#1f1f1f] dark:text-[#d0d0d0] dark:hover:bg-[#0a0a0a]"
            >
              <StarIcon className="h-4 w-4" />
              <span>{run.is_favorite ? "Favorited" : "Favorite"}</span>
            </button>
            <button
              type="button"
              onClick={onRename}
              className="inline-flex flex-none items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#1f1f1f] dark:text-[#d0d0d0] dark:hover:bg-[#0a0a0a]"
            >
              <PencilSquareIcon className="h-4 w-4" />
              <span>Rename</span>
            </button>
            <button
              type="button"
              onClick={onOpenDashboard}
              className="flex-none whitespace-nowrap rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#1f1f1f] dark:text-[#d0d0d0] dark:hover:bg-[#0a0a0a]"
            >
              Open dashboard charts
            </button>
            <button
              type="button"
              onClick={() => void onOpenInNewTab()}
              className="flex-none whitespace-nowrap rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#1f1f1f] dark:text-[#d0d0d0] dark:hover:bg-[#0a0a0a]"
            >
              Open in new tab
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">
          <nav className="sticky top-0 z-20 -mx-5 mb-5 flex flex-nowrap gap-2 overflow-x-auto border-b border-slate-200 bg-white px-5 py-3 dark:border-[#1f1f1f] dark:bg-[#030303] sm:-mx-6 sm:px-6" aria-label="Paper explorer tabs">
            {TAB_LABELS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex-none rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-slate-900 text-white dark:bg-white dark:text-[#171717]"
                    : "border border-slate-200 bg-white text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-8 text-center dark:border-[#1f1f1f] dark:bg-[#050505]">
              <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-400 border-t-transparent dark:border-[#8e8e8e]" />
              <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                Loading the pipeline analysis for this paper...
              </p>
            </div>
          ) : null}

          {!loading && error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}

          {!loading && !error && !detail?.available ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-8 dark:border-[#1f1f1f] dark:bg-[#050505]">
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
                <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 dark:border-amber-900/60 dark:bg-amber-950/30">
                  <p className="text-xs font-semibold uppercase tracking-normal text-amber-800 dark:text-amber-200">
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
                    <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
                        Topical coverage
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {detail.topics.length > 0 ? (
                          detail.topics.slice(0, 8).map((topic) => (
                            <span
                              key={topic}
                              className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#030303] dark:text-[#d0d0d0]"
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

                    <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
                        Grounded keywords
                      </p>
                      <div className="mt-3 space-y-2">
                        {detail.keywords.length > 0 ? (
                          detail.keywords.slice(0, 5).map((keyword, index) => (
                            <div
                              key={`${keyword.keyword}-${index}`}
                              className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-[#1f1f1f] dark:bg-[#030303]"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                                  {keyword.keyword}
                                </p>
                                <p className="mt-1 text-xs uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
                                  {keyword.topic || "Unclassified topic"}
                                </p>
                              </div>
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-[#050505] dark:text-[#d0d0d0]">
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

                    <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
                        Facet highlights
                      </p>
                      <div className="mt-3 space-y-3">
                        {facetGroups.length > 0 ? (
                          facetGroups.map((group) => (
                            <div key={group.label}>
                              <p className="text-xs uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
                                {group.label}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {group.items.map((item) => (
                                  <span
                                    key={`${group.label}-${item}`}
                                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#030303] dark:text-[#d0d0d0]"
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
                          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900 dark:text-[#f2f2f2]">
                                {concept.label}
                              </p>
                              {concept.matchedTerms.length > 0 ? (
                                <p className="mt-2 text-xs uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
                                  {concept.matchedTerms.slice(0, 5).join(" | ")}
                                </p>
                              ) : null}
                            </div>
                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-[#030303] dark:text-[#d0d0d0]">
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
                        className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 dark:text-[#f2f2f2]">
                              {keyword.keyword}
                            </p>
                            <p className="mt-1 text-xs uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
                              {keyword.topic || "Unclassified topic"}
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-[#030303] dark:text-[#d0d0d0]">
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
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-8 dark:border-[#1f1f1f] dark:bg-[#050505]">
                      <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                        No grounded keyword rows were available for this paper.
                      </p>
                    </div>
                  )}
                </section>
              ) : null}

              {activeTab === "evidence" ? (
                <section className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-[#f2f2f2]">
                          Evidence reader
                        </p>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
                          Select an extracted claim to inspect its stored rationale, matched
                          text, and source PDF together.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-[#030303] dark:text-[#d0d0d0]">
                          {keywordEvidenceRows.length} keywords
                        </span>
                        <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-[#030303] dark:text-[#d0d0d0]">
                          {fullTextEvidenceMatchCount} full-text matches
                        </span>
                      </div>
                    </div>
                  </div>

                  {keywordEvidenceRows.length > 0 ? (
                    <div className="grid min-h-[620px] overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#030303] lg:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.35fr)]">
                      <div className="border-b border-slate-200 dark:border-[#1f1f1f] lg:border-b-0 lg:border-r">
                        <div className="max-h-[620px] overflow-y-auto p-2">
                          {keywordEvidenceRows.map((row) => {
                            const isSelected = row.index === selectedEvidenceIndex;
                            return (
                              <button
                                key={`${row.keyword}-${row.index}`}
                                type="button"
                                onClick={() => setSelectedEvidenceIndex(row.index)}
                                aria-pressed={isSelected}
                                className={`w-full rounded-lg px-3 py-3 text-left transition-colors ${
                                  isSelected
                                    ? "bg-slate-100 text-slate-950 dark:bg-[#111111] dark:text-white"
                                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-[#b7b7b7] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                                }`}
                              >
                                <span className="flex items-start justify-between gap-3">
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-semibold">
                                      {row.keyword}
                                    </span>
                                    <span className="mt-1 block truncate text-xs text-slate-500 dark:text-[#858585]">
                                      {row.topic || "Unclassified topic"} | {row.section}
                                    </span>
                                  </span>
                                  <span className="flex-none rounded-full border border-slate-200 px-2 py-0.5 text-[11px] dark:border-[#2a2a2a]">
                                    {row.frequency}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="min-w-0">
                        {selectedEvidence ? (
                          <div className="border-b border-slate-200 p-4 dark:border-[#1f1f1f]">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                  {selectedEvidence.keyword}
                                </p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-[#8e8e8e]">
                                  {selectedEvidence.section}
                                </p>
                              </div>
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-[#111111] dark:text-[#cfcfcf]">
                                {selectedEvidence.matchType === "evidence_match"
                                  ? "Exact evidence match"
                                  : selectedEvidence.matchType === "keyword_match"
                                    ? "Keyword match"
                                    : "Stored rationale"}
                              </span>
                            </div>
                            <div className="mt-4 grid gap-4 xl:grid-cols-2">
                              <div>
                                <p className="text-xs font-semibold text-slate-500 dark:text-[#8e8e8e]">
                                  Stored rationale
                                </p>
                                <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-[#d4d4d4]">
                                  {selectedEvidence.evidence ? (
                                    <HighlightedText
                                      text={selectedEvidence.evidence}
                                      terms={[selectedEvidence.keyword]}
                                    />
                                  ) : (
                                    "No supporting rationale was stored."
                                  )}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-500 dark:text-[#8e8e8e]">
                                  Matched text context
                                </p>
                                <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-[#d4d4d4]">
                                  {selectedEvidence.context ? (
                                    <HighlightedText
                                      text={selectedEvidence.context}
                                      terms={[selectedEvidence.keyword]}
                                    />
                                  ) : (
                                    "No matching extracted-text context could be located."
                                  )}
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {previewLoading ? (
                          <div className="flex h-[420px] items-center justify-center text-sm text-slate-500 dark:text-[#999999]">
                            Loading source PDF...
                          </div>
                        ) : previewError ? (
                          <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                            {previewError}
                          </div>
                        ) : locatedPreviewUrl ? (
                          <iframe
                            key={locatedPreviewUrl}
                            src={locatedPreviewUrl}
                            title={`Source PDF for ${selectedEvidence?.keyword || titleOf(run)}`}
                            className="h-[440px] w-full bg-white lg:h-[480px]"
                          />
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-8 dark:border-[#1f1f1f] dark:bg-[#050505]">
                      <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                        No keyword evidence rows were available for this paper.
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
                          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-900 dark:text-[#f2f2f2]">
                              {concept.label}
                            </p>
                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-[#030303] dark:text-[#d0d0d0]">
                              {concept.totalFrequency}
                            </span>
                          </div>
                          {concept.relatedKeywords.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {concept.relatedKeywords.slice(0, 8).map((keyword) => (
                                <span
                                  key={`${concept.label}-${keyword}`}
                                  className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#030303] dark:text-[#d0d0d0]"
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
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-8 dark:border-[#1f1f1f] dark:bg-[#050505]">
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
                          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]"
                        >
                          <p className="text-xs uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
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
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:border-[#1f1f1f] dark:text-[#d0d0d0]"
                    >
                      Refresh preview
                    </button>
                    <button
                      type="button"
                      onClick={() => void onOpenInNewTab()}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:border-[#1f1f1f] dark:text-[#d0d0d0]"
                    >
                      Open in new tab
                    </button>
                  </div>

                  {previewLoading ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-8 text-center dark:border-[#1f1f1f] dark:bg-[#050505]">
                      <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-400 border-t-transparent dark:border-[#8e8e8e]" />
                      <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                        Loading the paper preview...
                      </p>
                    </div>
                  ) : null}

                  {!previewLoading && previewError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                      {previewError}
                    </div>
                  ) : null}

                  {!previewLoading && !previewError && previewUrl ? (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505]">
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
