/**
 * Whether a year value is a point in time rather than a placeholder.
 *
 * A paper whose publication year could not be read is stored as "Unknown".
 * Sorted as a string it lands after "2026", and nothing separated it from a
 * real year. The publication volume chart drew it as the most recent period and
 * was titled "Publication Volume Trends from 2016 to Unknown"; worse, the
 * early/late split that decides which topics are emerging took the back half of
 * the year list as "late", so every undated paper counted as evidence of recent
 * growth.
 *
 * This lives in a module of its own because both the planner and the dashboard
 * component need it, and the planner reaches the database. Importing it from
 * there pulled `pg` into the browser bundle and broke the build - which is the
 * only reason that mistake was caught rather than shipped.
 */
export function isDatedYear(year: string): boolean {
  return /^\d{4}$/.test(String(year ?? "").trim());
}
