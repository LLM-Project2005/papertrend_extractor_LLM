export type KnowledgeScopeKind =
  | "all_projects"
  | "project"
  | "folder"
  | "selected_papers";

export interface KnowledgeScope {
  kind: KnowledgeScopeKind;
  projectId?: string;
  folderId?: string;
  runIds?: string[];
}

export interface KnowledgeScopeSnapshot {
  kind: KnowledgeScopeKind;
  label: string;
  projectId: string | null;
  projectName: string | null;
  folderId: string | null;
  folderName: string | null;
  selectedRunCount: number;
  eligiblePaperCount: number;
}

interface LegacyKnowledgeScopeInput {
  knowledgeScope?: KnowledgeScope | null;
  projectId?: string | null;
  folderId?: string | null;
  selectedRunIds?: string[] | null;
}

function uniqueIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))];
}

export function normalizeKnowledgeScope(input: LegacyKnowledgeScopeInput): KnowledgeScope {
  const requested = input.knowledgeScope;
  const runIds = uniqueIds(requested?.runIds ?? input.selectedRunIds);
  const projectId = String(requested?.projectId ?? input.projectId ?? "").trim() || undefined;
  const folderId = String(requested?.folderId ?? input.folderId ?? "").trim() || undefined;

  if (runIds.length > 0) {
    return { kind: "selected_papers", projectId, folderId, runIds };
  }
  if (folderId && folderId !== "all" && folderId !== "all-projects") {
    return { kind: "folder", projectId, folderId };
  }
  // A project-aware workspace must never widen "entire repository" into every
  // project owned by the user. Cross-project scope is reserved for callers
  // that intentionally omit a project ID.
  if (projectId && projectId !== "all") {
    return { kind: "project", projectId };
  }
  return { kind: "all_projects" };
}

export function knowledgeScopeLabel(scope: KnowledgeScope): string {
  if (scope.kind === "selected_papers") {
    const count = scope.runIds?.length ?? 0;
    return `${count} selected paper${count === 1 ? "" : "s"}`;
  }
  if (scope.kind === "folder") return "Selected folder";
  if (scope.kind === "project") return "Current project";
  return "All projects";
}

export function projectIdFromScopeMetadata(
  metadata?: Record<string, unknown> | null
): string | null {
  if (!metadata) return null;
  const knowledgeScope = metadata.knowledgeScope && typeof metadata.knowledgeScope === "object"
    ? metadata.knowledgeScope as Record<string, unknown>
    : {};
  const scopeSnapshot = metadata.scopeSnapshot && typeof metadata.scopeSnapshot === "object"
    ? metadata.scopeSnapshot as Record<string, unknown>
    : {};
  const projectId = String(knowledgeScope.projectId ?? scopeSnapshot.projectId ?? "").trim();
  return projectId || null;
}
