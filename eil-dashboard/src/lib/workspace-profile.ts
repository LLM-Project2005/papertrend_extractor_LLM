import type {
  WorkspaceGoal,
  WorkspaceOutput,
  WorkspaceProfile,
  WorkspaceSource,
} from "@/types/workspace";

export const WORKSPACE_PROFILE_STORAGE_KEY = "papertrend_workspace_profile_v1";

export const DEFAULT_WORKSPACE_PROFILE: WorkspaceProfile = {
  name: "Research Signal Lab",
  organization: "Faculty or department team",
  domain: "Applied linguistics and education",
  goal: "trend-mapping",
  primarySource: "pdf-upload",
  desiredOutputs: ["dashboard", "chat", "paper-library"],
  analysisHistoryHiddenByProject: {},
  onboardingComplete: false,
  updatedAt: null,
};

export const WORKSPACE_GOALS: Array<{
  id: WorkspaceGoal;
  label: string;
  description: string;
}> = [
  {
    id: "trend-mapping",
    label: "Trend mapping",
    description: "Surface themes, track shifts, and publication patterns over time.",
  },
  {
    id: "corpus-chat",
    label: "Corpus chat",
    description: "Ask flexible questions across a research collection and cite papers back.",
  },
  {
    id: "curriculum-design",
    label: "Curriculum design",
    description: "Turn a corpus into teaching directions, reading lists, and learning paths.",
  },
  {
    id: "literature-review",
    label: "Literature review",
    description: "Organize evidence quickly for reviews, grant proposals, and scoping work.",
  },
];

export const WORKSPACE_SOURCES: Array<{
  id: WorkspaceSource;
  label: string;
  description: string;
  status: "ready" | "planned";
}> = [
  {
    id: "pdf-upload",
    label: "PDF upload",
    description: "Upload paper PDFs directly into the workspace import queue.",
    status: "ready",
  },
  {
    id: "csv-import",
    label: "CSV or notebook outputs",
    description: "Sync structured outputs from your notebook pipeline into Supabase.",
    status: "ready",
  },
  {
    id: "onedrive",
    label: "OneDrive",
    description: "Planned connector for faculty-managed document libraries.",
    status: "planned",
  },
  {
    id: "sharepoint",
    label: "SharePoint",
    description: "Planned connector for institutional document repositories.",
    status: "planned",
  },
  {
    id: "cloud-storage",
    label: "Cloud storage",
    description: "Planned connector for buckets and shared research archives.",
    status: "planned",
  },
];

export const WORKSPACE_OUTPUTS: Array<{
  id: WorkspaceOutput;
  label: string;
  description: string;
}> = [
  {
    id: "dashboard",
    label: "Dashboard analytics",
    description: "Monitor trends, topic clusters, and track-level patterns.",
  },
  {
    id: "chat",
    label: "Corpus assistant",
    description: "Ask grounded questions and move quickly between synthesis and evidence.",
  },
  {
    id: "paper-library",
    label: "Paper library",
    description: "Browse titles, keywords, tracks, and detailed per-paper evidence.",
  },
  {
    id: "track-classification",
    label: "Track classification",
    description: "Keep single-label and multi-label categorization visible in the workspace.",
  },
  {
    id: "curriculum-paths",
    label: "Curriculum paths",
    description: "Prepare the workspace for future teaching and pathway recommendations.",
  },
];

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
      desiredOutputs:
        parsed.desiredOutputs && parsed.desiredOutputs.length > 0
          ? parsed.desiredOutputs
          : DEFAULT_WORKSPACE_PROFILE.desiredOutputs,
    };
  } catch {
    return DEFAULT_WORKSPACE_PROFILE;
  }
}

export function saveWorkspaceProfile(profile: WorkspaceProfile): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    WORKSPACE_PROFILE_STORAGE_KEY,
    JSON.stringify(profile)
  );
}
