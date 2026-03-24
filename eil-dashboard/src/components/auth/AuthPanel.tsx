"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  EmailIcon,
  FacebookIcon,
  GoogleIcon,
  UserIcon,
} from "@/components/ui/Icons";

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

export default function AuthPanel() {
  const { hydrated, user, profile, isAdmin, signInWithProvider, signInWithPassword, signUpWithPassword, signOut } =
    useAuth();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const displayName = useMemo(() => {
    return profile?.full_name || user?.user_metadata?.full_name || user?.email || "Signed in";
  }, [profile?.full_name, user?.email, user?.user_metadata]);

  async function handleProviderSignIn(provider: (typeof OAUTH_OPTIONS)[number]["provider"]) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      await signInWithProvider(provider);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  async function handleEmailAuth() {
    if (!email.trim() || !password.trim()) {
      setError("Enter an email and password first.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === "sign-up") {
        await signUpWithPassword(email.trim(), password, {
          full_name: fullName.trim() || undefined,
        });
        setMessage("Account created. Check your email if Supabase email confirmation is enabled.");
      } else {
        await signInWithPassword(email.trim(), password);
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
        <p className="text-sm text-slate-500 dark:text-[#8f8f8f]">Loading sign-in...</p>
      </section>
    );
  }

  if (user) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-[#252525] dark:text-[#b8b8b8]">
            <UserIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-500 dark:text-[#8f8f8f]">
              Signed in
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-[#ececec]">
              {displayName}
            </h2>
            <p className="mt-1 break-all text-sm text-slate-500 dark:text-[#8f8f8f]">
              {user.email}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-[#252525] dark:text-[#b8b8b8]">
            {isAdmin ? "Admin" : "Member"}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-[#252525] dark:text-[#b8b8b8]">
            Session remembered
          </span>
        </div>

        <p className="mt-4 text-sm leading-6 text-slate-500 dark:text-[#8f8f8f]">
          Your workspace profile and session now persist through Supabase instead of staying only in this browser.
        </p>

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
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#353535] dark:bg-[#1f1f1f] dark:text-[#d0d0d0] dark:hover:border-[#444444] dark:hover:text-[#ececec]"
        >
          Sign out
        </button>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-[#252525] dark:text-[#b8b8b8]">
          <EmailIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-[#8f8f8f]">
            Account
          </p>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-[#ececec]">
            Sign in to keep your workspace
          </h2>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {OAUTH_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.provider}
              type="button"
              onClick={() => handleProviderSignIn(option.provider)}
              disabled={busy}
              className="inline-flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#353535] dark:bg-[#1f1f1f] dark:text-[#d0d0d0] dark:hover:border-[#444444] dark:hover:bg-[#232323]"
            >
              <span className="inline-flex items-center gap-3">
                <Icon className="h-4 w-4" />
                <span>{option.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
        <span className="h-px flex-1 bg-slate-200 dark:bg-[#2c2c2c]" />
        <span>Email</span>
        <span className="h-px flex-1 bg-slate-200 dark:bg-[#2c2c2c]" />
      </div>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setMode("sign-in")}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${
            mode === "sign-in"
              ? "bg-slate-900 text-white dark:bg-[#ececec] dark:text-[#171717]"
              : "bg-slate-100 text-slate-600 dark:bg-[#252525] dark:text-[#b8b8b8]"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("sign-up")}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${
            mode === "sign-up"
              ? "bg-slate-900 text-white dark:bg-[#ececec] dark:text-[#171717]"
              : "bg-slate-100 text-slate-600 dark:bg-[#252525] dark:text-[#b8b8b8]"
          }`}
        >
          Register
        </button>
      </div>

      <div className="space-y-3">
        {mode === "sign-up" && (
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Full name"
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#1f1f1f] dark:text-[#ececec] dark:focus:border-[#5a5a5a] dark:focus:ring-white/5"
          />
        )}

        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email address"
          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#1f1f1f] dark:text-[#ececec] dark:focus:border-[#5a5a5a] dark:focus:ring-white/5"
        />

        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#1f1f1f] dark:text-[#ececec] dark:focus:border-[#5a5a5a] dark:focus:ring-white/5"
        />

        <button
          type="button"
          onClick={handleEmailAuth}
          disabled={busy}
          className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#ececec] dark:text-[#171717] dark:hover:bg-white"
        >
          {mode === "sign-up" ? "Create account" : "Sign in with email"}
        </button>
      </div>

      {message && (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}
    </section>
  );
}
