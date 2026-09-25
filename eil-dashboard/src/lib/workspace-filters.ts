import { TRACK_COLS } from "@/lib/constants";

/**
 * Dashboard filters, remembered per repository.
 *
 * They used to be one set for the whole workspace, so years chosen in one
 * repository were applied to the next one opened - often years it did not
 * have, which emptied its charts with no filter visibly set.
 */
export const WORKSPACE_FILTERS_BY_PROJECT_KEY = "papertrend_workspace_filters_v2";

const MAX_REMEMBERED_PROJECTS = 50;
const NO_PROJECT_KEY = "none";

export type WorkspaceFilters = {
  selectedYears: string[];
  selectedTracks: string[];
  searchQuery: string;
};

export type WorkspaceFiltersByProject = Record<string, WorkspaceFilters>;

export function defaultWorkspaceFilters(): WorkspaceFilters {
  return { selectedYears: [], selectedTracks: [...TRACK_COLS], searchQuery: "" };
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function projectKey(projectId: string | null | undefined): string {
  return projectId || NO_PROJECT_KEY;
}

export function parseFiltersByProject(raw: string | null | undefined): WorkspaceFiltersByProject {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const store: WorkspaceFiltersByProject = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      const tracks = strings(entry.selectedTracks);
      store[key] = {
        selectedYears: strings(entry.selectedYears),
        selectedTracks: tracks.length > 0 ? tracks : [...TRACK_COLS],
        searchQuery: typeof entry.searchQuery === "string" ? entry.searchQuery : "",
      };
    }
    return store;
  } catch {
    return {};
  }
}

export function filtersForProject(
  store: WorkspaceFiltersByProject,
  projectId: string | null | undefined
): WorkspaceFilters {
  const saved = store[projectKey(projectId)];
  return saved
    ? { ...saved, selectedYears: [...saved.selectedYears], selectedTracks: [...saved.selectedTracks] }
    : defaultWorkspaceFilters();
}

/** The store with this repository's filters saved, most recent last, oldest dropped. */
export function withProjectFilters(
  store: WorkspaceFiltersByProject,
  projectId: string | null | undefined,
  filters: WorkspaceFilters
): WorkspaceFiltersByProject {
  const key = projectKey(projectId);
  const entries = Object.entries(store).filter(([existing]) => existing !== key);
  entries.push([key, filters]);
  return Object.fromEntries(entries.slice(-MAX_REMEMBERED_PROJECTS));
}
