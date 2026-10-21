/*
 * The browser tab's title (2026-10-21). On a page about one repository it
 * names the repository ("Dashboard · testtest | Papertrend"), so several
 * open tabs can be told apart; while papers are analysed it leads with the
 * progress ("(3/5) Analyzing…"), and once they are done it says so until the
 * reader has seen it. Pages shared by every repository (Chat, Settings) keep
 * their plain name.
 */
import { FINISHED_RUN_STATUSES } from "@/lib/run-polling";

export const SITE_NAME = "Papertrend";
const SUFFIX = ` | ${SITE_NAME}`;

/** The page's own name in the title Next.js set: "Dashboard | Papertrend" is "Dashboard". */
export function pageNameOf(title: string): string {
  const trimmed = title.trim();
  if (trimmed === SITE_NAME) return "";
  return trimmed.endsWith(SUFFIX) ? trimmed.slice(0, -SUFFIX.length).trim() : trimmed;
}

/** The title with the analysis status first, then the page, then the repository. */
export function composeTabTitle(base: string, { status, repository }: { status?: string | null; repository?: string | null }): string {
  const parts = [status, pageNameOf(base), repository].map((part) => String(part ?? "").trim()).filter(Boolean);
  return parts.length > 0 ? `${parts.join(" · ")}${SUFFIX}` : SITE_NAME;
}

export interface RunCounts {
  total: number;
  finished: number;
  succeeded: number;
  failed: number;
}

export function countRuns(runs: ReadonlyArray<{ status?: string | null }>): RunCounts {
  let finished = 0;
  let succeeded = 0;
  let failed = 0;
  for (const run of runs) {
    const status = String(run.status ?? "");
    if (FINISHED_RUN_STATUSES.has(status)) finished += 1;
    if (status === "succeeded") succeeded += 1;
    if (status === "failed") failed += 1;
  }
  return { total: runs.length, finished, succeeded, failed };
}

export function analysisInProgress(counts: RunCounts): boolean {
  return counts.total > 0 && counts.finished < counts.total;
}

/** "(3/5) Analyzing…": papers finished of the papers followed. */
export function progressStatus(counts: RunCounts): string | null {
  return analysisInProgress(counts) ? `(${counts.finished}/${counts.total}) Analyzing…` : null;
}

function papers(count: number): string {
  return `${count} paper${count === 1 ? "" : "s"}`;
}

/** Once every followed paper has finished: "✓ 5 papers ready", or what failed. */
export function doneStatus(counts: RunCounts): string | null {
  if (counts.total === 0 || analysisInProgress(counts)) return null;
  if (counts.failed === 0) return counts.succeeded > 0 ? `✓ ${papers(counts.succeeded)} ready` : null;
  if (counts.succeeded === 0) return `${papers(counts.failed)} failed`;
  return `✓ ${counts.succeeded} ready, ${counts.failed} failed`;
}

/** The browser notification's words, when the reader asked for one. */
export function doneNotice(counts: RunCounts, repository?: string | null): { title: string; body: string } | null {
  if (counts.total === 0 || analysisInProgress(counts) || counts.succeeded + counts.failed === 0) return null;
  const where = repository ? ` in ${repository}` : "";
  const title = counts.failed === 0 ? `${counts.succeeded === 1 ? "Your paper is" : `${papers(counts.succeeded)} are`} ready` : `${counts.succeeded} of ${papers(counts.total)} analyzed`;
  const body =
    counts.failed === 0
      ? `${repository ? `In ${repository}. ` : ""}Click to go back to Papertrend.`
      : `${papers(counts.failed)} failed${where}. The Library says why.`;
  return { title, body };
}

/** The reader's choice to hear when a batch is done, kept in this browser. */
export const NOTIFY_STORAGE_KEY = "papertrend_notify_when_analyzed_v1";
