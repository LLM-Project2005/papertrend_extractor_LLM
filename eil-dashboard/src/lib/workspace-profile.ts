import type {
  WorkspaceAnalysisCategory,
  WorkspaceProfile,
} from "@/types/workspace";

export const WORKSPACE_PROFILE_STORAGE_KEY = "papertrend_workspace_profile_v1";

export const DEFAULT_WORKSPACE_PROFILE: WorkspaceProfile = {
  // Unused by the interface; repositories carry their own names. Kept empty so
  // a stale default can never be shown as though it were a real name.
  name: "",
  organization: "Faculty or department team",
  domain: "General academic research",
  domainDefinition: "",
  analysisContext: "",
  categoryTaxonomyName: "Project categories",
  categoryTaxonomyDefinition: "",
  analysisCategories: [],
  goal: "trend-mapping",
  primarySource: "pdf-upload",
  desiredOutputs: ["dashboard", "chat", "paper-library"],
  analysisHistoryHiddenByProject: {},
  projectCorpusTopicCacheByProject: {},
  onboardingComplete: false,
  updatedAt: null,
};

export function loadWorkspaceProfile(): WorkspaceProfile {
  if (typeof window === "undefined") {
    return DEFAULT_WORKSPACE_PROFILE;
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_PROFILE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_WORKSPACE_PROFILE;
    }

    const parsed = JSON.parse(raw) as Partial<WorkspaceProfile>;
    return {
      ...DEFAULT_WORKSPACE_PROFILE,
      ...parsed,
      analysisHistoryHiddenByProject:
        parsed.analysisHistoryHiddenByProject &&
        typeof parsed.analysisHistoryHiddenByProject === "object"
          ? parsed.analysisHistoryHiddenByProject
          : DEFAULT_WORKSPACE_PROFILE.analysisHistoryHiddenByProject,
      projectCorpusTopicCacheByProject:
        DEFAULT_WORKSPACE_PROFILE.projectCorpusTopicCacheByProject,
      desiredOutputs:
        parsed.desiredOutputs && parsed.desiredOutputs.length > 0
          ? parsed.desiredOutputs
          : DEFAULT_WORKSPACE_PROFILE.desiredOutputs,
      analysisCategories: normalizeWorkspaceAnalysisCategories(parsed.analysisCategories),
    };
  } catch {
    return DEFAULT_WORKSPACE_PROFILE;
  }
}

export function normalizeWorkspaceAnalysisCategories(
  categories: unknown,
  limit = Number.POSITIVE_INFINITY
): WorkspaceAnalysisCategory[] {
  if (!Array.isArray(categories)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: WorkspaceAnalysisCategory[] = [];
  for (const item of categories) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Partial<WorkspaceAnalysisCategory>;
    const label = String(row.label ?? "").trim().slice(0, 80);
    if (!label) {
      continue;
    }
    const key =
      String(row.key ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || `category_${normalized.length + 1}`;
    const uniqueKey = seen.has(key) ? `${key}_${normalized.length + 1}` : key;
    seen.add(uniqueKey);
    normalized.push({
      key: uniqueKey,
      label,
      description: String(row.description ?? "").trim().slice(0, 600),
    });
    if (normalized.length >= limit) {
      break;
    }
  }
  return normalized;
}

export function createWorkspaceAnalysisCategoryDraft(index: number): WorkspaceAnalysisCategory {
  const categoryNumber = Math.max(1, index + 1);
  return {
    key: `category_${categoryNumber}`,
    label: "",
    description: "",
  };
}

export function normalizeWorkspaceAnalysisCategoryDrafts(
  categories: WorkspaceAnalysisCategory[],
  limit = Number.POSITIVE_INFINITY
): WorkspaceAnalysisCategory[] {
  return categories.slice(0, limit).map((category, index) => ({
    key:
      String(category.key || category.label || `category_${index + 1}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || `category_${index + 1}`,
    label: String(category.label ?? "").slice(0, 80),
    description: String(category.description ?? "").slice(0, 600),
  }));
}

export function saveWorkspaceProfile(profile: WorkspaceProfile): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    WORKSPACE_PROFILE_STORAGE_KEY,
    JSON.stringify({
      ...profile,
      projectCorpusTopicCacheByProject: {},
    })
  );
}
