"use client";

// React in scope: the test runner compiles JSX the classic way.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { locateMarks, type LocatedMark, type PdfMark } from "@/components/workspace/PdfViewer";
import type { PageRuns } from "@/lib/pdf-evidence-match";
import { ChevronLeftIcon, ChevronRightIcon, InfoIcon } from "@/components/ui/Icons";

/*
 * The Evidence tab for a scanned PDF (2026-10-24 review: "for a scanned PDF,
 * show the text, as the evidence tab used to"). A scan's pages are pictures of
 * text, so nothing can be highlighted on them; the text the analysis read
 * from them with OCR can be, and that text is what the evidence was taken
 * from. Every passage is marked in it, one in focus, and the same pager as on
 * the PDF steps from one to the next. The PDF itself stays on the Preview tab.
 */

export interface TextLine {
  text: string;
  heading: boolean;
}

export interface TextPage {
  /** The PDF page the text came from, when the OCR step marked it ("[Page 12]"). */
  number: number | null;
  lines: TextLine[];
}

/**
 * The OCR text in pages and lines: split at its "[Page N]" markers, without
 * the "---" between pages, and with Markdown's heading and bold marks taken
 * off so the text reads as the paper does. Pure, so it is tested.
 */
export function textPages(raw: string): TextPage[] {
  const text = String(raw ?? "").replace(/\r\n?/g, "\n");
  const parts = text.split(/^\[Page (\d+)\][ \t]*$/m);
  const pages: TextPage[] = [];
  const add = (number: number | null, body: string) => {
    const lines = body
      .split("\n")
      .map((line) => line.trim())
      // The OCR step writes tables in Markdown: a rule line ("|:---|") is dropped,
      // and a row's cells are read across ("| Received | 2022 |" -> "Received · 2022").
      .filter((line) => line && !/^-{3,}$/.test(line) && !(/-{3,}/.test(line) && /^[|:\-\s]+$/.test(line)))
      .map((line) =>
        /^\|.*\|$/.test(line)
          ? line
              .slice(1, -1)
              .split("|")
              .map((cell) => cell.trim())
              .filter(Boolean)
              .join(" · ")
          : line
      )
      .filter(Boolean)
      .map((line) => {
        const heading = /^#{1,6}\s/.test(line);
        // Bold and italic marks off; a lone "*" (a footnote's) stays.
        const plain = line.replace(/^#{1,6}\s+/, "").replace(/\*\*|__/g, "").replace(/\*(\S(?:[^*\n]*\S)?)\*/g, "$1");
        return { text: plain.trim(), heading };
      })
      .filter((line) => line.text);
    if (lines.length > 0) pages.push({ number, lines });
  };
  add(null, parts[0] ?? "");
  for (let index = 1; index < parts.length; index += 2) add(Number(parts[index]), parts[index + 1] ?? "");
  return pages;
}

/** One line cut into pieces: plain, a passage, or the passage in focus. Pure, so it is tested. */
export function lineSegments(text: string, ranges: Array<{ start: number; end: number; active: boolean }>): Array<{ text: string; mark: "none" | "soft" | "active" }> {
  const level = new Array<number>(text.length).fill(0);
  for (const range of ranges) {
    for (let index = Math.max(0, range.start); index < Math.min(text.length, range.end); index += 1) level[index] = Math.max(level[index], range.active ? 2 : 1);
  }
  const segments: Array<{ text: string; mark: "none" | "soft" | "active" }> = [];
  let start = 0;
  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || level[index] !== level[start]) {
      segments.push({ text: text.slice(start, index), mark: level[start] === 2 ? "active" : level[start] === 1 ? "soft" : "none" });
      start = index;
    }
  }
  return segments;
}

/** Where a located passage covers a line, in characters. */
function rangeOn(mark: LocatedMark, run: number, length: number): { start: number; end: number } {
  const first = mark.runs[0];
  const last = mark.runs[mark.runs.length - 1];
  return {
    start: run === first ? Math.round(mark.trim.start * length) : 0,
    end: run === last ? Math.round(mark.trim.end * length) : length,
  };
}

const navButtonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-body transition-colors hover:bg-subtle hover:text-ink disabled:pointer-events-none disabled:opacity-40";

export default function EvidenceText({
  text,
  marks,
  focusMark,
  heightClass = "h-[62vh]",
}: {
  text: string;
  marks: PdfMark[];
  /** The mark to bring into focus (a keyword's "Show in PDF"); `key` changes to ask again. */
  focusMark?: { id: string; key: string } | null;
  heightClass?: string;
}) {
  const pages = useMemo(() => textPages(text), [text]);
  const found = useMemo(() => locateMarks(pages.map<PageRuns>((page) => ({ runs: page.lines.map((line) => line.text) })), marks), [marks, pages]);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const located = found.located;
  const missing = found.missing;
  const active = located[Math.min(activeIndex, Math.max(0, located.length - 1))] ?? null;

  useEffect(() => {
    if (!focusMark) return;
    const index = located.findIndex((mark) => mark.ids.includes(focusMark.id));
    if (index >= 0) setActiveIndex(index);
    // The key stands for a repeated request for the same mark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMark?.id, focusMark?.key, located]);

  // The passage in focus is brought to a third of the way down the pane.
  useEffect(() => {
    const pane = scrollRef.current;
    const mark = pane?.querySelector<HTMLElement>('[data-evidence-mark="active"]');
    if (!pane || !mark) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const offset = mark.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    pane.scrollTo({ top: Math.max(0, pane.scrollTop + offset - pane.clientHeight / 3), behavior: reduce ? "auto" : "smooth" });
  }, [active]);

  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const pageOf = (mark: LocatedMark) => pages[mark.page]?.number;
  const evidencePages = new Set(located.map((mark) => mark.page)).size;

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-hairline bg-subtle" data-evidence-text="">
      <div data-evidence-pager="" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline bg-surface px-3 py-2">
        {located.length > 0 && active ? (
          <>
            <div className="flex items-center gap-1" role="group" aria-label="Evidence in this paper">
              <button
                type="button"
                onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
                disabled={activeIndex <= 0}
                aria-label="Previous evidence"
                className={navButtonClass}
              >
                <ChevronLeftIcon className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[6.5rem] text-center text-xs font-medium tabular-nums text-ink">
                Evidence {Math.min(activeIndex, located.length - 1) + 1} of {located.length}
              </span>
              <button
                type="button"
                onClick={() => setActiveIndex((index) => Math.min(located.length - 1, index + 1))}
                disabled={activeIndex >= located.length - 1}
                aria-label="Next evidence"
                className={navButtonClass}
              >
                <ChevronRightIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="min-w-0 flex-1 truncate text-xs text-body" title={active.labels.join(", ")}>
              <span className="font-medium text-ink">{active.labels.join(", ")}</span>
              <span className="text-mute">
                {pageOf(active) ? ` · page ${pageOf(active)}` : ""}
                {active.details.length > 0 ? ` · ${active.details.join(", ")}` : ""}
              </span>
            </p>
            <p className="text-xs text-mute">
              {plural(located.length, "passage")}
              {pages.some((page) => page.number !== null) ? ` on ${plural(evidencePages, "page")}` : ""}
            </p>
          </>
        ) : (
          <p className="text-xs leading-5 text-body">
            {marks.length === 0 ? "No evidence was stored for this paper." : "None of this paper's evidence matches its text, so nothing is marked. The passages are listed below."}
          </p>
        )}
        <div className="flex basis-full items-start gap-2 rounded-md bg-subtle px-2.5 py-2 text-xs leading-5 text-body">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 flex-none text-mute" />
          <p>
            <span className="font-semibold text-ink">This PDF is a scanned image,</span> so its evidence is shown in the text Papertrend read from it with OCR. The Preview tab shows the PDF itself.
          </p>
        </div>
        {missing.length > 0 ? (
          <details className="group basis-full text-xs text-mute" open={located.length === 0}>
            <summary className="cursor-pointer list-none hover:text-ink">
              {plural(missing.length, "passage")} not found in the text
              <span className="ml-1 group-open:hidden">· show</span>
            </summary>
            <ul aria-label="Passages not marked in the text" className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
              {missing.map((mark) => (
                <li key={mark.id} className="leading-5">
                  <span className="font-medium text-body">{mark.label}</span>
                  {mark.candidates[0] ? <span>: “{mark.candidates[0]}”</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <div ref={scrollRef} className={`relative ${heightClass} overflow-auto overscroll-contain bg-surface px-5 py-5 sm:px-8`}>
        <div className="mx-auto max-w-3xl space-y-8">
          {pages.map((page, pageIndex) => {
            const onPage = located.filter((mark) => mark.page === pageIndex);
            return (
              <section key={pageIndex} aria-label={page.number ? `Page ${page.number}` : "Text"}>
                {page.number ? <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-mute">Page {page.number}</p> : null}
                <div className="space-y-2.5">
                  {page.lines.map((line, lineIndex) => {
                    const ranges = onPage
                      .filter((mark) => mark.runs.includes(lineIndex))
                      .map((mark) => ({ ...rangeOn(mark, lineIndex, line.text.length), active: mark === active }));
                    const Tag = line.heading ? "h3" : "p";
                    return (
                      <Tag key={lineIndex} className={line.heading ? "pt-1 text-sm font-semibold text-ink" : "text-sm leading-7 text-body"}>
                        {ranges.length === 0
                          ? line.text
                          : lineSegments(line.text, ranges).map((segment, segmentIndex) =>
                              segment.mark === "none" ? (
                                <React.Fragment key={segmentIndex}>{segment.text}</React.Fragment>
                              ) : (
                                <span
                                  key={segmentIndex}
                                  data-evidence-mark={segment.mark === "active" ? "active" : "other"}
                                  className={segment.mark === "active" ? "text-evidence-mark text-ink" : "text-evidence-mark-soft"}
                                >
                                  {segment.text}
                                </span>
                              )
                            )}
                      </Tag>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
