"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { GoogleIcon, FacebookIcon, UserIcon } from "@/components/ui/Icons";

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
  eyebrow?: string;
  description?: string;
}

export default function AuthPanel({
  title = "Sign in",
  eyebrow = "Account",
  description = "Choose a sign-in provider to continue into your research workspace.",
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
  } = useAuth();
  const [busy, setBusy] = useState(false);
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
          ? "Sign-in timed out while contacting Supabase. Please retry. If this keeps happening, the Supabase auth service or redirect configuration needs attention."
          : message
      );
      setBusy(false);
    }
  }

  if (!hydrated) {
    return (
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-[#1f1f1f] dark:bg-[#050505]">
        <p className="text-sm text-slate-500 dark:text-[#9b9b9b]">Loading sign-in...</p>
      </section>
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
        setNotice("Check your email if confirmation is required, or continue if your session opened.");
      } else {
        await signInWithPassword(email, password);
      }
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "Password authentication failed.");
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
      setError(resetError instanceof Error ? resetError.message : "Password reset failed.");
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-[#1f1f1f] dark:bg-[#050505]">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-[#050505] dark:text-[#d6d6d6]">
            <UserIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-500 dark:text-[#9b9b9b]">Signed in</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{displayName}</h2>
            <p className="mt-1 break-all text-sm text-slate-500 dark:text-[#9b9b9b]">{user.email}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-[#050505] dark:text-[#d4d4d4]">
            {isAdmin ? "Admin" : "Member"}
          </span>
        </div>

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
          className="mt-5 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d9d9d9] dark:hover:border-[#3a3a3a] dark:hover:text-white"
        >
          Sign out
        </button>

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-[#1f1f1f] dark:bg-[#050505]">
      <div className="mb-6">
        <p className="text-sm font-medium text-slate-500 dark:text-[#8f8f8f]">{eyebrow}</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#9b9b9b]">{description}</p>
      </div>

      <div className="grid gap-3">
        {OAUTH_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.provider}
              type="button"
              onClick={() => handleProviderSignIn(option.provider)}
              disabled={busy}
              className="inline-flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#ececec] dark:hover:border-[#3a3a3a] dark:hover:bg-[#0a0a0a]"
            >
              <span className="inline-flex items-center gap-3">
                <Icon className="h-4 w-4" />
                <span>{option.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="my-5 flex items-center gap-3 text-xs text-slate-400 dark:text-[#6f6f6f]">
        <span className="h-px flex-1 bg-slate-200 dark:bg-[#1f1f1f]" />
        <span>Password</span>
        <span className="h-px flex-1 bg-slate-200 dark:bg-[#1f1f1f]" />
      </div>

      <form className="space-y-3" onSubmit={handlePasswordSubmit}>
        {passwordMode === "signup" ? (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-[#a3a3a3]">
              Name
            </span>
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              maxLength={120}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white dark:placeholder:text-[#6f6f6f] dark:focus:border-[#3a3a3a]"
              placeholder="Your name"
            />
          </label>
        ) : null}

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-[#a3a3a3]">
            Email
          </span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white dark:placeholder:text-[#6f6f6f] dark:focus:border-[#3a3a3a]"
            placeholder="you@example.com"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-[#a3a3a3]">
            Password
          </span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={passwordMode === "signup" ? "new-password" : "current-password"}
            minLength={8}
            maxLength={256}
            required
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white dark:placeholder:text-[#6f6f6f] dark:focus:border-[#3a3a3a]"
            placeholder="At least 8 characters"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-[#e5e5e5]"
        >
          {passwordMode === "signup" ? "Create account" : "Sign in with password"}
        </button>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              setPasswordMode((mode) => (mode === "signin" ? "signup" : "signin"));
              setError(null);
              setNotice(null);
            }}
            className="font-medium text-slate-600 hover:text-slate-950 dark:text-[#cfcfcf] dark:hover:text-white"
          >
            {passwordMode === "signup" ? "Already have an account?" : "Create password account"}
          </button>
          <button
            type="button"
            onClick={handlePasswordReset}
            disabled={busy}
            className="font-medium text-slate-500 hover:text-slate-950 disabled:opacity-60 dark:text-[#9b9b9b] dark:hover:text-white"
          >
            Reset password
          </button>
        </div>
      </form>

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
          {notice}
        </div>
      ) : null}
    </section>
  );
}
