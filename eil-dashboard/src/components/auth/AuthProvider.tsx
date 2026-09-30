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
  reloadFirebaseUser,
  sendFirebaseVerificationEmail,
  signUpWithFirebasePassword,
  subscribeToFirebaseTokens,
  updateFirebaseUserProfile,
} from "@/lib/firebase-client";
import type { AuthContextValue, AuthSession, UserProfileRecord } from "@/types/auth";
import {
  classifyProfileFailure,
  isProfileRefusalCode,
  PROFILE_CHECK_TIMEOUT_MS,
  PROFILE_GAVE_UP_MESSAGE,
  PROFILE_RETRY_DELAYS_MS,
  PROFILE_UNREACHABLE_MESSAGE,
  refusalMessage,
} from "@/lib/auth/profile-failure";
import type { WorkspaceProfile } from "@/types/workspace";
import { safeReturnPath } from "@/lib/safe-return-path";

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
  const returnTo = safeReturnPath(currentUrl.searchParams.get("returnTo"), "");
  if (currentUrl.pathname === "/login" && returnTo) {
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

type FirebaseUserLike = NonNullable<Parameters<Parameters<typeof subscribeToFirebaseTokens>[1]>[0]>;

/** Why a profile check failed: an HTTP status, or no answer at all. */
class ProfileCheckFailure extends Error {
  constructor(
    readonly status: number | "network",
    readonly code?: string,
    readonly serverMessage?: string
  ) {
    super(`profile check failed: ${status}`);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfileRecord | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authErrorCode, setAuthErrorCode] = useState<AuthContextValue["authErrorCode"]>(null);
  const firebaseProfileRequestRef = useRef<{
    key: string;
    promise: Promise<void>;
  } | null>(null);
  const firebaseProfileAttemptRef = useRef<{ key: string; at: number } | null>(null);
  /** The Firebase user the current session belongs to; a transient failure keeps them signed in. */
  const signedInUidRef = useRef<string | null>(null);

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
      let retryTimer: ReturnType<typeof setTimeout> | null = null;

      void (async () => {
        const firebaseAuth = await getFirebaseAuth();
        if (configurationError || !firebaseAuth) {
          if (mounted) {
            setAuthError(configurationError ?? "Firebase authentication is not configured.");
            setHydrated(true);
          }
          return;
        }

        const scheduleRetry = (firebaseUser: FirebaseUserLike, attempt: number) => {
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => {
            retryTimer = null;
            // The 30-second guard stops duplicate token events, not retries.
            firebaseProfileAttemptRef.current = null;
            void handleFirebaseUser(firebaseUser, attempt + 1);
          }, PROFILE_RETRY_DELAYS_MS[attempt]);
        };

        const handleFirebaseUser = async (firebaseUser: FirebaseUserLike | null, attempt = 0): Promise<void> => {
          if (!mounted) {
            return;
          }

          if (!firebaseUser) {
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = null;
            signedInUidRef.current = null;
            firebaseProfileRequestRef.current = null;
            firebaseProfileAttemptRef.current = null;
            setAuthError(null);
            setSession(null);
            setUser(null);
            setProfile(null);
            setHydrated(true);
            return;
          }

          let firebaseSession: AuthSession | null = null;
          try {
            try {
              firebaseSession = await firebaseUserToSession(firebaseUser, firebaseUser.uid);
            } catch {
              // No token without a network: the same as a failed request.
              throw new ProfileCheckFailure("network");
            }
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
            const token = firebaseSession.access_token;
            const profileRequest = (async () => {
              let response: Response;
              try {
                response = await fetch("/api/auth/profile", {
                  headers: { Authorization: `Bearer ${token}` },
                  signal: AbortSignal.timeout(PROFILE_CHECK_TIMEOUT_MS),
                });
              } catch {
                throw new ProfileCheckFailure("network");
              }
              const payload = (await response.json().catch(() => ({}))) as {
                error?: string;
                code?: string;
                ownerUserId?: string;
                profile?: UserProfileRecord | null;
              };
              if (!response.ok || !payload.ownerUserId) {
                // A 200 without an owner is a refusal: the account is not linked.
                throw new ProfileCheckFailure(response.ok ? 403 : response.status, payload.code, payload.error);
              }

              const mappedUser = firebaseUserToPapertrendUser(firebaseUser, payload.ownerUserId);
              signedInUidRef.current = firebaseUser.uid;
              setAuthErrorCode(null);
              setAuthError(null);
              setSession({ ...firebaseSession!, user: mappedUser });
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
            const failure = error instanceof ProfileCheckFailure ? error : new ProfileCheckFailure("network");
            if (classifyProfileFailure(failure.status) === "transient") {
              if (signedInUidRef.current === firebaseUser.uid) {
                // Still the same person: stay signed in with the fresh token, and try again quietly.
                const fresh = firebaseSession;
                if (fresh) setSession((current) => (current ? { ...fresh, user: current.user } : current));
                if (attempt < PROFILE_RETRY_DELAYS_MS.length) scheduleRetry(firebaseUser, attempt);
                return;
              }
              setAuthErrorCode(null);
              setAuthError(attempt < PROFILE_RETRY_DELAYS_MS.length ? PROFILE_UNREACHABLE_MESSAGE : PROFILE_GAVE_UP_MESSAGE);
              setHydrated(true);
              if (attempt < PROFILE_RETRY_DELAYS_MS.length) scheduleRetry(firebaseUser, attempt);
              return;
            }
            signedInUidRef.current = null;
            const status = failure.status === "network" ? 401 : failure.status;
            setAuthErrorCode(isProfileRefusalCode(failure.code) ? failure.code : status === 403 ? "not_linked" : null);
            setSession(null);
            setUser(null);
            setProfile(null);
            setAuthError(refusalMessage(status, failure.code, failure.serverMessage));
            setHydrated(true);
          }
        };

        const firebaseUnsubscribe = await subscribeToFirebaseTokens(firebaseAuth, (firebaseUser) =>
          handleFirebaseUser(firebaseUser)
        );
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
        if (retryTimer) clearTimeout(retryTimer);
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
        const currentWorkspaceProfile = profile?.workspace_profile;
        if (
          currentWorkspaceProfile &&
          JSON.stringify(currentWorkspaceProfile) === JSON.stringify(mergedWorkspaceProfile)
        ) {
          return;
        }

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
      authErrorCode,
      resendVerificationEmail: async () => {
        const firebaseAuth = await getFirebaseAuth();
        if (!firebaseAuth) throw new Error("Sign-in is not available right now.");
        await sendFirebaseVerificationEmail(firebaseAuth);
      },
      confirmEmailVerified: async () => {
        const firebaseAuth = await getFirebaseAuth();
        if (!firebaseAuth) return false;
        // A fresh token re-runs the profile check through the token listener.
        firebaseProfileAttemptRef.current = null;
        return reloadFirebaseUser(firebaseAuth);
      },
      redeemInviteCode: async (code) => {
        const firebaseAuth = await getFirebaseAuth();
        const firebaseUser = firebaseAuth?.currentUser;
        if (!firebaseUser) throw new Error("Sign in first, then enter your invite code.");
        const response = await fetch("/api/auth/invite", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${await firebaseUser.getIdToken()}`,
          },
          body: JSON.stringify({ code }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "The invite code couldn't be checked. Try again in a moment.");
        }
        // The account exists now; a fresh token re-runs the profile check.
        firebaseProfileAttemptRef.current = null;
        await firebaseUser.getIdToken(true);
      },
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
      authErrorCode,
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
