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
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  firebaseUserToPapertrendUser,
  firebaseUserToSession,
  getClientAuthProvider,
  getFirebaseAuth,
  getFirebaseAuthConfigurationError,
  sendFirebasePasswordReset,
  signInWithFirebasePassword,
  signInWithFirebaseProvider,
  signOutFirebase,
  signUpWithFirebasePassword,
  subscribeToFirebaseTokens,
  updateFirebaseUserProfile,
} from "@/lib/firebase-client";
import type { AuthContextValue, AuthSession, UserProfileRecord } from "@/types/auth";
import type { WorkspaceProfile } from "@/types/workspace";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const configuredAuthProvider = getClientAuthProvider();

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error("Auth profile request timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function getRedirectTo(): string | undefined {
  const configuredSiteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") || null;

  if (typeof window === "undefined") {
    return configuredSiteUrl ? `${configuredSiteUrl}/workspaces` : undefined;
  }

  const currentUrl = new URL(window.location.href);
  const returnTo = currentUrl.searchParams.get("returnTo");
  if (
    currentUrl.pathname === "/login" &&
    returnTo &&
    returnTo.startsWith("/") &&
    !returnTo.startsWith("//")
  ) {
    return `${window.location.origin}/login?returnTo=${encodeURIComponent(returnTo)}`;
  }

  return `${window.location.origin}/workspaces`;
}

function toAppSession(session: Session): AuthSession {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    user: session.user,
    provider: "supabase",
  };
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

async function postPasswordAuth<TPayload>(
  path: string,
  payload: Record<string, unknown>
): Promise<TPayload> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as TPayload & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? "Authentication request failed.");
  }
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfileRecord | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const firebaseProfileRequestRef = useRef<{
    key: string;
    promise: Promise<void>;
  } | null>(null);
  const firebaseProfileAttemptRef = useRef<{ key: string; at: number } | null>(null);

  const loadProfile = useCallback(async (activeUser: User | null, accessToken?: string) => {
    if (!activeUser) {
      setProfile(null);
      return;
    }

    if (configuredAuthProvider === "firebase") {
      if (!accessToken) {
        setProfile(null);
        return;
      }
      const response = await fetch("/api/auth/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        profile?: UserProfileRecord | null;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load the Firebase profile.");
      }
      setProfile(payload.profile ?? null);
      return;
    }

    if (!supabase) {
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

    const profileResult = await withTimeout(
      Promise.resolve(
        supabase
          .from("user_profiles")
          .upsert(fallbackPayload, { onConflict: "id" })
          .select("*")
          .single()
      ) as Promise<{ data: UserProfileRecord | null; error: Error | null }>,
      8000
    );
    const { data, error } = profileResult;

    if (error) {
      throw error;
    }

    setProfile((data ?? null) as UserProfileRecord | null);
  }, []);

  useEffect(() => {
    if (configuredAuthProvider === "firebase") {
      const configurationError = getFirebaseAuthConfigurationError();
      let mounted = true;
      let unsubscribe: (() => void) | null = null;

      void (async () => {
        const firebaseAuth = await getFirebaseAuth();
        if (configurationError || !firebaseAuth) {
          if (mounted) {
            setAuthError(configurationError ?? "Firebase authentication is not configured.");
            setHydrated(true);
          }
          return;
        }

        const firebaseUnsubscribe = await subscribeToFirebaseTokens(firebaseAuth, async (firebaseUser) => {
          if (!mounted) {
            return;
          }

          if (!firebaseUser) {
            firebaseProfileRequestRef.current = null;
            firebaseProfileAttemptRef.current = null;
            setAuthError(null);
            setSession(null);
            setUser(null);
            setProfile(null);
            setHydrated(true);
            return;
          }

          try {
            const firebaseSession = await firebaseUserToSession(firebaseUser, firebaseUser.uid);
            const requestKey = `${firebaseUser.uid}:${firebaseSession.access_token}`;
            const previousAttempt = firebaseProfileAttemptRef.current;
            const inFlightRequest = firebaseProfileRequestRef.current;

            // Firebase can emit the same token event more than once. Reuse an
            // in-flight request and suppress identical retries briefly so an
            // auth event cannot create a request loop.
            if (
              inFlightRequest?.key === requestKey
            ) {
              await inFlightRequest.promise;
              return;
            }
            if (
              previousAttempt?.key === requestKey &&
              Date.now() - previousAttempt.at < 30_000
            ) {
              return;
            }

            firebaseProfileAttemptRef.current = { key: requestKey, at: Date.now() };
            const profileRequest = (async () => {
              const response = await fetch("/api/auth/profile", {
                headers: { Authorization: `Bearer ${firebaseSession.access_token}` },
              });
              const payload = (await response.json().catch(() => ({}))) as {
                error?: string;
                ownerUserId?: string;
                profile?: UserProfileRecord | null;
              };
              if (!response.ok || !payload.ownerUserId) {
                throw new Error(
                  payload.error ??
                    "This Firebase account is not linked to a Papertrend owner account yet."
                );
              }

              const mappedUser = firebaseUserToPapertrendUser(firebaseUser, payload.ownerUserId);
              setAuthError(null);
              setSession({ ...firebaseSession, user: mappedUser });
              setUser(mappedUser);
              setProfile(payload.profile ?? null);
              setHydrated(true);
            })();
            firebaseProfileRequestRef.current = { key: requestKey, promise: profileRequest };
            try {
              await profileRequest;
            } finally {
              if (firebaseProfileRequestRef.current?.promise === profileRequest) {
                firebaseProfileRequestRef.current = null;
              }
            }
          } catch (error) {
            if (!mounted) {
              return;
            }
            setSession(null);
            setUser(null);
            setProfile(null);
            setAuthError(
              error instanceof Error
                ? error.message
                : "The Firebase account could not be linked to Papertrend."
            );
            setHydrated(true);
          }
        });
        if (mounted) {
          unsubscribe = firebaseUnsubscribe;
        } else {
          // The dynamic Firebase import can resolve after React has already
          // unmounted this provider (for example during a route refresh).
          firebaseUnsubscribe();
        }
      })();

      return () => {
        mounted = false;
        unsubscribe?.();
        firebaseProfileRequestRef.current = null;
      };
    }

    if (!supabase) {
      setHydrated(true);
      return;
    }

    let mounted = true;

    withTimeout(supabase.auth.getSession(), 8000)
      .then(({ data }) => {
        if (!mounted) {
          return;
        }

        setAuthError(null);
        setSession(data.session ? toAppSession(data.session) : null);
        setUser(data.session?.user ?? null);
        setHydrated(true);

        if (data.session?.user) {
          loadProfile(data.session.user, data.session.access_token).catch(() => {
            if (mounted) {
              setProfile(null);
            }
          });
        } else {
          setProfile(null);
        }
      })
      .catch(() => {
        if (mounted) {
          setAuthError(null);
          setSession(null);
          setUser(null);
          setProfile(null);
          setHydrated(true);
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, nextSession) => {
      setAuthError(null);
      setSession(nextSession ? toAppSession(nextSession) : null);
      setUser(nextSession?.user ?? null);
      setHydrated(true);

      if (nextSession?.user) {
        loadProfile(nextSession.user, nextSession.access_token).catch(() => {
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
    await loadProfile(user, session?.access_token);
  }, [loadProfile, session?.access_token, user]);

  const saveWorkspaceProfile = useCallback(
    async (workspaceProfile: WorkspaceProfile) => {
      if (!user) {
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

      if (configuredAuthProvider === "firebase") {
        if (!session?.access_token) {
          throw new Error("Firebase authentication is not ready.");
        }
        const response = await fetch("/api/auth/profile", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ workspace_profile: mergedWorkspaceProfile }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Could not save the workspace profile.");
        }
        await refreshProfile();
        return;
      }

      if (!supabase) {
        return;
      }

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
    [profile?.workspace_profile, refreshProfile, session?.access_token, user]
  );

  const saveUserProfile = useCallback(
    async (updates: { full_name?: string; avatar_url?: string }) => {
      if (!user) {
        throw new Error("Supabase auth is not configured.");
      }

      const payload = {
        full_name: updates.full_name?.trim() || null,
        avatar_url: updates.avatar_url?.trim() || null,
      };

      if (configuredAuthProvider === "firebase") {
        const firebaseAuth = await getFirebaseAuth();
        if (!firebaseAuth?.currentUser || !session?.access_token) {
          throw new Error("Firebase authentication is not ready.");
        }
        if (updates.full_name !== undefined) {
          await updateFirebaseUserProfile(firebaseAuth.currentUser, {
            displayName: payload.full_name,
            photoURL: payload.avatar_url,
          });
        }
        const response = await fetch("/api/auth/profile", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const responsePayload = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(responsePayload.error ?? "Could not save the user profile.");
        }
        await refreshProfile();
        return;
      }

      if (!supabase) {
        throw new Error("Supabase auth is not configured.");
      }

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

      await loadProfile(user, session?.access_token);
    },
    [loadProfile, refreshProfile, session?.access_token, user]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      hydrated,
      session,
      user,
      profile,
      isAdmin: profile?.role === "admin",
      authError,
      signInWithProvider: async (provider) => {
        if (configuredAuthProvider === "firebase") {
          const firebaseAuth = await getFirebaseAuth();
          if (!firebaseAuth) {
            throw new Error(getFirebaseAuthConfigurationError() ?? "Firebase authentication is not configured.");
          }
          await signInWithFirebaseProvider(firebaseAuth, provider);
          return;
        }

        if (!supabase) {
          throw new Error("Supabase auth is not configured.");
        }

        const { data, error } = await withTimeout(
          supabase.auth.signInWithOAuth({
            provider,
            options: {
              redirectTo: getRedirectTo(),
              skipBrowserRedirect: true,
            },
          }),
          10000
        );

        if (error) {
          throw error;
        }

        const redirectUrl = data?.url?.trim();
        if (!redirectUrl) {
          throw new Error("Supabase did not return an OAuth redirect URL.");
        }

        if (typeof window !== "undefined") {
          window.location.assign(redirectUrl);
        }
      },
      signInWithPassword: async (email, password) => {
        if (configuredAuthProvider === "firebase") {
          const firebaseAuth = await getFirebaseAuth();
          if (!firebaseAuth) {
            throw new Error(getFirebaseAuthConfigurationError() ?? "Firebase authentication is not configured.");
          }
          await signInWithFirebasePassword(firebaseAuth, email, password);
          return;
        }

        if (!supabase) {
          throw new Error("Supabase auth is not configured.");
        }

        const data = await postPasswordAuth<{
          session?: { access_token?: string; refresh_token?: string } | null;
        }>("/api/auth/password-login", {
          email,
          password,
        });

        if (!data.session?.access_token || !data.session.refresh_token) {
          throw new Error("Password sign-in did not return a session.");
        }
        const { error } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        if (error) {
          throw error;
        }
      },
      signUpWithPassword: async (email, password, metadata) => {
        if (configuredAuthProvider === "firebase") {
          const firebaseAuth = await getFirebaseAuth();
          if (!firebaseAuth) {
            throw new Error(getFirebaseAuthConfigurationError() ?? "Firebase authentication is not configured.");
          }
          await signUpWithFirebasePassword(firebaseAuth, email, password, metadata?.full_name);
          return;
        }

        if (!supabase) {
          throw new Error("Supabase auth is not configured.");
        }

        const data = await postPasswordAuth<{
          session?: { access_token?: string; refresh_token?: string } | null;
        }>("/api/auth/password-signup", {
          email,
          password,
          fullName: metadata?.full_name,
          returnTo: "/workspaces",
        });

        if (data.session?.access_token && data.session.refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          });
          if (error) {
            throw error;
          }
        }
      },
      resetPassword: async (email) => {
        if (configuredAuthProvider === "firebase") {
          const firebaseAuth = await getFirebaseAuth();
          if (!firebaseAuth) {
            throw new Error(getFirebaseAuthConfigurationError() ?? "Firebase authentication is not configured.");
          }
          await sendFirebasePasswordReset(firebaseAuth, email);
          return;
        }

        await postPasswordAuth("/api/auth/password-reset", {
          email,
          returnTo: "/login",
        });
      },
      signOut: async () => {
        if (configuredAuthProvider === "firebase") {
          const firebaseAuth = await getFirebaseAuth();
          if (!firebaseAuth) {
            throw new Error(getFirebaseAuthConfigurationError() ?? "Firebase authentication is not configured.");
          }
          await signOutFirebase(firebaseAuth);
          return;
        }

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
      authError,
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
