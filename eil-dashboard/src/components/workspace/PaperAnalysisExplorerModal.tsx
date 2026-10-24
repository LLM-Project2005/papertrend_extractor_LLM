"use client";

// React in scope: the test runner compiles JSX the classic way.
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import PdfViewer, { prefetchPdf, type PdfMark } from "@/components/workspace/PdfViewer";
import EvidenceText from "@/components/workspace/EvidenceText";
import Modal from "@/components/ui/Modal";
import { getRunStatusLabel } from "@/lib/ingestion-status";
import {
  ChartIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FilePdfIcon,
  PencilSquareIcon,
  StarIcon,
} from "@/components/ui/Icons";
import type { IngestionRunRow, RunAnalysisDetail, RunAnalysisExtracted } from "@/types/database";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useRepositoryTrends } from "@/hooks/useData";
import { runProjectId } from "@/lib/recent-papers";
import { OTHER_THEME_COLOR, paperThemes, themeColorMap, tint, topicKey, type PaperTheme } from "@/lib/theme-colors";
import { effectiveTextKind, textKindChip, type PdfTextKind } from "@/lib/pdf-text-kind";

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
  /** The list this paper was opened from, to step through with Previous and Next. */
  stepper?: PaperStepper | null;
  /**
   * Where this paper's topics sit among its repository's themes, keyed by
   * topicKey(label): the Topics tab names each one's theme in its colour.
   * The window works it out itself; the render tests pass it in.
   */
  themes?: Map<string, PaperTheme> | null;
};

/**
 * The paper's place in the list it was opened from (a chart's papers, a
 * search, the Library), so the next one is a click or an arrow key away
 * instead of a trip back to the list (2026-10-21).
 */
export interface PaperStepper {
  /** 1-based. */
  position: number;
  total: number;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  /** The button the reader stepped with, which keeps focus on the next paper. */
  focus?: "previous" | "next" | null;
  /** Why the last step did not happen (the paper could not be opened); this one stays. */
  notice?: string | null;
}

/** Arrow keys step only when they would do nothing else: not while typing, choosing or with a modifier (Alt+← is Back). */
export function stepFromKey(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target">): -1 | 1 | null {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return null;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const target = event.target as HTMLElement | null;
  if (target && typeof target.closest === "function" && target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="tablist"], [role="listbox"], [role="menu"]')) return null;
  return event.key === "ArrowLeft" ? -1 : 1;
}

// Keywords and Topics showed the same rows twice, grouped two ways; Topics
// holds them both now (2026-10-24 review).
const TAB_LABELS: Array<{ id: PaperExplorerTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "topics", label: "Topics" },
  { id: "evidence", label: "Evidence" },
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

type KeywordEvidenceRow = ReturnType<typeof buildKeywordEvidenceRows>[number];

export interface TopicGroup {
  key: string;
  label: string;
  /** Mentions of the topic in the paper: its concept's total, or its keywords' sum. */
  mentions: number;
  /** The keywords filed under the topic, most mentioned first, each with its evidence. */
  rows: KeywordEvidenceRow[];
  /** Further keywords the topic gathered, with no evidence row of their own. */
  otherKeywords: string[];
  /** For a topic with no keyword rows: the sentence its concept was found in. */
  evidence: string;
  method: boolean;
  theme: PaperTheme | null;
}

/**
 * One group per topic: its keywords with their evidence, and its theme in the
 * repository. The Keywords and Topics tabs drew these same rows twice, by
 * keyword and by topic; this is the one view of them (2026-10-24 review).
 * Pure, so it is tested.
 */
export function buildTopicGroups(
  detail: RunAnalysisDetail | null,
  rows: KeywordEvidenceRow[],
  themes?: Map<string, PaperTheme> | null
): TopicGroup[] {
  const methods = new Set((detail?.extracted?.methodTopics ?? []).map(topicKey));
  const groups = new Map<string, TopicGroup>();
  const group = (label: string): TopicGroup => {
    const key = topicKey(label);
    let entry = groups.get(key);
    if (!entry) {
      const theme = themes?.get(key) ?? null;
      entry = { key, label, mentions: 0, rows: [], otherKeywords: [], evidence: "", method: methods.has(key) || Boolean(theme?.method), theme };
      groups.set(key, entry);
    }
    return entry;
  };
  for (const row of rows) {
    const entry = group(String(row.topic ?? "").trim() || "Unclassified topic");
    entry.rows.push(row);
    entry.mentions += Math.max(0, Number(row.frequency) || 0);
  }
  for (const concept of detail?.concepts ?? []) {
    const entry = group(concept.label);
    entry.mentions = Math.max(entry.mentions, Number(concept.totalFrequency) || 0);
    const listed = new Set(entry.rows.map((row) => topicKey(row.keyword)));
    entry.otherKeywords = concept.relatedKeywords.filter((keyword) => !listed.has(topicKey(keyword))).slice(0, 8);
    entry.evidence = cleanDisplayText(concept.firstEvidence || concept.evidenceSnippets[0] || "");
  }
  for (const entry of groups.values()) entry.rows.sort((left, right) => (Number(right.frequency) || 0) - (Number(left.frequency) || 0));
  return [...groups.values()].sort((left, right) => right.mentions - left.mentions || left.label.localeCompare(right.label));
}

/** "Theme: Academic and Second Language Writing · 7 papers", "Only in this paper", or "Research method". */
export function themeLine(group: Pick<TopicGroup, "method" | "theme">): string | null {
  if (group.method) return "Research method";
  if (!group.theme) return null;
  if (group.theme.papers <= 1) return "Only in this paper";
  return `Theme: ${group.theme.theme} · ${group.theme.papers} papers`;
}

function ThemeDot({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: color }} />;
}

/** One keyword under its topic: how often, the sentence it was found in, and a way to it in the PDF. */
function KeywordRow({
  row,
  onShowInPdf,
  showLabel = "Show in PDF",
}: {
  row: KeywordEvidenceRow;
  onShowInPdf?: (row: KeywordEvidenceRow) => void;
  /** "Show in text" for a scan, whose evidence is shown in its OCR text. */
  showLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const evidence = cleanDisplayText(row.evidence);
  return (
    <li className="grid gap-x-4 gap-y-1 border-t border-hairline px-4 py-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] sm:items-start">
      <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
        <p className="text-sm font-medium text-ink">{row.keyword}</p>
        <p className="text-xs tabular-nums text-mute sm:mt-0.5">
          {row.frequency} mention{Number(row.frequency) === 1 ? "" : "s"}
        </p>
      </div>
      {evidence ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={`min-w-0 text-left text-sm leading-6 text-body transition-colors hover:text-ink ${open ? "" : "line-clamp-2"}`}
          title={open ? "Show less" : "Show the whole sentence"}
        >
          {evidence}
        </button>
      ) : (
        <p className="text-sm leading-6 text-mute">No evidence sentence was stored.</p>
      )}
      {onShowInPdf && evidence ? (
        <button
          type="button"
          onClick={() => onShowInPdf(row)}
          className="inline-flex h-8 items-center gap-1.5 justify-self-start whitespace-nowrap rounded-md px-2 text-xs font-medium text-body transition-colors hover:bg-subtle hover:text-ink"
        >
          <FilePdfIcon className="h-3.5 w-3.5" />
          {showLabel}
        </button>
      ) : null}
    </li>
  );
}

/** The Topics tab: one card per topic, in its theme's colour, with its keywords and their evidence. */
function TopicsTab({
  groups,
  facets,
  themesKnown,
  onShowInPdf,
  showLabel,
}: {
  groups: TopicGroup[];
  facets: RunAnalysisDetail["facets"];
  themesKnown: boolean;
  onShowInPdf?: (row: KeywordEvidenceRow) => void;
  showLabel?: string;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-hairline bg-subtle px-5 py-8">
        <p className="text-sm text-mute">No topics or keywords were stored for this paper.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {themesKnown ? (
        <p className="text-xs leading-5 text-body">
          Each topic carries the colour of its theme in this repository, the same as on the dashboard. Grey is a theme outside the largest sixteen, one only this paper has, or a research method.
        </p>
      ) : null}
      {groups.map((group) => {
        // No colour at all when the paper's themes are unknown (its repository is
        // not the one open, or its data has not arrived): grey would say "another theme".
        const color = group.method ? OTHER_THEME_COLOR : group.theme?.color ?? null;
        const line = themeLine(group);
        return (
          <article
            key={group.key}
            data-topic={group.label}
            className="overflow-hidden rounded-xl border border-hairline bg-surface"
            style={color ? { borderLeftWidth: 4, borderLeftColor: color } : undefined}
          >
            <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-ink">{group.label}</h3>
                {line ? (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-body">
                    <ThemeDot color={color ?? OTHER_THEME_COLOR} />
                    {line}
                  </p>
                ) : null}
              </div>
              <span className="text-xs tabular-nums text-mute">
                {group.mentions} mention{group.mentions === 1 ? "" : "s"}
              </span>
            </header>
            {group.rows.length > 0 ? (
              <ul>
                {group.rows.map((row) => (
                  <KeywordRow key={`${group.key}-${row.index}`} row={row} onShowInPdf={onShowInPdf} showLabel={showLabel} />
                ))}
              </ul>
            ) : group.evidence ? (
              <p className="border-t border-hairline px-4 py-3 text-sm leading-6 text-body">{group.evidence}</p>
            ) : null}
            {group.otherKeywords.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline px-4 py-3">
                <span className="mr-1 text-xs text-mute">Also</span>
                {group.otherKeywords.map((keyword) => (
                  <span
                    key={`${group.key}-${keyword}`}
                    className="rounded-full border px-2.5 py-1 text-xs text-ink"
                    style={color ? { backgroundColor: tint(color, 0.1), borderColor: tint(color, 0.35) } : undefined}
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
      {facets.length > 0 ? (
        <section aria-label="Also found" className="overflow-hidden rounded-xl border border-hairline bg-surface">
          <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-normal text-mute">Also found</p>
          <ul className="mt-2">
            {facets.map((facet, index) => (
              <li key={`${facet.facetType}-${facet.label}-${index}`} className="grid gap-x-4 gap-y-1 border-t border-hairline px-4 py-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{facet.label}</p>
                  <p className="text-xs capitalize text-mute">{facet.facetType.replace(/_/g, " ")}</p>
                </div>
                <p className="line-clamp-3 text-sm leading-6 text-body">{cleanDisplayText(facet.evidence) || "No evidence sentence was stored."}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
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

/**
 * The window stays open while the reader steps from paper to paper; only what
 * is inside it starts afresh for each one. The heading keeps one id, which
 * names the dialog.
 */
export default function PaperAnalysisExplorerModal(props: Props) {
  const headingId = useId();
  // The paper's repository and its rows, read through the dashboard's own
  // cache, give each topic its theme and the theme its colour - the same
  // colour the dashboard draws it in.
  const { allFolders } = useWorkspaceProfile();
  const projectId = useMemo(
    () => runProjectId(props.run, new Map(allFolders.map((folder) => [folder.id, folder.project_id]))),
    [allFolders, props.run]
  );
  const trends = useRepositoryTrends(projectId, Boolean(props.detail?.available));
  const { theme: mode, hydrated } = useTheme();
  const dark = hydrated && mode === "dark";
  const themes = useMemo(() => {
    if (!trends || !props.detail?.paper_id) return null;
    return paperThemes(trends, props.detail.paper_id, themeColorMap(trends), dark);
  }, [dark, props.detail?.paper_id, trends]);
  return (
    <Modal onClose={props.onClose}>
      <PaperExplorerPanel key={props.run.id} {...props} themes={props.themes ?? themes} headingId={headingId} />
    </Modal>
  );
}

/** What the window shows for one paper; exported for the render tests, which draw it without the dialog. */
export function PaperExplorerPanel({
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
  stepper,
  themes,
  headingId,
}: Props & { headingId?: string }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const stepping = Boolean(stepper && stepper.total > 1);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const stepperRef = useRef(stepper);
  stepperRef.current = stepper;
  // A step keeps focus on the button it was made with, now on the next paper.
  const firstFocus = useRef(stepper?.focus ?? null);
  useEffect(() => {
    const wanted = firstFocus.current;
    if (!wanted) return;
    // At either end of the list that button is off, so the other one takes focus.
    const [first, other] = wanted === "previous" ? [previousRef.current, nextRef.current] : [nextRef.current, previousRef.current];
    (first && !first.disabled ? first : other)?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const current = stepperRef.current;
      if (!current || event.defaultPrevented) return;
      // Keys pressed in a dialog opened over this one (Rename) are its own.
      const target = event.target as Node | null;
      if (target && target !== document.body && !panelRef.current?.contains(target)) return;
      const step = stepFromKey(event);
      const move = step === -1 ? current.onPrevious : step === 1 ? current.onNext : null;
      if (!move) return;
      event.preventDefault();
      move();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
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
  const trackBadges = useMemo(() => buildTrackBadges(detail), [detail]);
  const facetGroups = useMemo(() => summarizeFacetGroups(detail), [detail]);
  const keywordEvidenceRows = useMemo(
    () => buildKeywordEvidenceRows(detail),
    [detail]
  );
  // Every keyword's evidence, marked on the PDF together (Evidence tab).
  const evidenceMarks = useMemo<PdfMark[]>(
    () =>
      keywordEvidenceRows.map((row) => ({
        id: `${row.index}`,
        label: row.keyword,
        detail: row.section === "Section not resolved" || row.section === "Full text" ? undefined : row.section,
        candidates: [row.evidence, row.context].filter((text) => text.trim().length > 0),
      })),
    [keywordEvidenceRows]
  );
  const topicGroups = useMemo(() => buildTopicGroups(detail, keywordEvidenceRows, themes), [detail, keywordEvidenceRows, themes]);
  // A keyword's "Show in PDF" opens the Evidence tab on its passage.
  const [focusMark, setFocusMark] = useState<{ id: string; key: string } | null>(null);
  const showInPdf = (row: KeywordEvidenceRow) => {
    setFocusMark({ id: String(row.index), key: `${row.index}:${Date.now()}` });
    setActiveTab("evidence");
  };
  // Whether the PDF is a scan: from the analysis's record, or from its pages once the viewer has read them.
  const [viewerTextKind, setViewerTextKind] = useState<PdfTextKind | null>(null);
  const textKind = effectiveTextKind(detail?.extracted?.textSource?.kind, viewerTextKind);
  const textChip = textKindChip(textKind);
  // A scan's evidence is shown in the text the analysis read from it, not on
  // its pictures of pages (2026-10-24 review); the PDF stays on Preview.
  const scanText = textKind === "scanned" && evidenceMarks.length > 0 ? String(detail?.raw_text ?? "").trim() : "";

  // A different paper opens on the tab it was asked for (a link's ?tab=, or
  // Overview). Resetting to Overview here, on mount too, threw away the tab of
  // every deep link.
  const initialTabRef = useRef(initialTab);
  initialTabRef.current = initialTab;
  useEffect(() => {
    setActiveTab(initialTabRef.current ?? "overview");
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
    <>
      <div ref={panelRef} className="flex max-h-[92vh] w-[min(1180px,94vw)] flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-overlay">
        <div className="flex-none border-b border-hairline px-5 pb-4 pt-5 sm:px-7 sm:pt-6">
          {/* With Previous and Next beside it, a phone's title had a third of the
              width; there the controls take their own row above it. */}
          <div
            className={
              stepping
                ? "flex flex-col-reverse gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                : "flex items-start justify-between gap-4"
            }
          >
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
                <h2 id={headingId} className="text-xl font-semibold leading-snug tracking-tight text-ink sm:text-2xl">
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
                {/* A scan has no text to mark evidence on; saying so here
                    explains the Evidence tab before it is opened (2026-10-24). */}
                {textChip ? (
                  <span
                    data-text-kind=""
                    title={textChip === "Scanned PDF" ? "Its pages are pictures of text, read with OCR, so evidence can't be highlighted on them." : "Some pages are pictures of text, read with OCR, so evidence on them can't be highlighted."}
                    className="rounded-full bg-subtle px-2.5 py-1 text-xs font-medium text-body ring-1 ring-inset ring-hairline"
                  >
                    {textChip}
                  </span>
                ) : null}
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

            <div className={`flex flex-none items-center gap-1 ${stepping ? "-mr-2 -mt-2 self-end sm:mr-0 sm:mt-0 sm:self-auto" : ""}`}>
              {stepper && stepping ? (
                <div role="group" aria-label="Papers in this list" className="flex items-center" title="Previous and next paper (← →)">
                  <button
                    ref={previousRef}
                    type="button"
                    onClick={() => stepper.onPrevious?.()}
                    disabled={!stepper.onPrevious}
                    aria-label="Previous paper"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-mute transition-colors duration-150 hover:bg-subtle hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </button>
                  <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-mute" aria-live="polite">
                    {stepper.position} of {stepper.total}
                  </span>
                  <button
                    ref={nextRef}
                    type="button"
                    onClick={() => stepper.onNext?.()}
                    disabled={!stepper.onNext}
                    aria-label="Next paper"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-mute transition-colors duration-150 hover:bg-subtle hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg text-mute transition-colors duration-150 hover:bg-subtle hover:text-ink"
                aria-label="Close paper explorer"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          {stepper?.notice ? (
            <p role="status" className="mt-3 text-xs text-red-700 dark:text-red-300">
              {stepper.notice}
            </p>
          ) : null}

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
                              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#030303] dark:text-[#d0d0d0]"
                            >
                              {themes ? <ThemeDot color={themes.get(topicKey(topic))?.color ?? OTHER_THEME_COLOR} /> : null}
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
                                <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-[#8e8e8e]">
                                  {themes ? <ThemeDot color={themes.get(topicKey(keyword.topic || ""))?.color ?? OTHER_THEME_COLOR} /> : null}
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

                  {/* The topic cards that sat here were the Topics tab's first
                      six, repeated; the tab has them all (2026-10-24 review). */}
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

              {activeTab === "evidence" ? (
                // The PDF alone, every passage the analysis stored marked on
                // it, and a pager that steps from one to the next across
                // pages (2026-10-22). The list beside it is gone.
                <section aria-label={scanText ? "Evidence in the paper's text" : "Evidence in the PDF"}>
                  {scanText ? (
                    <EvidenceText text={scanText} marks={evidenceMarks} focusMark={focusMark} heightClass="h-[62vh] lg:h-[68vh]" />
                  ) : previewError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                      {previewError}
                    </div>
                  ) : (
                    <PdfViewer
                      cacheKey={run.id}
                      url={previewUrl}
                      title={`Evidence in ${detail?.title || titleOf(run)}`}
                      marks={evidenceMarks}
                      focusMark={focusMark}
                      source={detail.extracted?.textSource ?? null}
                      onTextKind={setViewerTextKind}
                      heightClass="h-[62vh] lg:h-[68vh]"
                    />
                  )}
                </section>
              ) : null}

              {activeTab === "topics" ? (
                <TopicsTab groups={topicGroups} facets={detail.facets} themesKnown={Boolean(themes && themes.size > 0)} onShowInPdf={previewError && !scanText ? undefined : showInPdf} showLabel={scanText ? "Show in text" : "Show in PDF"} />
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
                      source={detail?.extracted?.textSource ?? null}
                      onTextKind={setViewerTextKind}
                    />
                  ) : null}
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
