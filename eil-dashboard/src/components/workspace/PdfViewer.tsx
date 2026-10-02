"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { locateEvidence, type EvidenceLocation, type PageRuns } from "@/lib/pdf-evidence-match";
import { MinusIcon, PlusIcon } from "@/components/ui/Icons";

/*
 * The paper itself, drawn with pdf.js, with the evidence marked on the page.
 *
 * Pages are drawn only as they come near the viewport, so a 40-page thesis
 * shows its first page as soon as that page has arrived. The evidence and
 * preview tabs share one loaded document per paper, so switching between
 * them does not download the file again.
 *
 * The evidence is found in the PDF's own text (see pdf-evidence-match) and
 * marked with a box over each line it covers, then scrolled into view. When
 * the text is not in the PDF (a scan without a text layer, or evidence that
 * came from a translation) the viewer says so and shows the pages unmarked.
 *
 * If pdf.js cannot load the file at all, the browser's own viewer takes over,
 * so a preview is never lost to this component.
 */

const WORKER_SRC = "/pdfjs/pdf.worker.min.mjs";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    // pdf.js 4 uses Promise.withResolvers, which Safari added only in 17.4.
    const promiseStatics = Promise as unknown as { withResolvers?: () => unknown };
    if (typeof promiseStatics.withResolvers !== "function") {
      promiseStatics.withResolvers = () => {
        let resolve: (value: unknown) => void = () => undefined;
        let reject: (reason?: unknown) => void = () => undefined;
        const promise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return { promise, resolve, reject };
      };
    }
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

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

function PdfPage({
  doc,
  pageNumber,
  scale,
  estimatedSize,
  highlightRuns,
  onHighlightPlaced,
  scrollRoot,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  estimatedSize: { width: number; height: number };
  highlightRuns: { runs: number[]; trim: { start: number; end: number } } | null;
  onHighlightPlaced: (pageTop: number, rect: Rect) => void;
  scrollRoot: HTMLElement | null;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(pageNumber === 1);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [rects, setRects] = useState<Rect[]>([]);
  // Compared by content: the parent builds a new object on every render, and
  // re-running on identity would pull the page back to the mark on each scroll.
  const highlightSignature = highlightRuns
    ? `${highlightRuns.runs.join(",")}|${highlightRuns.trim.start}|${highlightRuns.trim.end}`
    : "";

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

  // A highlighted page is drawn at once, wherever it is.
  useEffect(() => {
    if (highlightSignature) setNear(true);
  }, [highlightSignature]);

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
    if (!page || !highlightRuns?.runs.length) {
      setRects([]);
      return;
    }
    let cancelled = false;
    void page.getTextContent().then((content) => {
      if (cancelled) return;
      const items = textItems(content);
      const viewport = page.getViewport({ scale });
      const { runs, trim } = highlightRuns;
      const lastIndex = runs[runs.length - 1];
      const next = runs
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
          };
        });
      setRects(next);
      if (next[0] && wrapperRef.current) onHighlightPlaced(wrapperRef.current.offsetTop, next[0]);
    });
    return () => {
      cancelled = true;
    };
    // onHighlightPlaced and highlightRuns are recreated each render; the
    // signature is what changes when the highlight does.
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
          key={index}
          aria-hidden="true"
          className="pdf-evidence-mark pointer-events-none absolute rounded-[3px]"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      ))}
    </div>
  );
}

export default function PdfViewer({
  cacheKey,
  url,
  title,
  highlight,
  highlightKey,
  heightClass = "h-[70vh]",
  toolbarExtra,
}: {
  cacheKey: string;
  url: string | null;
  title: string;
  /**
   * Text to find and mark: a stored evidence sentence, or several candidates
   * tried in order (the sentence, then the wider passage around it).
   */
  highlight?: string | string[] | null;
  /** Changes when the same text should be found and scrolled to again. */
  highlightKey?: string;
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
  const [location, setLocation] = useState<EvidenceLocation | null | "searching">(null);
  const pageTextRef = useRef<Map<number, string[]>>(new Map());

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setFailed(false);
    setDoc(null);
    setProgress(0);
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

  // Find the evidence in the document's text, reading each page's text once.
  const candidates = useMemo(
    () => (Array.isArray(highlight) ? highlight : highlight ? [highlight] : []).filter((text) => text.trim().length > 0),
    // The candidates are compared by content, not identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Array.isArray(highlight) ? highlight.join("\u0000") : highlight]
  );

  useEffect(() => {
    if (!doc || candidates.length === 0) {
      setLocation(null);
      return;
    }
    let cancelled = false;
    setLocation("searching");
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
      let found: EvidenceLocation | null = null;
      for (const candidate of candidates) {
        found = locateEvidence(pages, candidate);
        if (found) break;
      }
      setLocation(found);
    })().catch(() => {
      if (!cancelled) setLocation(null);
    });
    return () => {
      cancelled = true;
    };
  }, [candidates, doc, highlightKey]);

  const fitScale = baseSize && containerWidth ? Math.max(0.3, (containerWidth - 32) / baseSize.width) : 1;
  const scale = fitScale * zoom;
  const pageNumbers = useMemo(() => Array.from({ length: doc?.numPages ?? 0 }, (_, index) => index + 1), [doc]);

  function scrollToHighlight(pageTop: number, rect: { top: number }) {
    const element = scrollRef.current;
    if (!element) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ top: Math.max(0, pageTop + rect.top - element.clientHeight / 3), behavior: reduce ? "auto" : "smooth" });
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

  const status =
    candidates.length === 0
      ? null
      : location === "searching"
        ? "Finding the passage in the PDF…"
        : location
          ? `Marked on page ${location.page + 1}${location.quality === "partial" ? ", where the closest lines match" : ""}.`
          : doc
            ? "This passage is not in the PDF's text, so it is not marked. The PDF may be a scan, or the passage came from its translation."
            : null;

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-hairline bg-subtle">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface px-3 py-2">
        {/* Not a live region: it changes on every scroll, and was read out each time. */}
        <p className="text-xs tabular-nums text-mute">
          {doc ? `Page ${currentPage} of ${doc.numPages}` : "Loading the PDF…"}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.15).toFixed(2))))}
            aria-label="Zoom out"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-body transition-colors hover:bg-subtle hover:text-ink"
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
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-body transition-colors hover:bg-subtle hover:text-ink"
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
          {toolbarExtra}
        </div>
      </div>
      {status ? (
        <p role="status" className="border-b border-hairline bg-surface px-3 py-2 text-xs leading-5 text-body">
          {status}
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
                highlightRuns={
                  location && location !== "searching" && location.page === number - 1
                    ? { runs: location.runs, trim: location.trim }
                    : null
                }
                onHighlightPlaced={scrollToHighlight}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
