"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  DEFAULT_WORKSPACE_PROFILE,
  loadWorkspaceProfile,
  saveWorkspaceProfile as saveWorkspaceProfileLocal,
} from "@/lib/workspace-profile";
import type {
  FolderAnalysisJobRow,
  IngestionRunRow,
  ResearchFolderRow,
} from "@/types/database";
import type { WorkspaceProfile } from "@/types/workspace";

const ANALYSIS_SESSION_STORAGE_KEY = "papertrend_analysis_session_v1";
const WORKSPACE_FOLDER_STORAGE_KEY = "papertrend_workspace_folder_v1";

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
  folders: ResearchFolderRow[];
  selectedFolderId: string;
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
  setSelectedFolderId: (folderId: string) => void;
  refreshFolders: () => Promise<void>;
  createFolder: (folderName: string) => Promise<ResearchFolderRow>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined
);

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
  const [folders, setFolders] = useState<ResearchFolderRow[]>([]);
  const [selectedFolderId, setSelectedFolderIdState] = useState("all");
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
    setSelectedFolderIdState(savedFolderId);

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

    window.localStorage.setItem(WORKSPACE_FOLDER_STORAGE_KEY, selectedFolderId);
  }, [selectedFolderId]);

  const refreshFolders = useCallback(async () => {
    if (!user || !session?.access_token) {
      setFolders([]);
      setSelectedFolderIdState("all");
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
      throw new Error(payload.error ?? "Failed to load folders.");
    }

    const nextFolders = payload.folders ?? [];
    setFolders(nextFolders);
    setSelectedFolderIdState((current) =>
      current === "all" || nextFolders.some((folder) => folder.id === current)
        ? current
        : "all"
    );
  }, [session?.access_token, user]);

  const createFolder = useCallback(
    async (folderName: string) => {
      if (!user || !session?.access_token) {
        throw new Error("Sign in before creating folders.");
      }

      const response = await fetch("/api/workspace/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name: folderName }),
      });

      const payload = (await response.json()) as {
        folder?: ResearchFolderRow;
        error?: string;
      };

      if (!response.ok || !payload.folder) {
        throw new Error(payload.error ?? "Failed to create folder.");
      }

      setFolders((current) => {
        const next = [payload.folder!, ...current.filter((folder) => folder.id !== payload.folder!.id)];
        next.sort((left, right) => left.name.localeCompare(right.name));
        return next;
      });
      setSelectedFolderIdState(payload.folder.id);
      return payload.folder;
    },
    [session?.access_token, user]
  );

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    refreshFolders().catch(() => {
      setFolders([]);
    });
  }, [hydrated, refreshFolders]);

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

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      profile,
      hydrated,
      analysisSession,
      folders,
      selectedFolderId,
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
      setSelectedFolderId: (folderId) => {
        setSelectedFolderIdState(folderId || "all");
      },
      refreshFolders,
      createFolder,
    }),
    [analysisSession, createFolder, folders, hydrated, profile, refreshFolders, selectedFolderId]
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
