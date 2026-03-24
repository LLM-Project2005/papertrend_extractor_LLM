"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { EmailIcon, SettingsIcon, UserIcon } from "@/components/ui/Icons";

export default function WorkspaceProfileClient() {
  const { hydrated, user, profile, isAdmin, saveUserProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-5xl">
        <section className="app-surface px-6 py-8">
          <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
            Loading account profile...
          </p>
        </section>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-5xl">
        <section className="app-surface px-6 py-8">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-[#f2f2f2]">
            Sign in to view your profile
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 dark:text-[#a3a3a3]">
            Your profile page shows the account tied to this workspace and lets you
            update the name and avatar shown around the product.
          </p>
        </section>
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage(null);

    try {
      await saveUserProfile({
        full_name: fullName.trim(),
        avatar_url: avatarUrl.trim(),
      });
      setStatus("saved");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to save the profile."
      );
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="app-surface px-6 py-6">
        <p className="text-sm font-medium text-slate-500 dark:text-[#a3a3a3]">
          Account
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-[#f2f2f2]">
          Profile
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 dark:text-[#a3a3a3]">
          Manage the profile details shown in the workspace header and keep your
          signed-in account information current.
        </p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
        <form onSubmit={handleSubmit} className="app-surface p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-[#232323] dark:text-[#d0d0d0]">
              <UserIcon className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f2f2f2]">
                Profile details
              </h2>
              <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                These values are stored in Supabase and reused across the workspace.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-[#d0d0d0]">
                Display name
              </span>
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Your name"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300 dark:border-[#353535] dark:bg-[#171717] dark:text-[#f2f2f2] dark:placeholder:text-[#727272] dark:focus:border-[#4a4a4a]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-[#d0d0d0]">
                Avatar URL
              </span>
              <input
                value={avatarUrl}
                onChange={(event) => setAvatarUrl(event.target.value)}
                placeholder="https://..."
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300 dark:border-[#353535] dark:bg-[#171717] dark:text-[#f2f2f2] dark:placeholder:text-[#727272] dark:focus:border-[#4a4a4a]"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={status === "saving"}
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-[#f3f3f3] dark:text-[#171717] dark:hover:bg-white"
            >
              {status === "saving" ? "Saving..." : "Save profile"}
            </button>
            <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
              {status === "saved"
                ? "Saved."
                : status === "error"
                  ? errorMessage ?? "Unable to save."
                  : "Changes update your account profile."}
            </p>
          </div>
        </form>

        <div className="space-y-6">
          <article className="app-surface p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f2f2f2]">
              Account summary
            </h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <EmailIcon className="mt-0.5 h-4 w-4 flex-none text-slate-400 dark:text-[#7d7d7d]" />
                <div>
                  <dt className="text-slate-500 dark:text-[#a3a3a3]">Email</dt>
                  <dd className="mt-1 font-medium text-slate-900 dark:text-[#f2f2f2]">
                    {profile?.email ?? user.email}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <UserIcon className="mt-0.5 h-4 w-4 flex-none text-slate-400 dark:text-[#7d7d7d]" />
                <div>
                  <dt className="text-slate-500 dark:text-[#a3a3a3]">Role</dt>
                  <dd className="mt-1 font-medium text-slate-900 dark:text-[#f2f2f2]">
                    {isAdmin ? "Admin" : "Member"}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <SettingsIcon className="mt-0.5 h-4 w-4 flex-none text-slate-400 dark:text-[#7d7d7d]" />
                <div>
                  <dt className="text-slate-500 dark:text-[#a3a3a3]">Auth provider</dt>
                  <dd className="mt-1 font-medium capitalize text-slate-900 dark:text-[#f2f2f2]">
                    {user.app_metadata?.provider ?? "email"}
                  </dd>
                </div>
              </div>
            </dl>
          </article>

          <article className="app-surface p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f2f2f2]">
              What is already ready
            </h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600 dark:text-[#a3a3a3]">
              <li>Google sign-in and the workspace session now work together.</li>
              <li>Profile data is stored in Supabase and reused in the UI.</li>
              <li>Analyze can upload files and create queued ingestion runs.</li>
            </ul>
          </article>
        </div>
      </section>
    </div>
  );
}
