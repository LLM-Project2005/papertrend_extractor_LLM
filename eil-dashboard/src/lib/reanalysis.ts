/**
 * Model tokens (prompt and completion) to analyse one paper again: the median
 * of the analyses recorded since the pipeline update of 2026-09-26 (30,093 over
 * 9 papers; long or scanned papers reached about 66,000, since every scanned
 * page goes through OCR). Shown in tokens rather than dollars, the unit of the
 * daily allowance (2026-10-09 review); analysis does not count against it.
 */
export const REANALYSIS_TOKENS_PER_PAPER = 30_000;

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")} million`;
  return Math.round(tokens).toLocaleString("en-US");
}

export function formatReanalysisEstimate(paperCount: number): string {
  const tokens = paperCount * REANALYSIS_TOKENS_PER_PAPER;
  return `${paperCount} paper${paperCount === 1 ? "" : "s"}, about ${formatTokens(tokens)} tokens of model use`;
}

const YEAR_PATTERN = /^(19|20)\d{2}$/;

/** A corrected title/year, or the reason it cannot be saved. */
export function validatePaperCorrection(input: { title?: unknown; year?: unknown }):
  | { ok: true; title?: string; year?: string }
  | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim() : undefined;
  const year = typeof input.year === "string" ? input.year.trim() : undefined;
  if (title === undefined && year === undefined) {
    return { ok: false, error: "Give a corrected title or year." };
  }
  if (title !== undefined && (title.length < 3 || title.length > 500)) {
    return { ok: false, error: "A title needs 3 to 500 characters." };
  }
  if (year !== undefined && year !== "Unknown" && !YEAR_PATTERN.test(year)) {
    return { ok: false, error: "A year needs four digits, such as 2021, or Unknown." };
  }
  return { ok: true, ...(title !== undefined ? { title } : {}), ...(year !== undefined ? { year } : {}) };
}
