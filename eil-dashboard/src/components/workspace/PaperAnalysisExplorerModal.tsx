"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PdfViewer, { prefetchPdf } from "@/components/workspace/PdfViewer";
import Modal from "@/components/ui/Modal";
import { getRunStatusLabel } from "@/lib/ingestion-status";
import {
  ChartIcon,
  CloseIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PencilSquareIcon,
  StarIcon,
} from "@/components/ui/Icons";
import type { IngestionRunRow, RunAnalysisDetail, RunAnalysisExtracted } from "@/types/database";

import { PAPER_EXPLORER_TABS, type PaperExplorerTab } from "@/lib/paper-address";

export { PAPER_EXPLORER_TABS, type PaperExplorerTab };


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
  /** Save a corrected title or year; kept when the paper is analysed again. */
  onCorrect?: (correction: { title?: string; year?: string }) => Promise<void>;
  /** The tab to open on, from the address (?tab=evidence). */
  initialTab?: PaperExplorerTab;
  /** Told when the reader changes tab, so the address can follow. */
  onTabChange?: (tab: PaperExplorerTab) => void;
  /** A passage a chat answer quoted from this paper: shown, and marked in the PDF. */
  quote?: string | null;
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
  // The repository's own categories (with rationale) are shown when the paper
  // was classified. The old el/eli/lae/other slots only carry the EIL names,
  // which are wrong for a custom taxonomy, and "Other" alone just means
  // classification was off.
  if (detail?.classification) return [];
  const badges = [...new Set([...(detail?.tracksSingle ?? []), ...(detail?.tracksMulti ?? [])])];
  return badges.every((badge) => badge.startsWith("Other")) ? [] : badges;
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
      <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
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
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
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

function describeYearSource(source: string): string {
  if (source === "user") return "corrected by you";
  if (source.includes("explicit_publication:issue")) return "the journal issue line";
  if (source.includes("explicit_publication:thesis_year")) return "the thesis cover";
  if (source.includes("explicit_publication:copyright")) return "the copyright notice";
  if (source.includes("explicit_publication:online")) return "the online publication date";
  if (source.includes("explicit_publication")) return "the publication date";
  if (source.startsWith("web:")) return "scholarly metadata online";
  if (source.includes("import_metadata")) return "the upload details";
  if (source.includes("front_matter") || source.includes("title_abstract")) return "the first page";
  return "";
}

/** What the analysis found beyond topics, so a reader can check it. */
function ExtractedDetails({ extracted, year }: { extracted: RunAnalysisExtracted; year?: string | null }) {
  const yearSource = extracted.year ? describeYearSource(extracted.year.source) : "";
  const hasYear = Boolean(year && year !== "Unknown");
  return (
    <section className="grid gap-4 rounded-lg border border-slate-200 bg-white px-4 py-4 dark:border-[#242424] dark:bg-[#050505] lg:grid-cols-2">
      <div>
        <p className="text-xs font-semibold uppercase text-slate-500 dark:text-[#8f8f8f]">Publication year</p>
        <p className="mt-2 text-sm text-slate-800 dark:text-[#e5e5e5]">
          {hasYear ? (
            <>
              <span className="font-semibold">{year}</span>
              {yearSource ? `, from ${yearSource}` : ""}
            </>
          ) : (
            "Not printed clearly in the paper, so it was left unknown. You can correct it above."
          )}
        </p>
        {hasYear && extracted.year?.evidence ? (
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-[#999]">&ldquo;{extracted.year.evidence}&rdquo;</p>
        ) : null}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase text-slate-500 dark:text-[#8f8f8f]">Research type</p>
        {extracted.typology ? (
          <>
            <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-[#e5e5e5]">
              {extracted.typology.primary}
              {extracted.typology.secondary ? <span className="font-normal"> (also {extracted.typology.secondary})</span> : null}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-[#999]">{extracted.typology.verdict}</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-500 dark:text-[#999]">Not classified.</p>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase text-slate-500 dark:text-[#8f8f8f]">The paper&rsquo;s own keywords</p>
        {extracted.authorKeywords.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {extracted.authorKeywords.map((keyword) => (
              <span key={keyword} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 dark:bg-[#111] dark:text-[#d0d0d0]">
                {keyword}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500 dark:text-[#999]">The paper prints no keyword list.</p>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase text-slate-500 dark:text-[#8f8f8f]">Methods found</p>
        <p className="mt-2 text-sm text-slate-800 dark:text-[#e5e5e5]">
          {extracted.methodTopics.length ? extracted.methodTopics.join(", ") : "None identified as separate topics."}
        </p>
      </div>
      {extracted.duplicateOf ? (
        <p className="text-sm text-amber-700 dark:text-amber-300 lg:col-span-2">
          This paper&rsquo;s text closely matches &ldquo;{extracted.duplicateOf.title}&rdquo; in the same repository, so it may be the
          same study uploaded twice.
        </p>
      ) : null}
      {extracted.analysisNotes.length ? (
        <div className="lg:col-span-2">
          <p className="text-xs font-semibold uppercase text-slate-500 dark:text-[#8f8f8f]">Analysis notes</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-600 dark:text-[#bbb]">
            {extracted.analysisNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
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
  onCorrect,
  initialTab,
  onTabChange,
  quote,
}: Props) {
  const [activeTab, setActiveTab] = useState<PaperExplorerTab>(initialTab ?? "overview");
  // Hidden by the reader until a different passage is asked for.
  const [hiddenQuote, setHiddenQuote] = useState<string | null>(null);
  const citedQuote = quote && quote !== hiddenQuote ? quote : null;
  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;
  useEffect(() => {
    onTabChangeRef.current?.(activeTab);
  }, [activeTab]);
  const [correcting, setCorrecting] = useState(false);
  // The button that opened the form disappears while it is open, so focus is
  // put back on it when the form closes instead of falling to the page.
  const correctButtonRef = useRef<HTMLButtonElement>(null);
  const wasCorrecting = useRef(false);
  useEffect(() => {
    if (correcting) {
      wasCorrecting.current = true;
    } else if (wasCorrecting.current) {
      wasCorrecting.current = false;
      correctButtonRef.current?.focus();
    }
  }, [correcting]);
  const [titleDraft, setTitleDraft] = useState("");
  const [yearDraft, setYearDraft] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionSaving, setCorrectionSaving] = useState(false);

  function startCorrection() {
    setTitleDraft(detail?.title || titleOf(run));
    setYearDraft(detail?.year && detail.year !== "Unknown" ? detail.year : "");
    setCorrectionError(null);
    setCorrecting(true);
  }

  async function saveCorrection() {
    if (!onCorrect) return;
    const title = titleDraft.replace(/\s+/g, " ").trim();
    const year = yearDraft.trim() || "Unknown";
    const correction: { title?: string; year?: string } = {};
    if (title && title !== (detail?.title || titleOf(run))) correction.title = title;
    if (year !== (detail?.year || "Unknown")) correction.year = year;
    if (!correction.title && !correction.year) {
      setCorrecting(false);
      return;
    }
    setCorrectionSaving(true);
    setCorrectionError(null);
    try {
      await onCorrect(correction);
      setCorrecting(false);
    } catch (saveError) {
      setCorrectionError(saveError instanceof Error ? saveError.message : "The correction could not be saved.");
    } finally {
      setCorrectionSaving(false);
    }
  }
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
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

  // A different paper opens on the tab it was asked for (a link's ?tab=, or
  // Overview). Resetting to Overview here, on mount too, threw away the tab of
  // every deep link.
  const initialTabRef = useRef(initialTab);
  initialTabRef.current = initialTab;
  useEffect(() => {
    setActiveTab(initialTabRef.current ?? "overview");
    setSelectedEvidenceIndex(0);
  }, [run.id]);

  // The address is resolved once per paper, and again only when asked. The
  // resolver is read through a ref: the parent passes a new function on every
  // render, and re-running on it cancelled the request still in flight, which
  // left the viewer on "Loading the PDF…" for good.
  const resolvePreviewRef = useRef(onResolvePreviewUrl);
  resolvePreviewRef.current = onResolvePreviewUrl;
  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(null);
    setPreviewError(null);

    void resolvePreviewRef
      .current()
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
      });

    return () => {
      cancelled = true;
    };
  }, [run.id, previewAttempt]);

  return (
    <Modal onClose={onClose}>
      <div className="flex max-h-[92vh] w-[min(1180px,94vw)] flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-overlay">
        <div className="flex-none border-b border-hairline px-5 pb-4 pt-5 sm:px-7 sm:pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {correcting ? (
                <form
                  className="mt-2 grid gap-2 sm:grid-cols-[1fr_7rem_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveCorrection();
                  }}
                >
                  <label className="text-xs text-slate-500 dark:text-[#8e8e8e]">
                    Title
                    <input
                      autoFocus
                      name="title"
                      autoComplete="off"
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      aria-describedby={correctionError ? "correction-error" : undefined}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 dark:border-[#2a2a2a] dark:bg-[#050505] dark:text-white sm:text-sm"
                    />
                  </label>
                  <label className="text-xs text-slate-500 dark:text-[#8e8e8e]">
                    Year
                    <input
                      name="year"
                      autoComplete="off"
                      value={yearDraft}
                      onChange={(event) => setYearDraft(event.target.value)}
                      aria-describedby={correctionError ? "correction-error" : undefined}
                      placeholder="Unknown"
                      inputMode="numeric"
                      maxLength={4}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 dark:border-[#2a2a2a] dark:bg-[#050505] dark:text-white sm:text-sm"
                    />
                  </label>
                  <div className="flex items-end gap-2">
                    <button
                      type="submit"
                      disabled={correctionSaving}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
                    >
                      {correctionSaving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCorrecting(false)}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 dark:border-[#1f1f1f] dark:text-[#d0d0d0]"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-[#8e8e8e] sm:col-span-3">
                    Your correction is kept when the paper is analysed again. Leave the year empty if the paper has none.
                  </p>
                  {correctionError ? (
                    <p id="correction-error" role="alert" className="text-xs text-red-700 dark:text-red-300 sm:col-span-3">{correctionError}</p>
                  ) : null}
                </form>
              ) : (
                <h2 className="text-xl font-semibold leading-snug tracking-tight text-ink sm:text-2xl">
                  {detail?.title || titleOf(run)}
                </h2>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-subtle px-2.5 py-1 text-xs font-medium text-body tabular-nums">
                  {detail?.year || "Year unavailable"}
                </span>
                {onCorrect && !correcting && run.status === "succeeded" ? (
                  <button
                    type="button"
                    ref={correctButtonRef}
                    onClick={startCorrection}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-body ring-1 ring-inset ring-hairline transition-colors hover:bg-subtle hover:text-ink"
                  >
                    <PencilSquareIcon className="h-3.5 w-3.5" />
                    <span>Correct title or year</span>
                  </button>
                ) : null}
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {run.status === "succeeded" ? "Analysis ready" : getRunStatusLabel(run)}
                </span>
                {/* Where the rows came from matters only when it is not the
                    paper's own finished analysis; the old chip named pipeline
                    internals, which told a reader nothing. */}
                {detail?.diagnostics?.dataSource !== "canonical" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    <ChartIcon className="h-3.5 w-3.5" />
                    <span>{detail?.available ? "Recovered from an earlier analysis" : "Not analyzed yet"}</span>
                  </span>
                ) : null}
              </div>
              {trackBadges.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {trackBadges.map((track) => (
                    <span
                      key={track}
                      className="rounded-full bg-subtle px-2.5 py-1 text-xs font-medium text-body"
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
              className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg text-mute transition-colors duration-150 hover:bg-subtle hover:text-ink"
              aria-label="Close paper explorer"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>

          {/* Wraps rather than scrolling: on a phone a sideways-scrolling row
              looked like two buttons with a third cut off. */}
          <div className="mt-5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onDownloadReport}
              className="inline-flex h-8 flex-none items-center gap-2 whitespace-nowrap rounded-lg border border-hairline bg-surface px-3 text-[13px] font-medium text-ink shadow-raise transition-[background-color,border-color,transform] duration-150 hover:border-hairline-strong hover:bg-subtle active:scale-[0.98]"
            >
              <DownloadIcon className="h-4 w-4" />
              <span>Download report</span>
            </button>
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex h-8 flex-none items-center gap-2 whitespace-nowrap rounded-lg border border-hairline bg-surface px-3 text-[13px] font-medium text-ink shadow-raise transition-[background-color,border-color,transform] duration-150 hover:border-hairline-strong hover:bg-subtle active:scale-[0.98]"
            >
              <DownloadIcon className="h-4 w-4" />
              <span>Download PDF</span>
            </button>
            <button
              type="button"
              onClick={onToggleFavorite}
              className="inline-flex h-8 flex-none items-center gap-2 whitespace-nowrap rounded-lg border border-hairline bg-surface px-3 text-[13px] font-medium text-ink shadow-raise transition-[background-color,border-color,transform] duration-150 hover:border-hairline-strong hover:bg-subtle active:scale-[0.98]"
            >
              <StarIcon className="h-4 w-4" weight={run.is_favorite ? "fill" : "regular"} />
              <span>{run.is_favorite ? "Favorited" : "Favorite"}</span>
            </button>
            <button
              type="button"
              onClick={onRename}
              className="inline-flex h-8 flex-none items-center gap-2 whitespace-nowrap rounded-lg border border-hairline bg-surface px-3 text-[13px] font-medium text-ink shadow-raise transition-[background-color,border-color,transform] duration-150 hover:border-hairline-strong hover:bg-subtle active:scale-[0.98]"
            >
              <PencilSquareIcon className="h-4 w-4" />
              <span>Rename</span>
            </button>
            <button
              type="button"
              onClick={onOpenDashboard}
              className="inline-flex h-8 flex-none items-center gap-2 whitespace-nowrap rounded-lg border border-hairline bg-surface px-3 text-[13px] font-medium text-ink shadow-raise transition-[background-color,border-color,transform] duration-150 hover:border-hairline-strong hover:bg-subtle active:scale-[0.98]"
            >
              <ChartIcon className="h-4 w-4" />
              Open dashboard charts
            </button>
            <button
              type="button"
              onClick={() => void onOpenInNewTab()}
              className="inline-flex h-8 flex-none items-center gap-2 whitespace-nowrap rounded-lg border border-hairline bg-surface px-3 text-[13px] font-medium text-ink shadow-raise transition-[background-color,border-color,transform] duration-150 hover:border-hairline-strong hover:bg-subtle active:scale-[0.98]"
            >
              <ExternalLinkIcon className="h-4 w-4" />
              Open in new tab
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-7 sm:pb-7">
          <nav className="sticky top-0 z-20 -mx-5 mb-6 flex flex-nowrap gap-1 overflow-x-auto border-b border-hairline bg-surface/90 px-5 pt-2 backdrop-blur-md sm:-mx-7 sm:px-7" aria-label="Paper explorer tabs">
            {TAB_LABELS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                onPointerEnter={() => {
                  if ((tab.id === "evidence" || tab.id === "preview") && previewUrl) prefetchPdf(run.id, previewUrl);
                }}
                onFocus={() => {
                  if ((tab.id === "evidence" || tab.id === "preview") && previewUrl) prefetchPdf(run.id, previewUrl);
                }}
                aria-current={activeTab === tab.id ? "page" : undefined}
                // The border lives in the base class, not on one branch. It used
                // to sit only on the inactive tabs, and under border-box sizing
                // that made every inactive tab 2px larger than the active one -
                // so clicking a tab reflowed the whole nowrap row sideways.
                className={`tab-btn ${activeTab === tab.id ? "tab-btn-active" : "tab-btn-inactive"}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* The passage a chat answer quoted from this paper. It sits above
              every tab, so the reader still has it when the PDF cannot mark
              it: a scan has no text to find it in, and a PDF that will not
              load falls back to the browser's viewer. */}
          {citedQuote ? (
            <section
              aria-label="Passage cited in the answer"
              className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/20"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">Passage cited in the answer</p>
                <div className="flex items-center gap-1">
                  {activeTab !== "preview" ? (
                    <button
                      type="button"
                      onClick={() => setActiveTab("preview")}
                      className="rounded-md px-2 py-1 text-xs font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-200"
                    >
                      Show in the PDF
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setHiddenQuote(citedQuote)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-200"
                  >
                    Hide
                  </button>
                </div>
              </div>
              <blockquote className="mt-2 break-words border-l-2 border-amber-400 pl-3 text-sm leading-7 text-ink dark:border-amber-600">
                {citedQuote}
              </blockquote>
            </section>
          ) : null}

          {loading ? (
            <div className="space-y-4" role="status">
              <span className="skeleton block h-40 w-full rounded-xl" />
              <span className="skeleton block h-56 w-full rounded-xl" />
              <p className="text-center text-sm text-mute">Loading this paper&apos;s analysis…</p>
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
                  {detail.classification ? (
                    <section className="rounded-lg border border-slate-200 bg-white px-4 py-4 dark:border-[#242424] dark:bg-[#050505]">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-500 dark:text-[#8f8f8f]">{detail.classification.taxonomyName}</p>
                          <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">{detail.classification.primaryCategory}</p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${detail.classification.status === "current" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"}`}>
                          {detail.classification.status === "current" ? "Current profile" : "Needs reclassification"}
                        </span>
                      </div>
                      {detail.classification.additionalCategories.length ? <p className="mt-2 text-sm text-slate-500 dark:text-[#999]">Also: {detail.classification.additionalCategories.join(", ")}</p> : null}
                      <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-[#bbb]">{detail.classification.rationale}</p>
                      <p className="mt-3 text-xs text-slate-500 dark:text-[#8f8f8f]">Profile v{detail.classification.profileVersion}{detail.classification.classifiedAt ? ` - ${new Date(detail.classification.classifiedAt).toLocaleDateString()}` : ""}</p>
                    </section>
                  ) : null}
                  {detail.extracted ? <ExtractedDetails extracted={detail.extracted} year={detail.year} /> : null}
                  <section className="grid gap-4 lg:grid-cols-3">
                    <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                      <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
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
                      <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
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
                                <p className="mt-1 text-xs uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
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
                      <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                        Facet highlights
                      </p>
                      <div className="mt-3 space-y-3">
                        {facetGroups.length > 0 ? (
                          facetGroups.map((group) => (
                            <div key={group.label}>
                              <p className="text-xs uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
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
                                <p className="mt-2 text-xs uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
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
                            <p className="mt-1 text-xs uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
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

                        {previewError ? (
                          <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                            {previewError}
                          </div>
                        ) : (
                          <div className="p-3">
                            <PdfViewer
                              cacheKey={run.id}
                              url={previewUrl}
                              title={`Source PDF for ${selectedEvidence?.keyword || titleOf(run)}`}
                              highlight={selectedEvidence ? [selectedEvidence.evidence, selectedEvidence.context] : null}
                              highlightKey={String(selectedEvidenceIndex)}
                              heightClass="h-[440px] lg:h-[520px]"
                            />
                          </div>
                        )}
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
                          <p className="text-xs uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
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
                      onClick={() => setPreviewAttempt((attempt) => attempt + 1)}
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

                  {previewError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                      {previewError}
                    </div>
                  ) : null}

                  {!previewError ? (
                    <PdfViewer
                      cacheKey={run.id}
                      url={previewUrl}
                      title={detail?.title || titleOf(run)}
                      heightClass="h-[68vh]"
                      highlight={citedQuote}
                      highlightKey={citedQuote ?? undefined}
                    />
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
