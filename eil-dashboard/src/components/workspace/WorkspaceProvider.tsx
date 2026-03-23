"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_WORKSPACE_PROFILE,
  loadWorkspaceProfile,
  saveWorkspaceProfile,
} from "@/lib/workspace-profile";
import type { WorkspaceProfile } from "@/types/workspace";

interface WorkspaceContextValue {
  profile: WorkspaceProfile;
  hydrated: boolean;
  updateProfile: (updates: Partial<WorkspaceProfile>) => void;
  resetProfile: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined
);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState(DEFAULT_WORKSPACE_PROFILE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setProfile(loadWorkspaceProfile());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    saveWorkspaceProfile(profile);
  }, [hydrated, profile]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      profile,
      hydrated,
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
    }),
    [hydrated, profile]
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
