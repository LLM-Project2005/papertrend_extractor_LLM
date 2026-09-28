"use client";

import { MIN_NEW_PASSWORD_LENGTH, friendlyAuthError } from "@/lib/auth/auth-errors";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { GoogleIcon, FacebookIcon, SpinnerIcon, UserIcon } from "@/components/ui/Icons";
import { buttonClass, fieldClass, labelClass } from "@/components/ui/controls";

const OAUTH_OPTIONS = [
  {
    provider: "google" as const,
    label: "Continue with Google",
    icon: GoogleIcon,
  },
  {
    provider: "facebook" as const,
    label: "Continue with Facebook",
    icon: FacebookIcon,
  },
] as const;

interface AuthPanelProps {
  title?: string;
  description?: string;
}

export default function AuthPanel({
  title = "Sign in",
  description = "Use Google, Facebook, or your email and password.",
}: AuthPanelProps) {
  const {
    hydrated,
    user,
    profile,
    isAdmin,
    signInWithProvider,
    signInWithPassword,
    signUpWithPassword,
    resetPassword,
    signOut,
    authError,
    authErrorCode,
    resendVerificationEmail,
    confirmEmailVerified,
  } = useAuth();
  const [busy, setBusy] = useState(false);
  // Back from the Google or Facebook consent screen can restore this page from
  // the browser's cache with the buttons still disabled; a restored page is
  // ready again.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [passwordMode, setPasswordMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  const displayName = useMemo(() => {
    return (
      profile?.full_name ||
      user?.user_metadata?.full_name ||
      user?.email ||
      "Signed in"
    );
  }, [profile?.full_name, user?.email, user?.user_metadata]);
  // An address waiting for confirmation is a step, not an error: it gets its
  // own panel instead of the red box.
  const awaitingConfirmation = authErrorCode === "email_unverified";
  const visibleError = error ?? (awaitingConfirmation ? null : authError);
  const [confirmState, setConfirmState] = useState<"idle" | "checking" | "not-yet" | "sent" | "sending">("idle");

  // The confirmation link returns here with ?confirmed=1: check straight away.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("confirmed") === "1") {
      void confirmEmailVerified().catch(() => undefined);
    }
  }, [confirmEmailVerified]);

  async function handleProviderSignIn(
    provider: (typeof OAUTH_OPTIONS)[number]["provider"]
  ) {
    setBusy(true);
    setError(null);

    try {
      await signInWithProvider(provider);
    } catch (signInError) {
      const message =
        signInError instanceof Error ? signInError.message : "Sign-in failed.";
      setError(
        /timed out/i.test(message)
          ? "Sign-in took too long to reach the sign-in service. Try again in a moment."
          : friendlyAuthError(signInError, "Sign-in failed. Try again.")
      );
      setBusy(false);
    }
  }

  if (!hydrated) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading sign-in">
        <span className="skeleton block h-11 w-full rounded-lg" />
        <span className="skeleton block h-11 w-full rounded-lg" />
        <span className="skeleton mt-6 block h-40 w-full rounded-lg" />
        <p className="sr-only">Loading sign-in…</p>
      </div>
    );
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (passwordMode === "signup") {
        await signUpWithPassword(email, password, { full_name: fullName });
        setNotice(`We sent a confirmation link to ${email}. Open it to finish creating your account.`);
      } else {
        await signInWithPassword(email, password);
      }
    } catch (passwordError) {
      setError(friendlyAuthError(passwordError, "Password sign-in failed. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordReset() {
    if (!email.trim()) {
      setError("Enter your email first, then request a reset link.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await resetPassword(email);
      setNotice("If that email can receive reset mail, a reset link is on the way.");
    } catch (resetError) {
      setError(friendlyAuthError(resetError, "The reset email could not be sent. Try again in a minute."));
    } finally {
      setBusy(false);
    }
  }

  const messages = (
    <>
      {awaitingConfirmation ? (
        <div className="mt-5 rounded-lg border border-hairline bg-subtle px-3.5 py-3.5 text-sm leading-6 text-body">
          <p className="font-medium text-ink">Confirm your email address</p>
          <p className="mt-1">{authError}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={confirmState === "checking"}
              onClick={() => {
                setConfirmState("checking");
                void confirmEmailVerified()
                  .then((confirmed) => setConfirmState(confirmed ? "idle" : "not-yet"))
                  .catch(() => setConfirmState("not-yet"));
              }}
              className={buttonClass("primary", "sm")}
            >
              {confirmState === "checking" ? "Checking…" : "I’ve confirmed it"}
            </button>
            <button
              type="button"
              disabled={confirmState === "sending"}
              onClick={() => {
                setConfirmState("sending");
                void resendVerificationEmail()
                  .then(() => setConfirmState("sent"))
                  .catch((sendError) => {
                    setConfirmState("idle");
                    setError(friendlyAuthError(sendError, "The email could not be sent. Try again in a minute."));
                  });
              }}
              className={buttonClass("secondary", "sm")}
            >
              {confirmState === "sending" ? "Sending…" : "Send the link again"}
            </button>
          </div>
          <p className="mt-2 min-h-5 text-[13px] text-mute" role="status">
            {confirmState === "not-yet"
              ? "Not confirmed yet. Open the link in the email (check spam too), then try again."
              : confirmState === "sent"
                ? "A new link is on its way."
                : ""}
          </p>
        </div>
      ) : null}
      <div role="alert">
        {visibleError ? (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm leading-6 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {visibleError}
          </div>
        ) : null}
      </div>
      <div role="status">
        {notice ? (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm leading-6 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
            {notice}
          </div>
        ) : null}
      </div>
    </>
  );

  if (user) {
    return (
      <section>
        <div className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-subtle text-body">
            <UserIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{displayName}</p>
            <p className="truncate text-[13px] text-mute">
              {user.email} · {isAdmin ? "Admin" : "Member"}
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm text-body">You are signed in. Taking you to your workspace…</p>
        <button
          type="button"
          onClick={() => {
            setBusy(true);
            signOut()
              .catch((signOutError) => {
                setError(
                  signOutError instanceof Error ? signOutError.message : "Sign-out failed."
                );
              })
              .finally(() => {
                setBusy(false);
              });
          }}
          disabled={busy}
          className={buttonClass("secondary", "md", "mt-4")}
        >
          Sign out
        </button>
        {messages}
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-ink">
        {passwordMode === "signup" ? "Create your account" : title}
      </h1>
      <p className="mt-2 text-[15px] leading-7 text-body">{description}</p>

      <div className="mt-8 grid gap-2.5">
        {OAUTH_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.provider}
              type="button"
              onClick={() => handleProviderSignIn(option.provider)}
              disabled={busy}
              className={buttonClass("secondary", "lg", "w-full")}
            >
              <Icon className="h-5 w-5" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>

      <div className="my-6 flex items-center gap-3 text-xs text-mute">
        <span className="h-px flex-1 bg-hairline" />
        <span>or with email</span>
        <span className="h-px flex-1 bg-hairline" />
      </div>

      <form className="space-y-4" onSubmit={handlePasswordSubmit}>
        {passwordMode === "signup" ? (
          <div>
            <label htmlFor="auth-name" className={labelClass}>
              Name
            </label>
            <input
              id="auth-name"
              name="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              maxLength={120}
              autoComplete="name"
              className={`${fieldClass} mt-1.5 h-11`}
              placeholder="Your name"
            />
          </div>
        ) : null}

        <div>
          <label htmlFor="auth-email" className={labelClass}>
            Email
          </label>
          <input
            id="auth-email"
            name="email"
            type="email"
            spellCheck={false}
            autoCapitalize="none"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            className={`${fieldClass} mt-1.5 h-11`}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="auth-password" className={labelClass}>
              Password
            </label>
            <button
              type="button"
              onClick={handlePasswordReset}
              disabled={busy}
              className="-my-2 rounded px-1 py-2 text-[13px] font-medium text-body transition-colors hover:text-ink disabled:opacity-60"
            >
              Reset password
            </button>
          </div>
          <input
            id="auth-password"
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={passwordMode === "signup" ? "new-password" : "current-password"}
            // The length rule applies to new passwords only; an existing, shorter
            // one still signs in until it is changed.
            minLength={passwordMode === "signup" ? MIN_NEW_PASSWORD_LENGTH : undefined}
            maxLength={256}
            required
            className={`${fieldClass} mt-1.5 h-11`}
            placeholder={passwordMode === "signup" ? `At least ${MIN_NEW_PASSWORD_LENGTH} characters` : "Your password"}
          />
        </div>

        <button type="submit" disabled={busy} className={buttonClass("primary", "lg", "w-full")}>
          {busy ? <SpinnerIcon className="h-4 w-4" /> : null}
          {passwordMode === "signup" ? "Create account" : "Sign in with password"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-body">
        {passwordMode === "signup" ? "Already have an account? " : "No account yet? "}
        <button
          type="button"
          onClick={() => {
            setPasswordMode((mode) => (mode === "signin" ? "signup" : "signin"));
            setError(null);
            setNotice(null);
          }}
          className="-my-2 rounded px-1 py-2 font-medium text-ink underline-offset-4 hover:underline"
        >
          {passwordMode === "signup" ? "Sign in" : "Create password account"}
        </button>
      </p>

      {messages}
    </section>
  );
}
