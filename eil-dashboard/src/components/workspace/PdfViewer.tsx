"use client";

// React in scope: the test runner compiles JSX the classic way.
import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { locateEvidence, type EvidenceLocation, type PageRuns } from "@/lib/pdf-evidence-match";
import {
  effectiveTextKind,
  pageCharacterCount,
  pageListText,
  pageTextKind,
  type PaperTextSource,
  type PdfTextKind,
} from "@/lib/pdf-text-kind";
import { ChevronLeftIcon, ChevronRightIcon, InfoIcon, MinusIcon, PlusIcon } from "@/components/ui/Icons";
import { loadPdfJs } from "@/lib/pdfjs-loader";

/*
 * The paper itself, drawn with pdf.js, with the evidence marked on the page.
 *
 * Pages are drawn only as they come near the viewport, so a 40-page thesis
 * shows its first page as soon as that page has arrived. The evidence and
 * preview tabs share one loaded document per paper, so switching between
 * them does not download the file again.
 *
 * Evidence is found in the PDF's own text (see pdf-evidence-match) and marked
 * with a box over each line it covers. The preview marks one passage (a chat
 * citation's). The Evidence tab marks every passage the analysis stored at
 * once, the one in focus stronger than the rest, and steps from passage to
 * passage across pages (2026-10-22: the PDF alone, the evidence on it, in
 * place of a list beside it). A passage the PDF's text does not contain (a
 * scan without a text layer, or evidence that came from a translation) is
 * said so rather than marked, and the passages are listed: the analysis's
 * record of how it read the PDF says which it is, and for older papers the
 * pages themselves do (pdf-text-kind.ts, 2026-10-24).
 *
 * If pdf.js cannot load the file at all, the browser's own viewer takes over,
 * so a preview is never lost to this component.
 */

/** A few documents stay loaded, so moving between recent papers is instant. */
const documentCache = new Map<string, Promise<PDFDocumentProxy>>();
const MAX_CACHED = 3;

function loadDocument(key: string, url: string, onProgress: (fraction: number) => void): Promise<PDFDocumentProxy> {
  const cached = documentCache.get(key);
  if (cached) {
    documentCache.delete(key);
    documentCache.set(key, cached);
    return cached;
  }
  const loading = loadPdfJs().then((pdfjs) => {
    const task = pdfjs.getDocument({ url, disableAutoFetch: true, isEvalSupported: false });
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      if (total > 0) onProgress(Math.min(1, loaded / total));
    };
    return task.promise;
  });
  loading.catch(() => documentCache.delete(key));
  documentCache.set(key, loading);
  while (documentCache.size > MAX_CACHED) {
    const oldestKey = documentCache.keys().next().value as string;
    const oldest = documentCache.get(oldestKey);
    documentCache.delete(oldestKey);
    void oldest?.then((doc) => doc.destroy()).catch(() => undefined);
  }
  return loading;
}

/** Warm the document before its tab is opened, on hover or focus of the tab. */
export function prefetchPdf(key: string, url: string) {
  void loadDocument(key, url, () => undefined).catch(() => undefined);
}

function textItems(content: { items: unknown[] }): TextItem[] {
  return content.items.filter((item): item is TextItem => typeof (item as TextItem).str === "string");
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A passage to mark: what it is evidence for, and the text to find, tried in order. */
export interface PdfMark {
  id: string;
  /** What the passage is evidence for (a keyword), named beside the pager. */
  label: string;
  /** Where the analysis placed it (a section), if known. */
  detail?: string;
  /** The stored sentence, then the wider passage around it. */
  candidates: string[];
}

/** A passage found in the PDF; marks found at the same place are one, with every label. */
export interface LocatedMark {
  key: string;
  /** The marks found here: two keywords with the same sentence are one stop. */
  ids: string[];
  labels: string[];
  details: string[];
  page: number;
  runs: number[];
  trim: { start: number; end: number };
  quality: EvidenceLocation["quality"];
}

/**
 * Where each mark is in the document, in reading order (page, then the line it
 * starts on), and which ones the PDF's text does not contain. Two keywords
 * whose evidence is the same sentence are one stop. Pure, so it is tested.
 */
export function locateMarks(pages: PageRuns[], marks: PdfMark[]): { located: LocatedMark[]; missing: PdfMark[] } {
  const byKey = new Map<string, LocatedMark>();
  const missing: PdfMark[] = [];
  for (const mark of marks) {
    let found: EvidenceLocation | null = null;
    for (const candidate of mark.candidates) {
      if (!candidate.trim()) continue;
      found = locateEvidence(pages, candidate);
      if (found) break;
    }
    if (!found) {
      missing.push(mark);
      continue;
    }
    const key = `${found.page}|${found.runs.join(",")}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.ids.push(mark.id);
      if (!existing.labels.includes(mark.label)) existing.labels.push(mark.label);
      if (mark.detail && !existing.details.includes(mark.detail)) existing.details.push(mark.detail);
      continue;
    }
    byKey.set(key, {
      key,
      ids: [mark.id],
      labels: [mark.label],
      details: mark.detail ? [mark.detail] : [],
      page: found.page,
      runs: found.runs,
      trim: found.trim,
      quality: found.quality,
    });
  }
  const located = [...byKey.values()].sort((left, right) => left.page - right.page || (left.runs[0] ?? 0) - (right.runs[0] ?? 0));
  return { located, missing };
}

/**
 * Why some or all of a paper's passages are not marked, when the PDF or the
 * analysis's record says: a scan, a paper analysed in translation, or a PDF
 * with scanned pages. Null when nothing is missing, or when the PDF has text
 * and a passage simply was not found in it. Pure, so it is tested.
 */
export function unmarkedNotice(input: {
  kind: PdfTextKind | null;
  translated: boolean;
  /** Pages (from 0) with no text, as the viewer read them. */
  imagePages: number[];
  located: number;
  missing: number;
}): { title: string; body: string } | null {
  if (input.missing === 0) return null;
  const count = `${input.missing} passage${input.missing === 1 ? "" : "s"}`;
  const listed = input.located > 0 ? "The passages it could not mark are listed below." : `The ${count} it found ${input.missing === 1 ? "is" : "are"} listed below.`;
  if (input.kind === "scanned") {
    return {
      title: "This PDF is a scanned image.",
      body: `Its pages are pictures of text, so the evidence can't be highlighted on them. Papertrend read the pages with OCR. ${listed}`,
    };
  }
  if (input.translated) {
    return {
      title: "This paper was analysed in an English translation.",
      body: `Its evidence is in English, so it can't be matched to the PDF's own text. ${listed}`,
    };
  }
  if (input.kind === "partly_scanned") {
    const where = input.imagePages.length > 0 ? pageListText(input.imagePages) : "";
    const one = input.imagePages.length === 1;
    const pages = where ? `${where[0].toUpperCase()}${where.slice(1)} ${one ? "is a scanned image" : "are scanned images"}` : "Some of its pages are scanned images";
    return {
      title: "Part of this PDF is scanned.",
      body: `${pages}, so passages on ${one ? "it" : "them"} can't be highlighted. Papertrend read those pages with OCR. ${listed}`,
    };
  }
  return null;
}

interface PageHighlight {
  key: string;
  runs: number[];
  trim: { start: number; end: number };
  active: boolean;
}

function PdfPage({
  doc,
  pageNumber,
  scale,
  estimatedSize,
  highlights,
  onHighlightPlaced,
  scrollRoot,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  estimatedSize: { width: number; height: number };
  highlights: PageHighlight[];
  onHighlightPlaced: (pageTop: number, rect: Rect) => void;
  scrollRoot: HTMLElement | null;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(pageNumber === 1);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [rects, setRects] = useState<Array<Rect & { active: boolean }>>([]);
  // Compared by content: the parent builds new objects on every render, and
  // re-running on identity would pull the page back to the mark on each scroll.
  const highlightSignature = highlights
    .map((highlight) => `${highlight.key}${highlight.active ? "*" : ""}|${highlight.trim.start}|${highlight.trim.end}`)
    .join(";");
  const hasActive = highlights.some((highlight) => highlight.active);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { root: scrollRoot, rootMargin: "800px 0px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, scrollRoot]);

  // The page with the passage in focus is drawn at once, wherever it is; the
  // others are drawn, marks and all, as they come into view.
  useEffect(() => {
    if (hasActive) setNear(true);
  }, [hasActive]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    void doc.getPage(pageNumber).then((loaded) => {
      if (!cancelled) setPage(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, near, pageNumber]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!page || !canvas) return;
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    const task = page.render({
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    });
    task.promise.catch(() => undefined);
    return () => task.cancel();
  }, [page, scale]);

  // The page's text, laid invisibly over the drawing so it can be selected,
  // copied, found with the browser's search and read by a screen reader. The
  // page was a picture only (docs/32, 3.4; audit LIB-11).
  useEffect(() => {
    const container = textLayerRef.current;
    if (!page || !container) return;
    let cancelled = false;
    let layer: { cancel: () => void } | null = null;
    container.replaceChildren();
    void loadPdfJs()
      .then((pdfjs) => {
        if (cancelled) return;
        const textLayer = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container,
          viewport: page.getViewport({ scale }),
        });
        layer = textLayer;
        return textLayer.render();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      layer?.cancel();
    };
  }, [page, scale]);

  useEffect(() => {
    if (!page || highlights.length === 0) {
      setRects([]);
      return;
    }
    let cancelled = false;
    void page.getTextContent().then((content) => {
      if (cancelled) return;
      const items = textItems(content);
      const viewport = page.getViewport({ scale });
      const next = highlights.flatMap((highlight) => {
        const { runs, trim } = highlight;
        const lastIndex = runs[runs.length - 1];
        return runs
          .map((index) => ({ index, item: items[index] }))
          .filter((entry): entry is { index: number; item: TextItem } => Boolean(entry.item) && entry.item.str.trim().length > 0)
          .map(({ index, item }) => {
            // The first and last lines are cut to where the passage starts and ends.
            const from = index === runs[0] ? trim.start : 0;
            const to = index === lastIndex ? trim.end : 1;
            const [, , c, d, e, f] = item.transform as number[];
            const fontHeight = Math.hypot(c, d) || item.height || 10;
            const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
              e + item.width * from,
              f - fontHeight * 0.22,
              e + item.width * Math.max(from, to),
              f + fontHeight * 0.92,
            ]);
            return {
              left: Math.min(x1, x2) - 2,
              top: Math.min(y1, y2) - 1,
              width: Math.abs(x2 - x1) + 4,
              height: Math.abs(y2 - y1) + 2,
              active: highlight.active,
            };
          });
      });
      setRects(next);
      const focus = next.find((rect) => rect.active);
      if (focus && wrapperRef.current) onHighlightPlaced(wrapperRef.current.offsetTop, focus);
    });
    return () => {
      cancelled = true;
    };
    // onHighlightPlaced and highlights are recreated each render; the
    // signature is what changes when the marks do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightSignature, page, scale]);

  const viewport = page?.getViewport({ scale });
  const width = viewport?.width ?? estimatedSize.width * scale;
  const height = viewport?.height ?? estimatedSize.height * scale;

  return (
    <div
      ref={wrapperRef}
      data-page={pageNumber}
      className="relative mx-auto bg-white shadow-raise"
      style={{ width, height, ["--scale-factor" as string]: scale }}
    >
      {page ? <canvas ref={canvasRef} className="block" aria-hidden="true" /> : <div className="skeleton h-full w-full" />}
      {page ? <div ref={textLayerRef} className="textLayer" /> : null}
      {rects.map((rect, index) => (
        <span
          key={`${index}-${rect.active ? "a" : "s"}`}
          aria-hidden="true"
          data-evidence-mark={rect.active ? "active" : "other"}
          className={`${rect.active ? "pdf-evidence-mark" : "pdf-evidence-mark-soft"} pointer-events-none absolute rounded-[3px]`}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      ))}
    </div>
  );
}

const navButtonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-body transition-colors hover:bg-subtle hover:text-ink disabled:pointer-events-none disabled:opacity-40";

export default function PdfViewer({
  cacheKey,
  url,
  title,
  highlight,
  highlightKey,
  marks,
  focusMark,
  source,
  onTextKind,
  heightClass = "h-[70vh]",
  toolbarExtra,
}: {
  cacheKey: string;
  url: string | null;
  title: string;
  /**
   * One passage to find and mark (the preview's): a stored sentence, or
   * several candidates tried in order (the sentence, then the wider passage).
   */
  highlight?: string | string[] | null;
  /** Changes when the same text should be found and scrolled to again. */
  highlightKey?: string;
  /**
   * Every passage to mark at once (the Evidence tab): all are marked, one is
   * in focus, and the toolbar steps from one to the next across pages.
   */
  marks?: PdfMark[] | null;
  /** The mark to bring into focus (a keyword's "Show in PDF"); `key` changes to ask again. */
  focusMark?: { id: string; key: string } | null;
  /** What the analysis recorded about the PDF's text, for saying why nothing is marked. */
  source?: PaperTextSource | null;
  /** Told what the pages say once they are read: a scan, partly one, or text. */
  onTextKind?: (kind: PdfTextKind | null) => void;
  heightClass?: string;
  toolbarExtra?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [found, setFound] = useState<{ located: LocatedMark[]; missing: PdfMark[] } | "searching" | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pagesKind, setPagesKind] = useState<{ kind: PdfTextKind | null; imagePages: number[] } | null>(null);
  const pageTextRef = useRef<Map<number, string[]>>(new Map());
  const onTextKindRef = useRef(onTextKind);
  onTextKindRef.current = onTextKind;
  const evidenceMode = Array.isArray(marks);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setFailed(false);
    setDoc(null);
    setProgress(0);
    setPagesKind(null);
    pageTextRef.current = new Map();
    loadDocument(cacheKey, url, (fraction) => {
      if (!cancelled) setProgress(fraction);
    })
      .then(async (loaded) => {
        if (cancelled) return;
        const first = await loaded.getPage(1);
        const viewport = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setBaseSize({ width: viewport.width, height: viewport.height });
        setDoc(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, url]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setContainerWidth(element.clientWidth));
    observer.observe(element);
    setContainerWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [doc]);

  // What to find: the Evidence tab's passages, or the preview's one. Compared
  // by content, not identity: the parent builds them on every render.
  const wantedSignature = evidenceMode
    ? `marks:${(marks ?? []).map((mark) => `${mark.id}\u0001${mark.label}\u0001${mark.detail ?? ""}\u0001${mark.candidates.join("\u0000")}`).join("\u0002")}`
    : `one:${Array.isArray(highlight) ? highlight.join("\u0000") : highlight ?? ""}`;
  const wanted = useMemo<PdfMark[]>(() => {
    if (evidenceMode) return marks ?? [];
    const candidates = (Array.isArray(highlight) ? highlight : highlight ? [highlight] : []).filter((text) => text.trim().length > 0);
    return candidates.length > 0 ? [{ id: "highlight", label: "", candidates }] : [];
    // wantedSignature stands for marks and highlight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedSignature]);

  // Find the passages in the document's text, reading each page's text once.
  useEffect(() => {
    if (!doc || wanted.length === 0) {
      setFound(null);
      return;
    }
    let cancelled = false;
    setFound("searching");
    void (async () => {
      const pages: PageRuns[] = [];
      for (let number = 1; number <= doc.numPages; number += 1) {
        let runs = pageTextRef.current.get(number);
        if (!runs) {
          const content = await (await doc.getPage(number)).getTextContent();
          runs = textItems(content).map((item) => item.str);
          pageTextRef.current.set(number, runs);
        }
        if (cancelled) return;
        pages.push({ runs });
      }
      if (cancelled) return;
      const kind = pageTextKind(pages.map((page) => pageCharacterCount(page.runs)));
      setPagesKind(kind);
      onTextKindRef.current?.(kind.kind);
      setFound(locateMarks(pages, wanted));
      setActiveIndex(0);
    })().catch(() => {
      if (!cancelled) setFound(null);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, doc, highlightKey]);

  const located = found && found !== "searching" ? found.located : [];
  const missing = found && found !== "searching" ? found.missing : [];
  const active = located[Math.min(activeIndex, Math.max(0, located.length - 1))] ?? null;

  // "Show in PDF" from a keyword: its passage comes into focus once found.
  useEffect(() => {
    if (!focusMark || !found || found === "searching") return;
    const index = found.located.findIndex((mark) => mark.ids.includes(focusMark.id));
    if (index >= 0) setActiveIndex(index);
    // The key stands for a repeated request for the same mark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMark?.id, focusMark?.key, found]);

  const fitScale = baseSize && containerWidth ? Math.max(0.3, (containerWidth - 32) / baseSize.width) : 1;
  const scale = fitScale * zoom;
  const pageNumbers = useMemo(() => Array.from({ length: doc?.numPages ?? 0 }, (_, index) => index + 1), [doc]);

  function scrollToHighlight(pageTop: number, rect: { top: number }) {
    const element = scrollRef.current;
    if (!element) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ top: Math.max(0, pageTop + rect.top - element.clientHeight / 3), behavior: reduce ? "auto" : "smooth" });
  }

  function scrollToPage(number: number) {
    const element = scrollRef.current;
    const target = element?.querySelector<HTMLElement>(`[data-page="${number}"]`);
    if (!element || !target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ top: Math.max(0, target.offsetTop - 12), behavior: reduce ? "auto" : "smooth" });
    setCurrentPage(number);
  }

  function onScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const probe = element.scrollTop + element.clientHeight / 3;
    const pages = element.querySelectorAll<HTMLElement>("[data-page]");
    let visible = 1;
    pages.forEach((pageElement) => {
      if (pageElement.offsetTop <= probe) visible = Number(pageElement.dataset.page);
    });
    setCurrentPage(visible);
  }

  if (failed && url) {
    return (
      <iframe
        src={`${url.split("#", 1)[0]}#zoom=page-width`}
        title={title}
        className={`${heightClass} w-full rounded-lg border border-hairline bg-white`}
      />
    );
  }

  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const evidencePages = new Set(located.map((mark) => mark.page)).size;
  const textKind = effectiveTextKind(source?.kind, pagesKind?.kind);
  const imagePages = pagesKind?.imagePages ?? [];

  // Why passages are not marked, when the PDF or the analysis says (2026-10-24).
  const unmarked =
    found && found !== "searching"
      ? unmarkedNotice({ kind: textKind, translated: Boolean(source?.translated), imagePages, located: located.length, missing: missing.length })
      : null;

  // The preview's one passage says where it is, or why it is not marked.
  const previewStatus =
    evidenceMode || wanted.length === 0
      ? null
      : found === "searching"
        ? "Finding the passage in the PDF…"
        : active
          ? `Marked on page ${active.page + 1}${active.quality === "partial" ? ", where the closest lines match" : ""}.`
          : doc
            ? textKind === "scanned"
              ? "This PDF is a scanned image, so the passage can't be highlighted on it."
              : source?.translated
                ? "This passage came from the paper's English translation, so it can't be matched to the PDF."
                : "This passage is not in the PDF's text, so it is not marked. The PDF may be partly scanned, or the passage came from its translation."
            : null;

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-hairline bg-subtle">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface px-3 py-2">
        <div className="flex items-center gap-1">
          {doc ? (
            <button type="button" onClick={() => scrollToPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} aria-label="Previous page" className={navButtonClass}>
              <ChevronLeftIcon className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {/* Not a live region: it changes on every scroll, and was read out each time. */}
          <p className="text-xs tabular-nums text-mute">
            {doc ? `Page ${currentPage} of ${doc.numPages}` : "Loading the PDF…"}
          </p>
          {doc ? (
            <button type="button" onClick={() => scrollToPage(Math.min(doc.numPages, currentPage + 1))} disabled={currentPage >= doc.numPages} aria-label="Next page" className={navButtonClass}>
              <ChevronRightIcon className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.15).toFixed(2))))}
            aria-label="Zoom out"
            className={navButtonClass}
          >
            <MinusIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="h-7 rounded-md px-2 text-xs font-medium tabular-nums text-body transition-colors hover:bg-subtle hover:text-ink"
            aria-label="Fit to width"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(3, Number((value + 0.15).toFixed(2))))}
            aria-label="Zoom in"
            className={navButtonClass}
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
          {toolbarExtra}
        </div>
      </div>

      {evidenceMode && doc ? (
        <div data-evidence-pager="" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline bg-surface px-3 py-2">
          {found === "searching" ? (
            <p className="text-xs text-body">Finding the evidence in the PDF…</p>
          ) : located.length > 0 && active ? (
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
                  {" "}
                  · page {active.page + 1}
                  {active.details.length > 0 ? ` · ${active.details.join(", ")}` : ""}
                  {active.quality === "partial" ? " · closest lines" : ""}
                </span>
              </p>
              <p className="text-xs text-mute">
                {plural(located.length, "passage")} on {plural(evidencePages, "page")}
              </p>
            </>
          ) : unmarked ? null : (
            <p className="text-xs leading-5 text-body">
              {wanted.length === 0
                ? "No evidence was stored for this paper."
                : "None of this paper's evidence matches the PDF's text, so nothing is marked. The passages are listed below."}
            </p>
          )}
          {unmarked ? (
            <div data-unmarked-reason={textKind ?? (source?.translated ? "translated" : "")} className="flex basis-full items-start gap-2 rounded-md bg-subtle px-2.5 py-2 text-xs leading-5 text-body">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 flex-none text-mute" />
              <p>
                <span className="font-semibold text-ink">{unmarked.title}</span> {unmarked.body}
              </p>
            </div>
          ) : null}
          {/* Still readable when they cannot be marked: a scan has no text to mark. */}
          {missing.length > 0 && (unmarked || located.length === 0) ? (
            <ul aria-label="Passages not marked on the PDF" className="max-h-56 basis-full space-y-1.5 overflow-y-auto text-xs text-mute">
              {missing.map((mark) => (
                <li key={mark.id} className="leading-5">
                  <span className="font-medium text-body">{mark.label}</span>
                  {mark.candidates[0] ? <span>: “{mark.candidates[0]}”</span> : null}
                </li>
              ))}
            </ul>
          ) : missing.length > 0 ? (
            <details className="group basis-full text-xs text-mute">
              <summary className="cursor-pointer list-none hover:text-ink">
                {`${plural(missing.length, "passage")} not found in the PDF's text`}
                <span className="ml-1 group-open:hidden">· show</span>
              </summary>
              <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
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
      ) : null}

      {previewStatus ? (
        <p role="status" className="border-b border-hairline bg-surface px-3 py-2 text-xs leading-5 text-body">
          {previewStatus}
        </p>
      ) : null}
      <div
        ref={(element) => {
          scrollRef.current = element;
          setScrollRoot(element);
        }}
        onScroll={onScroll}
        className={`relative ${heightClass} overflow-auto overscroll-contain px-4 py-4`}
      >
        {!doc || !baseSize ? (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 text-center">
            <div className="h-1 w-48 overflow-hidden rounded-full bg-hairline">
              <div
                className="h-full rounded-full bg-ink transition-[width] duration-200"
                style={{ width: `${Math.max(8, Math.round(progress * 100))}%` }}
              />
            </div>
            <p className="text-xs text-mute">Loading the PDF…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {pageNumbers.map((number) => (
              <PdfPage
                key={number}
                doc={doc}
                pageNumber={number}
                scale={scale}
                estimatedSize={baseSize}
                scrollRoot={scrollRoot}
                highlights={located
                  .filter((mark) => mark.page === number - 1)
                  .map((mark) => ({ key: mark.key, runs: mark.runs, trim: mark.trim, active: mark === active }))}
                onHighlightPlaced={scrollToHighlight}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
