/*
 * How many papers each repository holds, for the repository list
 * (/workspaces), by the Library's rule: "papers" counts what was analysed, a
 * failed upload is not a paper in the repository, and Trash is left out. A
 * canceled analysis is neither a paper nor in progress.
 */
export interface RepositoryPaperStats {
  papers: number;
  inProgress: number;
  failed: number;
  latest: string | null;
}

type RunLike = {
  status?: string | null;
  folder_id?: string | null;
  trashed_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  input_payload?: Record<string, unknown> | null;
};

function timeToMs(value: string | null | undefined): number {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : 0;
}

export function repositoryPaperStats(
  projects: ReadonlyArray<{ id: string; updated_at?: string | null; created_at?: string | null }>,
  runs: ReadonlyArray<RunLike>,
  folderProject: ReadonlyMap<string, string | null | undefined>
): Map<string, RepositoryPaperStats> {
  const stats = new Map<string, RepositoryPaperStats>();
  for (const project of projects) {
    stats.set(project.id, { papers: 0, inProgress: 0, failed: 0, latest: project.updated_at ?? project.created_at ?? null });
  }
  for (const run of runs) {
    if (run.trashed_at) continue;
    const payloadProjectId = typeof run.input_payload?.project_id === "string" ? run.input_payload.project_id : null;
    // A paper filed in a folder belongs to the folder's repository.
    const projectId = run.folder_id ? folderProject.get(run.folder_id) ?? payloadProjectId : payloadProjectId;
    const current = projectId ? stats.get(projectId) : null;
    if (!current) continue;
    if (run.status === "succeeded") current.papers += 1;
    else if (run.status === "failed") current.failed += 1;
    else if (run.status !== "canceled") current.inProgress += 1;
    const updated = run.updated_at ?? run.created_at ?? null;
    if (timeToMs(updated) > timeToMs(current.latest)) current.latest = updated;
  }
  return stats;
}
