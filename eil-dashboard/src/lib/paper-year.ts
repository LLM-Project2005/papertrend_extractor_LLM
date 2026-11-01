/*
 * A paper's year as the product shows it (2026-10-31, UI audit #12). The
 * analysis stores "Unknown" when a paper states no year, and screens used to
 * print that word, "Year not recorded", or nothing; there is now one wording.
 */

export const NO_YEAR = "Year not stated";

/** The four-digit year, or null when the paper states none. */
export function paperYear(year: string | number | null | undefined): string | null {
  const value = String(year ?? "").trim();
  return /^\d{4}$/.test(value) ? value : null;
}

/** The year to print: the year itself, or "Year not stated". */
export function yearLabel(year: string | number | null | undefined): string {
  return paperYear(year) ?? NO_YEAR;
}
