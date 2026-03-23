"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
  const {
    hydrated: authHydrated,
    user,
    profile: authProfile,
    saveWorkspaceProfile: saveWorkspaceProfileRemote,
  } = useAuth();
  const [profile, setProfile] = useState(DEFAULT_WORKSPACE_PROFILE);
  const [hydrated, setHydrated] = useState(false);
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
