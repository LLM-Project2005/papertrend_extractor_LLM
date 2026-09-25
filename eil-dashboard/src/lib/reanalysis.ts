/**
 * Model cost of analysing one paper again, measured on the pipeline
 * evaluation set (scripts/evaluate_pipeline_quality.py). A scanned paper
 * costs more because every page goes through OCR.
 */
export const REANALYSIS_COST_PER_PAPER_USD = 0.02;

export function formatReanalysisEstimate(paperCount: number): string {
  const cost = paperCount * REANALYSIS_COST_PER_PAPER_USD;
  const shown = cost < 0.01 ? "less than $0.01" : `about $${cost.toFixed(2)}`;
  return `${paperCount} paper${paperCount === 1 ? "" : "s"}, ${shown} of model use`;
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
