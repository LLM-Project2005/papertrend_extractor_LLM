/*
 * Finding an evidence sentence inside a PDF's own text.
 *
 * The analysis stores evidence as clean text, while a PDF gives its text as
 * short runs: a line, or part of one, with line-end hyphens, ligatures and
 * odd spacing. Matching therefore compares both sides after the same
 * normalisation, and falls back from the whole sentence to overlapping word
 * windows, because the stored sentence may be shortened, or break across a
 * column or a page in the PDF.
 *
 * The answer is the runs to highlight on one page, which the viewer turns
 * into rectangles. Nothing here depends on pdf.js, so it is tested directly.
 */

export interface PageRuns {
  /** The text of each run on the page, in reading order. */
  runs: string[];
}

export interface EvidenceLocation {
  /** Zero-based page index. */
  page: number;
  /** Indexes into that page's runs. */
  runs: number[];
  /** "exact" when the whole sentence was found, "partial" when only parts were. */
  quality: "exact" | "partial";
  /**
   * How far into the first run the passage starts, and how far into the last
   * run it ends, as fractions of each run's text, so a mark can stop where the
   * sentence does instead of covering the whole line.
   */
  trim: { start: number; end: number };
}

const LIGATURES: Record<string, string> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
};

/** Lowercase letters and digits separated by single spaces. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[\uFB00-\uFB04]/g, (ligature) => LIGATURES[ligature] ?? ligature)
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

interface PageIndex {
  text: string;
  /** For each run, where its text starts and ends in `text`. */
  spans: Array<{ start: number; end: number }>;
}

/**
 * One page as a single normalised string, remembering where each run sits.
 * A run ending in a hyphen joins the next without a space ("informa-" +
 * "tion"), as a reader would read it.
 */
export function indexPage(page: PageRuns): PageIndex {
  let text = "";
  const spans: PageIndex["spans"] = [];
  page.runs.forEach((raw, index) => {
    const hyphenated = /[A-Za-z]-\s*$/.test(raw) && index < page.runs.length - 1;
    const normalized = normalizeForMatch(hyphenated ? raw.replace(/-\s*$/, "") : raw);
    const start = text.length;
    text += normalized;
    spans.push({ start, end: text.length });
    if (normalized && !hyphenated) text += " ";
  });
  return { text, spans };
}

function runsCovering(index: PageIndex, start: number, end: number): number[] {
  const runs: number[] = [];
  index.spans.forEach((span, runIndex) => {
    if (span.end > start && span.start < end && span.end > span.start) runs.push(runIndex);
  });
  return runs;
}

function located(index: PageIndex, page: number, start: number, end: number, quality: EvidenceLocation["quality"]): EvidenceLocation {
  const runs = runsCovering(index, start, end);
  const first = index.spans[runs[0]];
  const last = index.spans[runs[runs.length - 1]];
  const fraction = (span: { start: number; end: number }, at: number) =>
    Math.min(1, Math.max(0, (at - span.start) / Math.max(1, span.end - span.start)));
  return {
    page,
    runs,
    quality,
    trim: { start: first ? fraction(first, start) : 0, end: last ? fraction(last, end) : 1 },
  };
}

/**
 * Where the evidence is, or null when the PDF's text does not contain it
 * (a scanned page with no text layer, or evidence taken from a translation).
 */
export function locateEvidence(pages: PageRuns[], evidence: string): EvidenceLocation | null {
  const target = normalizeForMatch(evidence);
  if (target.length < 12) return null;
  const indexes = pages.map(indexPage);

  // The whole sentence, as stored.
  for (let page = 0; page < indexes.length; page += 1) {
    const at = indexes[page].text.indexOf(target);
    if (at !== -1) {
      return located(indexes[page], page, at, at + target.length, "exact");
    }
  }

  // Otherwise the page where most overlapping word windows appear, from the
  // first window found to the last, so a sentence broken by a figure or a
  // shortened with "..." still lands on the right lines.
  const words = target.split(" ");
  if (words.length < 5) return null;
  for (const size of [10, 7, 5]) {
    if (words.length < size) continue;
    let best: { page: number; start: number; end: number; hits: number } | null = null;
    for (let page = 0; page < indexes.length; page += 1) {
      let hits = 0;
      let first = -1;
      let last = -1;
      for (let from = 0; from + size <= words.length; from += Math.max(1, Math.floor(size / 2))) {
        const window = words.slice(from, from + size).join(" ");
        const at = indexes[page].text.indexOf(window, first === -1 ? 0 : first);
        if (at === -1) continue;
        hits += 1;
        if (first === -1 || at < first) first = at;
        last = Math.max(last, at + window.length);
      }
      if (hits > 0 && (!best || hits > best.hits)) best = { page, start: first, end: last, hits };
    }
    if (best && best.end - best.start <= target.length * 1.8) {
      return located(indexes[best.page], best.page, best.start, best.end, "partial");
    }
  }
  return null;
}
