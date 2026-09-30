/**
 * When the progress tray stops asking (docs/32, 2.6).
 *
 * It used to poll every three seconds for as long as a session existed -
 * finished, in a background tab, or both - and the shell and Home each ran
 * their own poller. Polling now stops once every followed run has finished, and
 * waits while the tab is hidden.
 */

export const FINISHED_RUN_STATUSES: ReadonlySet<string> = new Set(["succeeded", "failed", "canceled"]);

/**
 * True when nothing followed is still in progress, judged from a response:
 * each followed run is finished, or gone (deleted, so never coming back).
 */
export function trackedRunsSettled(
  runs: ReadonlyArray<{ id: string; status?: string | null }>,
  trackedIds: readonly string[]
): boolean {
  const byId = new Map(runs.map((run) => [run.id, run]));
  return trackedIds.every((id) => {
    const run = byId.get(id);
    return !run || FINISHED_RUN_STATUSES.has(String(run.status ?? ""));
  });
}

/** A followed batch is dropped from storage after a day: its papers are long finished or long stuck. */
export const ANALYSIS_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function analysisSessionExpired(startedAt: string | null | undefined, now = Date.now()): boolean {
  const started = Date.parse(String(startedAt ?? ""));
  return !Number.isFinite(started) || now - started > ANALYSIS_SESSION_MAX_AGE_MS;
}

/**
 * Followed papers of this repository still waiting or being analysed, for the
 * pages that say so (docs/32, 2.11, DASH-7). A run that does not name its
 * repository counts: the batch was started from this one.
 */
export function runsInProgress(
  runs: ReadonlyArray<{ status?: string | null; input_payload?: Record<string, unknown> | null }>,
  projectId: string | null | undefined
): number {
  return runs.filter((run) => {
    if (run.status !== "queued" && run.status !== "processing") return false;
    const runProject = run.input_payload?.project_id;
    return !projectId || typeof runProject !== "string" || !runProject || runProject === projectId;
  }).length;
}

/** The most runs one session follows; the status route accepts this many. */
export const MAX_FOLLOWED_RUNS = 200;

/** A new batch joins the one being followed rather than replacing it. */
export function mergeFollowedRunIds(current: readonly string[], added: readonly string[]): string[] {
  const merged = [...new Set([...current, ...added])];
  // Over the limit, the newest are kept.
  return merged.slice(Math.max(0, merged.length - MAX_FOLLOWED_RUNS));
}
