/*
 * Whether a paper's PDF has text that evidence can be marked on (2026-10-24
 * review: a way to tell a scanned image from a PDF whose text can be found,
 * so the Evidence tab can say why nothing is marked).
 *
 * Two sources, in this order:
 *
 *  - What the analysis recorded. The extractor stores how it read the PDF
 *    (analysis_quality.extraction_method): its own text layer, OCR on every
 *    page because there was no usable text, or OCR on the pages that had
 *    none. It also stores whether the paper was analysed in an English
 *    translation, whose evidence cannot be found in the original PDF.
 *  - The PDF itself, for papers analysed before that was recorded. The viewer
 *    reads every page's text to place the marks; a page with almost none is a
 *    picture of text.
 *
 * Pure, so it is tested.
 */

export type PdfTextKind = "text" | "scanned" | "partly_scanned";

export interface PaperTextSource {
  /** Null when the analysis did not record how it read the PDF. */
  kind: PdfTextKind | null;
  /** The evidence was taken from an English translation of the paper. */
  translated: boolean;
}

const RECORDED_KINDS: Record<string, PdfTextKind> = {
  fitz_text: "text",
  vision_fallback: "scanned",
  "fitz_text+vision_pages": "partly_scanned",
};

/** The translator's strategies that hand the analysis a translation (nodes/translator.py). */
const TRANSLATED_STRATEGIES = new Set(["chunked_translation", "section_translation", "translated"]);

/** What a run's stored analysis_quality says about its PDF. */
export function textSourceFromQuality(quality: unknown): PaperTextSource {
  const value = quality && typeof quality === "object" ? (quality as Record<string, unknown>) : {};
  const method = String(value.extraction_method ?? "").trim();
  const strategy = String(value.translation_strategy ?? "").trim();
  return { kind: RECORDED_KINDS[method] ?? null, translated: TRANSLATED_STRATEGIES.has(strategy) };
}

/** Fewer characters than this on a page, spaces aside, and the page is a picture. */
export const IMAGE_PAGE_CHARS = 20;

/** The characters on a page, not counting spaces, from its text runs. */
export function pageCharacterCount(runs: string[]): number {
  return runs.reduce((sum, run) => sum + run.replace(/\s+/g, "").length, 0);
}

/** What a PDF's own pages say: the kind, and which pages (from 0) have no text. */
export function pageTextKind(charactersPerPage: number[]): { kind: PdfTextKind | null; imagePages: number[] } {
  if (charactersPerPage.length === 0) return { kind: null, imagePages: [] };
  const imagePages = charactersPerPage.flatMap((count, index) => (count < IMAGE_PAGE_CHARS ? [index] : []));
  const kind = imagePages.length === 0 ? "text" : imagePages.length === charactersPerPage.length ? "scanned" : "partly_scanned";
  return { kind, imagePages };
}

/** The analysis's record when it has one, otherwise what the pages say. */
export function effectiveTextKind(recorded: PdfTextKind | null | undefined, fromPages: PdfTextKind | null | undefined): PdfTextKind | null {
  return recorded ?? fromPages ?? null;
}

/** "page 3", "pages 1 and 2", "pages 1, 4 and 9", or "12 pages" when there are many. Pages from 0. */
export function pageListText(pages: number[]): string {
  const numbers = pages.map((page) => page + 1);
  if (numbers.length === 0) return "";
  if (numbers.length === 1) return `page ${numbers[0]}`;
  if (numbers.length > 6) return `${numbers.length} pages`;
  return `pages ${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/** The header chip's words, or null for a PDF with a text layer. */
export function textKindChip(kind: PdfTextKind | null): string | null {
  if (kind === "scanned") return "Scanned PDF";
  if (kind === "partly_scanned") return "Partly scanned";
  return null;
}
