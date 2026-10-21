/*
 * The papers a reader opened last, for Home's "Continue where you left off"
 * (2026-10-21). Kept in this browser, per account: it is a convenience, and a
 * missing or cleared list only hides that row.
 */
export interface RecentPaper {
  runId: string;
  title: string;
  /** The repository the paper is in, so Home shows only its own. */
  projectId: string | null;
  openedAt: string;
}

const STORAGE_PREFIX = "papertrend_recent_papers_v1:";
export const MAX_RECENT_PAPERS = 12;

/** The list with one more paper opened: newest first, each paper once. */
export function withOpenedPaper(list: readonly RecentPaper[], opened: RecentPaper): RecentPaper[] {
  return [opened, ...list.filter((item) => item.runId !== opened.runId)].slice(0, MAX_RECENT_PAPERS);
}

export function parseRecentPapers(raw: string | null): RecentPaper[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is RecentPaper =>
        Boolean(item) &&
        typeof (item as RecentPaper).runId === "string" &&
        typeof (item as RecentPaper).title === "string" &&
        typeof (item as RecentPaper).openedAt === "string"
      )
      .map((item) => ({ runId: item.runId, title: item.title.slice(0, 300), projectId: typeof item.projectId === "string" ? item.projectId : null, openedAt: item.openedAt }))
      .slice(0, MAX_RECENT_PAPERS);
  } catch {
    return [];
  }
}

export function readRecentPapers(userId: string | null | undefined): RecentPaper[] {
  if (!userId || typeof window === "undefined") return [];
  try {
    return parseRecentPapers(window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`));
  } catch {
    return [];
  }
}

export function rememberOpenedPaper(userId: string | null | undefined, opened: Omit<RecentPaper, "openedAt">): void {
  if (!userId || typeof window === "undefined" || !opened.runId) return;
  try {
    const next = withOpenedPaper(readRecentPapers(userId), { ...opened, openedAt: new Date().toISOString() });
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(next));
  } catch {
    // Storage off: Home just has nothing to continue.
  }
}

/** The repository a run belongs to: its folder's, or the one it was added to. */
export function runProjectId(
  run: { folder_id?: string | null; input_payload?: Record<string, unknown> | null },
  folderProject: ReadonlyMap<string, string | null | undefined>
): string | null {
  const payloadProjectId = typeof run.input_payload?.project_id === "string" ? run.input_payload.project_id : null;
  return (run.folder_id ? folderProject.get(run.folder_id) : null) ?? payloadProjectId;
}
