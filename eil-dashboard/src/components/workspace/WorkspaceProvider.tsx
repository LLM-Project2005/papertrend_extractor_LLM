"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { TRACK_COLS } from "@/lib/constants";
import {
  DEFAULT_WORKSPACE_PROFILE,
  loadWorkspaceProfile,
  saveWorkspaceProfile as saveWorkspaceProfileLocal,
} from "@/lib/workspace-profile";
import type {
  FolderAnalysisJobRow,
  IngestionRunRow,
  ResearchFolderRow,
  WorkspaceOrganizationRow,
  WorkspaceProjectRow,
} from "@/types/database";
import type { WorkspaceProfile } from "@/types/workspace";

const ANALYSIS_SESSION_STORAGE_KEY = "papertrend_analysis_session_v1";
const WORKSPACE_FOLDER_STORAGE_KEY = "papertrend_workspace_folder_v2";
const WORKSPACE_FILTERS_STORAGE_KEY = "papertrend_workspace_filters_v1";
const WORKSPACE_ORGANIZATION_STORAGE_KEY = "papertrend_workspace_org_v1";
const WORKSPACE_PROJECT_STORAGE_KEY = "papertrend_workspace_project_v1";

interface AnalysisSession {
  runIds: string[];
  folderJobId?: string | null;
  folderId?: string | null;
  sourceKind: string;
  folder: string;
  minimized: boolean;
  startedAt: string;
}

interface WorkspaceContextValue {
  profile: WorkspaceProfile;
  hydrated: boolean;
  analysisSession: AnalysisSession | null;
  organizations: WorkspaceOrganizationRow[];
  projects: WorkspaceProjectRow[];
  allProjects: WorkspaceProjectRow[];
  folders: ResearchFolderRow[];
  allFolders: ResearchFolderRow[];
  currentOrganization: WorkspaceOrganizationRow | null;
  currentProject: WorkspaceProjectRow | null;
  selectedOrganizationId: string | null;
  selectedProjectId: string | null;
  selectedFolderId: string;
  selectedYears: string[];
  selectedTracks: string[];
  searchQuery: string;
  hasActiveProject: boolean;
  updateProfile: (updates: Partial<WorkspaceProfile>) => void;
  resetProfile: () => void;
  startAnalysisSession: (
    runs: IngestionRunRow[],
    options?: {
      sourceKind?: string;
      folder?: string;
      folderId?: string | null;
      folderJob?: FolderAnalysisJobRow | null;
    }
  ) => void;
  setAnalysisMinimized: (minimized: boolean) => void;
  removeAnalysisRunIds: (runIds: string[]) => void;
  clearAnalysisSession: () => void;
  setSelectedOrganizationId: (organizationId: string | null) => void;
  setSelectedProjectId: (projectId: string | null) => void;
  setSelectedFolderId: (folderId: string) => void;
  setSelectedYears: (years: string[]) => void;
  setSelectedTracks: (tracks: string[]) => void;
  setSearchQuery: (searchQuery: string) => void;
  resetWorkspaceFilters: () => void;
  refreshOrganizations: () => Promise<void>;
  refreshProjects: (organizationId?: string | null) => Promise<void>;
  refreshFolders: () => Promise<void>;
  createOrganization: (
    name: string,
    type: WorkspaceOrganizationRow["type"]
  ) => Promise<WorkspaceOrganizationRow>;
  createProject: (
    name: string,
    options?: { organizationId?: string | null; description?: string | null }
  ) => Promise<WorkspaceProjectRow>;
  createFolder: (folderName: string) => Promise<ResearchFolderRow>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined
);

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const {
    hydrated: authHydrated,
    session,
    user,
    profile: authProfile,
    saveWorkspaceProfile: saveWorkspaceProfileRemote,
  } = useAuth();
  const [profile, setProfile] = useState(DEFAULT_WORKSPACE_PROFILE);
  const [hydrated, setHydrated] = useState(false);
  const [analysisSession, setAnalysisSession] = useState<AnalysisSession | null>(null);
  const [organizations, setOrganizations] = useState<WorkspaceOrganizationRow[]>([]);
  const [projects, setProjects] = useState<WorkspaceProjectRow[]>([]);
  const [allProjects, setAllProjects] = useState<WorkspaceProjectRow[]>([]);
  const [folders, setFolders] = useState<ResearchFolderRow[]>([]);
  const [allFolders, setAllFolders] = useState<ResearchFolderRow[]>([]);
  const [selectedOrganizationIdState, setSelectedOrganizationIdState] =
    useState<string | null>(null);
  const [selectedProjectIdState, setSelectedProjectIdState] =
    useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderIdState] = useState("all");
  const [selectedYears, setSelectedYearsState] = useState<string[]>([]);
  const [selectedTracks, setSelectedTracksState] = useState<string[]>([...TRACK_COLS]);
  const [searchQuery, setSearchQueryState] = useState("");
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!authHydrated) {
      return;
    }

    if (user) {
      const remoteProfile = authProfile?.workspace_profile
        ? {
            ...DEFAULT_WORKSPACE_PROFILE,
            ...authProfile.workspace_profile,
            desiredOutputs:
              authProfile.workspace_profile.desiredOutputs &&
              authProfile.workspace_profile.desiredOutputs.length > 0
                ? authProfile.workspace_profile.desiredOutputs
                : DEFAULT_WORKSPACE_PROFILE.desiredOutputs,
          }
        : loadWorkspaceProfile();

      const nextKey = `${user.id}:${authProfile?.updated_at ?? "local"}`;
      if (loadedKeyRef.current !== nextKey) {
        loadedKeyRef.current = nextKey;
        setProfile(remoteProfile);
      }

      setHydrated(true);
      return;
    }

    loadedKeyRef.current = "anonymous";
    setProfile(loadWorkspaceProfile());
    setOrganizations([]);
    setProjects([]);
    setAllProjects([]);
    setFolders([]);
    setAllFolders([]);
    setSelectedOrganizationIdState(null);
    setSelectedProjectIdState(null);
    setSelectedFolderIdState("all");
    setHydrated(true);
  }, [authHydrated, authProfile, user]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    saveWorkspaceProfileLocal(profile);
  }, [hydrated, profile]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedFolderId =
      window.localStorage.getItem(WORKSPACE_FOLDER_STORAGE_KEY) ?? "all";
    const savedOrganizationId =
      window.localStorage.getItem(WORKSPACE_ORGANIZATION_STORAGE_KEY) ?? null;
    const savedProjectId =
      window.localStorage.getItem(WORKSPACE_PROJECT_STORAGE_KEY) ?? null;

    setSelectedFolderIdState(savedFolderId);
    setSelectedOrganizationIdState(savedOrganizationId);
    setSelectedProjectIdState(savedProjectId);

    try {
      const rawFilters = window.localStorage.getItem(WORKSPACE_FILTERS_STORAGE_KEY);
      if (rawFilters) {
        const parsed = JSON.parse(rawFilters) as {
          selectedYears?: string[];
          selectedTracks?: string[];
          searchQuery?: string;
        };
        if (Array.isArray(parsed.selectedYears)) {
          setSelectedYearsState(parsed.selectedYears.filter(Boolean));
        }
        if (Array.isArray(parsed.selectedTracks) && parsed.selectedTracks.length > 0) {
          setSelectedTracksState(parsed.selectedTracks.filter(Boolean));
        }
        if (typeof parsed.searchQuery === "string") {
          setSearchQueryState(parsed.searchQuery);
        }
      }
    } catch {
      // Ignore invalid cached filter state.
    }

    try {
      const raw = window.localStorage.getItem(ANALYSIS_SESSION_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as AnalysisSession;
      if (Array.isArray(parsed.runIds) && parsed.runIds.length > 0) {
        setAnalysisSession(parsed);
      }
    } catch {
      // Ignore invalid cached analysis state.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (selectedOrganizationIdState) {
      window.localStorage.setItem(
        WORKSPACE_ORGANIZATION_STORAGE_KEY,
        selectedOrganizationIdState
      );
    } else {
      window.localStorage.removeItem(WORKSPACE_ORGANIZATION_STORAGE_KEY);
    }
  }, [selectedOrganizationIdState]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (selectedProjectIdState) {
      window.localStorage.setItem(
        WORKSPACE_PROJECT_STORAGE_KEY,
        selectedProjectIdState
      );
    } else {
      window.localStorage.removeItem(WORKSPACE_PROJECT_STORAGE_KEY);
    }
  }, [selectedProjectIdState]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(WORKSPACE_FOLDER_STORAGE_KEY, selectedFolderId);
  }, [selectedFolderId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      WORKSPACE_FILTERS_STORAGE_KEY,
      JSON.stringify({
        selectedYears,
        selectedTracks,
        searchQuery,
      })
    );
  }, [searchQuery, selectedTracks, selectedYears]);

  const refreshOrganizations = useCallback(async () => {
    if (!user || !session?.access_token) {
      setOrganizations([]);
      setSelectedOrganizationIdState(null);
      return;
    }

    const response = await fetch("/api/workspace/organizations", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const payload = (await response.json()) as {
      organizations?: WorkspaceOrganizationRow[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load organizations.");
    }

    const nextOrganizations = sortByName(payload.organizations ?? []);
    setOrganizations(nextOrganizations);
    setSelectedOrganizationIdState((current) => {
      if (current && nextOrganizations.some((organization) => organization.id === current)) {
        return current;
      }
      return nextOrganizations[0]?.id ?? null;
    });
  }, [session?.access_token, user]);

  const refreshProjects = useCallback(
    async (organizationId?: string | null) => {
      const targetOrganizationId = organizationId ?? selectedOrganizationIdState;

      if (!user || !session?.access_token || !targetOrganizationId) {
        setProjects([]);
        setSelectedProjectIdState(null);
        return;
      }

      const response = await fetch(
        `/api/workspace/projects?organizationId=${encodeURIComponent(targetOrganizationId)}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      const payload = (await response.json()) as {
        projects?: WorkspaceProjectRow[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load projects.");
      }

      const nextProjects = sortByName(payload.projects ?? []);
      setProjects(nextProjects);
      setSelectedProjectIdState((current) => {
        if (current && nextProjects.some((project) => project.id === current)) {
          return current;
        }
        return nextProjects[0]?.id ?? null;
      });
    },
    [selectedOrganizationIdState, session?.access_token, user]
  );

  const refreshAllProjects = useCallback(async () => {
    if (!user || !session?.access_token) {
      setAllProjects([]);
      return;
    }

    const response = await fetch("/api/workspace/projects", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const payload = (await response.json()) as {
      projects?: WorkspaceProjectRow[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load projects.");
    }

    setAllProjects(sortByName(payload.projects ?? []));
  }, [session?.access_token, user]);

  const refreshFolders = useCallback(async () => {
    if (!user || !session?.access_token || !selectedProjectIdState) {
      setFolders([]);
      setSelectedFolderIdState("all");
      return;
    }

    const response = await fetch(
      `/api/workspace/folders?projectId=${encodeURIComponent(selectedProjectIdState)}`,
      {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }
    );

    const payload = (await response.json()) as {
      folders?: ResearchFolderRow[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load folders.");
    }

    const nextFolders = sortByName(payload.folders ?? []);
    setFolders(nextFolders);
    setSelectedFolderIdState((current) =>
      current === "all" || nextFolders.some((folder) => folder.id === current)
        ? current
        : "all"
    );
  }, [selectedProjectIdState, session?.access_token, user]);

  const refreshAllFolders = useCallback(async () => {
    if (!user || !session?.access_token) {
      setAllFolders([]);
      return;
    }

    const response = await fetch("/api/workspace/folders", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const payload = (await response.json()) as {
      folders?: ResearchFolderRow[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load workspace folders.");
    }

    setAllFolders(sortByName(payload.folders ?? []));
  }, [session?.access_token, user]);

  const createOrganization = useCallback(
    async (name: string, type: WorkspaceOrganizationRow["type"]) => {
      if (!user || !session?.access_token) {
        throw new Error("Sign in before creating organizations.");
      }

      const response = await fetch("/api/workspace/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name, type }),
      });

      const payload = (await response.json()) as {
        organization?: WorkspaceOrganizationRow;
        error?: string;
      };

      if (!response.ok || !payload.organization) {
        throw new Error(payload.error ?? "Failed to create organization.");
      }

      setOrganizations((current) =>
        sortByName([
          payload.organization!,
          ...current.filter((organization) => organization.id !== payload.organization!.id),
        ])
      );
      setSelectedOrganizationIdState(payload.organization.id);
      return payload.organization;
    },
    [session?.access_token, user]
  );

  const createProject = useCallback(
    async (
      name: string,
      options?: { organizationId?: string | null; description?: string | null }
    ) => {
      const organizationId =
        options?.organizationId ?? selectedOrganizationIdState ?? null;

      if (!user || !session?.access_token || !organizationId) {
        throw new Error("Select an organization before creating projects.");
      }

      const response = await fetch("/api/workspace/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          organizationId,
          name,
          description: options?.description ?? null,
        }),
      });

      const payload = (await response.json()) as {
        project?: WorkspaceProjectRow;
        error?: string;
      };

      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? "Failed to create project.");
      }

      setProjects((current) =>
        sortByName([
          payload.project!,
          ...current.filter((project) => project.id !== payload.project!.id),
        ])
      );
      setAllProjects((current) =>
        sortByName([
          payload.project!,
          ...current.filter((project) => project.id !== payload.project!.id),
        ])
      );
      setSelectedProjectIdState(payload.project.id);
      return payload.project;
    },
    [selectedOrganizationIdState, session?.access_token, user]
  );

  const createFolder = useCallback(
    async (folderName: string) => {
      if (!user || !session?.access_token || !selectedProjectIdState) {
        throw new Error("Choose a project before creating folders.");
      }

      const response = await fetch("/api/workspace/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: folderName,
          projectId: selectedProjectIdState,
        }),
      });

      const payload = (await response.json()) as {
        folder?: ResearchFolderRow;
        error?: string;
      };

      if (!response.ok || !payload.folder) {
        throw new Error(payload.error ?? "Failed to create folder.");
      }

      setFolders((current) =>
        sortByName([
          payload.folder!,
          ...current.filter((folder) => folder.id !== payload.folder!.id),
        ])
      );
      setAllFolders((current) =>
        sortByName([
          payload.folder!,
          ...current.filter((folder) => folder.id !== payload.folder!.id),
        ])
      );
      setSelectedFolderIdState(payload.folder.id);
      return payload.folder;
    },
    [selectedProjectIdState, session?.access_token, user]
  );

  useEffect(() => {
    if (!hydrated || !user) {
      return;
    }

    refreshOrganizations().catch(() => {
      setOrganizations([]);
    });
  }, [hydrated, refreshOrganizations, user]);

  useEffect(() => {
    if (!hydrated || !user) {
      return;
    }

    refreshProjects().catch(() => {
      setProjects([]);
    });
  }, [hydrated, refreshProjects, selectedOrganizationIdState, user]);

  useEffect(() => {
    if (!hydrated || !user) {
      return;
    }

    refreshAllProjects().catch(() => {
      setAllProjects([]);
    });
  }, [hydrated, refreshAllProjects, user]);

  useEffect(() => {
    if (!hydrated || !user) {
      return;
    }

    refreshFolders().catch(() => {
      setFolders([]);
    });
  }, [hydrated, refreshFolders, selectedProjectIdState, user]);

  useEffect(() => {
    if (!hydrated || !user) {
      return;
    }

    refreshAllFolders().catch(() => {
      setAllFolders([]);
    });
  }, [hydrated, refreshAllFolders, user]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!analysisSession || analysisSession.runIds.length === 0) {
      window.localStorage.removeItem(ANALYSIS_SESSION_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      ANALYSIS_SESSION_STORAGE_KEY,
      JSON.stringify(analysisSession)
    );
  }, [analysisSession]);

  useEffect(() => {
    if (!hydrated || !user) {
      return;
    }

    saveWorkspaceProfileRemote(profile).catch(() => {
      // The local profile still persists in localStorage, so the workspace
      // remains usable even if the remote sync fails temporarily.
    });
  }, [hydrated, profile, saveWorkspaceProfileRemote, user]);

  const currentOrganization =
    organizations.find((organization) => organization.id === selectedOrganizationIdState) ??
    null;
  const currentProject =
    projects.find((project) => project.id === selectedProjectIdState) ??
    allProjects.find((project) => project.id === selectedProjectIdState) ??
    null;

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      profile,
      hydrated,
      analysisSession,
      organizations,
      projects,
      allProjects,
      folders,
      allFolders,
      currentOrganization,
      currentProject,
      selectedOrganizationId: selectedOrganizationIdState,
      selectedProjectId: selectedProjectIdState,
      selectedFolderId,
      selectedYears,
      selectedTracks,
      searchQuery,
      hasActiveProject: Boolean(currentProject),
      updateProfile: (updates) => {
        setProfile((current) => ({
          ...current,
          ...updates,
          updatedAt: new Date().toISOString(),
        }));
      },
      resetProfile: () => {
        setProfile({
          ...DEFAULT_WORKSPACE_PROFILE,
          updatedAt: new Date().toISOString(),
        });
      },
      startAnalysisSession: (runs, options) => {
        const runIds = runs.map((run) => run.id).filter(Boolean);
        if (runIds.length === 0) {
          return;
        }

        setAnalysisSession({
          runIds,
          folderJobId: options?.folderJob?.id ?? null,
          folderId: options?.folderId ?? null,
          sourceKind: options?.sourceKind ?? "pdf-upload",
          folder: options?.folder ?? "Inbox",
          minimized: false,
          startedAt: new Date().toISOString(),
        });
      },
      setAnalysisMinimized: (minimized) => {
        setAnalysisSession((current) =>
          current ? { ...current, minimized } : current
        );
      },
      removeAnalysisRunIds: (runIds) => {
        const idsToRemove = new Set(runIds);
        if (idsToRemove.size === 0) {
          return;
        }

        setAnalysisSession((current) => {
          if (!current) {
            return current;
          }

          const nextRunIds = current.runIds.filter((runId) => !idsToRemove.has(runId));
          if (nextRunIds.length === 0) {
            return null;
          }

          return {
            ...current,
            runIds: nextRunIds,
          };
        });
      },
      clearAnalysisSession: () => {
        setAnalysisSession(null);
      },
      setSelectedOrganizationId: (organizationId) => {
        setProjects(
          organizationId
            ? sortByName(
                allProjects.filter(
                  (project) => project.organization_id === organizationId
                )
              )
            : []
        );
        setSelectedOrganizationIdState(organizationId);
        setSelectedProjectIdState(null);
        setSelectedFolderIdState("all");
      },
      setSelectedProjectId: (projectId) => {
        const matchingProject =
          allProjects.find((project) => project.id === projectId) ?? null;

        if (matchingProject) {
          setSelectedOrganizationIdState(matchingProject.organization_id);
          setProjects(
            sortByName(
              allProjects.filter(
                (project) =>
                  project.organization_id === matchingProject.organization_id
              )
            )
          );
          setFolders(
            sortByName(
              allFolders.filter((folder) => folder.project_id === matchingProject.id)
            )
          );
        } else if (!projectId) {
          setFolders([]);
        }

        setSelectedProjectIdState(projectId);
        setSelectedFolderIdState("all");
      },
      setSelectedFolderId: (folderId) => {
        setSelectedFolderIdState(folderId || "all");
      },
      setSelectedYears: (years) => {
        setSelectedYearsState([...new Set(years.filter(Boolean))].sort());
      },
      setSelectedTracks: (tracks) => {
        const nextTracks = [...new Set(tracks.filter(Boolean))];
        setSelectedTracksState(nextTracks.length > 0 ? nextTracks : [...TRACK_COLS]);
      },
      setSearchQuery: (nextSearchQuery) => {
        setSearchQueryState(nextSearchQuery);
      },
      resetWorkspaceFilters: () => {
        setSelectedFolderIdState("all");
        setSelectedYearsState([]);
        setSelectedTracksState([...TRACK_COLS]);
        setSearchQueryState("");
      },
      refreshOrganizations,
      refreshProjects,
      refreshFolders,
      createOrganization,
      createProject,
      createFolder,
    }),
    [
      analysisSession,
      createFolder,
      createOrganization,
      createProject,
      currentOrganization,
      currentProject,
      allFolders,
      allProjects,
      folders,
      hydrated,
      organizations,
      profile,
      projects,
      refreshFolders,
      refreshOrganizations,
      refreshProjects,
      searchQuery,
      selectedFolderId,
      selectedOrganizationIdState,
      selectedProjectIdState,
      selectedTracks,
      selectedYears,
    ]
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceProfile(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspaceProfile must be used within WorkspaceProvider.");
  }

  return context;
}
