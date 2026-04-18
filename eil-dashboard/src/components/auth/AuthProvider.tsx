"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { AuthContextValue, UserProfileRecord } from "@/types/auth";
import type { WorkspaceProfile } from "@/types/workspace";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function getRedirectTo(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return `${window.location.origin}/organizations`;
}

function getUserMetadata(user: User): { full_name: string | null; avatar_url: string | null } {
  const metadata = user.user_metadata ?? {};

  return {
    full_name:
      metadata.full_name ??
      metadata.name ??
      metadata.user_name ??
      metadata.preferred_username ??
      null,
    avatar_url: metadata.avatar_url ?? metadata.picture ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfileRecord | null>(null);

  const loadProfile = useCallback(async (activeUser: User | null) => {
    if (!supabase || !activeUser) {
      setProfile(null);
      return;
    }

    const metadata = getUserMetadata(activeUser);
    const fallbackPayload = {
      id: activeUser.id,
      email: activeUser.email ?? null,
      full_name: metadata.full_name,
      avatar_url: metadata.avatar_url,
    };

    const { data, error } = await supabase
      .from("user_profiles")
      .upsert(fallbackPayload, { onConflict: "id" })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    setProfile((data ?? null) as UserProfileRecord | null);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setHydrated(true);
      return;
    }

    let mounted = true;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!mounted) {
          return;
        }

        setSession(data.session);
        setUser(data.session?.user ?? null);

        if (data.session?.user) {
          try {
            await loadProfile(data.session.user);
          } catch {
            setProfile(null);
          }
        } else {
          setProfile(null);
        }

        if (mounted) {
          setHydrated(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setHydrated(true);
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.user) {
        loadProfile(nextSession.user).catch(() => {
          setProfile(null);
        });
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    await loadProfile(user);
  }, [loadProfile, user]);

  const saveWorkspaceProfile = useCallback(
    async (workspaceProfile: WorkspaceProfile) => {
      if (!supabase || !user) {
        return;
      }

      const existingWorkspaceProfile = profile?.workspace_profile ?? null;
      const mergedWorkspaceProfile: WorkspaceProfile = {
        ...workspaceProfile,
        analysisHistoryHiddenByProject:
          workspaceProfile.analysisHistoryHiddenByProject &&
          typeof workspaceProfile.analysisHistoryHiddenByProject === "object"
            ? workspaceProfile.analysisHistoryHiddenByProject
            : existingWorkspaceProfile?.analysisHistoryHiddenByProject ?? {},
        projectCorpusTopicCacheByProject:
          existingWorkspaceProfile?.projectCorpusTopicCacheByProject &&
          typeof existingWorkspaceProfile.projectCorpusTopicCacheByProject === "object"
            ? existingWorkspaceProfile.projectCorpusTopicCacheByProject
            : workspaceProfile.projectCorpusTopicCacheByProject,
      };

      const { error } = await supabase
        .from("user_profiles")
        .update({
          workspace_profile: mergedWorkspaceProfile,
        })
        .eq("id", user.id);

      if (error) {
        throw error;
      }
    },
    [profile?.workspace_profile, user]
  );

  const saveUserProfile = useCallback(
    async (updates: { full_name?: string; avatar_url?: string }) => {
      if (!supabase || !user) {
        throw new Error("Supabase auth is not configured.");
      }

      const payload = {
        full_name: updates.full_name?.trim() || null,
        avatar_url: updates.avatar_url?.trim() || null,
      };

      const { error: profileError } = await supabase
        .from("user_profiles")
        .update(payload)
        .eq("id", user.id);

      if (profileError) {
        throw profileError;
      }

      const { error: userError } = await supabase.auth.updateUser({
        data: payload,
      });

      if (userError) {
        throw userError;
      }

      await loadProfile(user);
    },
    [loadProfile, user]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      hydrated,
      session,
      user,
      profile,
      isAdmin: profile?.role === "admin",
      signInWithProvider: async (provider) => {
        if (!supabase) {
          throw new Error("Supabase auth is not configured.");
        }

        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: getRedirectTo(),
          },
        });

        if (error) {
          throw error;
        }
      },
      signInWithPassword: async (email, password) => {
        if (!supabase) {
          throw new Error("Supabase auth is not configured.");
        }

        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          throw error;
        }
      },
      signUpWithPassword: async (email, password, metadata) => {
        if (!supabase) {
          throw new Error("Supabase auth is not configured.");
        }

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: getRedirectTo(),
            data: metadata,
          },
        });

        if (error) {
          throw error;
        }
      },
      signOut: async () => {
        if (!supabase) {
          throw new Error("Supabase auth is not configured.");
        }

        const { error } = await supabase.auth.signOut();
        if (error) {
          throw error;
        }
      },
      refreshProfile,
      saveUserProfile,
      saveWorkspaceProfile,
    }),
    [
      hydrated,
      profile,
      refreshProfile,
      saveUserProfile,
      saveWorkspaceProfile,
      session,
      user,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}
