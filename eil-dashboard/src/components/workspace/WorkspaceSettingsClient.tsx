"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import {
  WORKSPACE_GOALS,
  WORKSPACE_OUTPUTS,
  WORKSPACE_SOURCES,
} from "@/lib/workspace-profile";
import type { WorkspaceOutput } from "@/types/workspace";

const SETTINGS_SECTIONS = [
  {
    id: "general",
    label: "General",
    description: "Workspace name, domain, and identity.",
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Goal, intake source, and output defaults.",
  },
  {
    id: "access",
    label: "Access",
    description: "Account and synced workspace state.",
  },
] as const;

type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export default function WorkspaceSettingsClient() {
  const { profile, updateProfile, resetProfile } = useWorkspaceProfile();
  const { user, profile: authProfile, isAdmin } = useAuth();
  const [activeSection, setActiveSection] = useState<SectionId>("general");
  const [message, setMessage] = useState<string | null>(null);

  function setSavedMessage(nextMessage = "Workspace preferences updated.") {
    setMessage(nextMessage);
  }

  function toggleOutput(output: WorkspaceOutput) {
    const outputs = profile.desiredOutputs.includes(output)
      ? profile.desiredOutputs.filter((item) => item !== output)
      : [...profile.desiredOutputs, output];

    updateProfile({ desiredOutputs: outputs });
    setSavedMessage();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-[24px] border border-slate-200 bg-white dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
        <div className="border-b border-slate-200 px-5 py-5 dark:border-[#2c2c2c]">
          <h1 className="text-2xl font-semibold text-slate-950 dark:text-[#ececec]">
            Settings
          </h1>
        </div>

        <div className="space-y-6 px-4 py-5">
          <div>
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#7d7d7d]">
              Configuration
            </p>
            <nav className="mt-3 space-y-1">
              {SETTINGS_SECTIONS.map((section) => {
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-slate-100 font-medium text-slate-950 dark:bg-[#2b2b2b] dark:text-[#f2f2f2]"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-[#b8b8b8] dark:hover:bg-[#232323] dark:hover:text-[#ececec]"
                    }`}
                  >
                    {section.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="border-t border-slate-200 pt-5 dark:border-[#2c2c2c]">
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#7d7d7d]">
              Account
            </p>
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2c2c2c] dark:bg-[#202020]">
              <p className="text-sm font-medium text-slate-950 dark:text-[#ececec]">
                {authProfile?.full_name || user?.email || "Guest session"}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
                {user?.email ?? "No account connected"}
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-[#8f8f8f]">
                <span className="rounded-full border border-slate-200 px-2 py-1 dark:border-[#353535]">
                  {isAdmin ? "Admin" : "Member"}
                </span>
                <span className="rounded-full border border-slate-200 px-2 py-1 dark:border-[#353535]">
                  {user ? "Synced" : "Local"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="space-y-8">
        <section>
          <p className="text-sm text-slate-500 dark:text-[#8f8f8f]">
            {
              SETTINGS_SECTIONS.find((section) => section.id === activeSection)
                ?.description
            }
          </p>
        </section>

        {activeSection === "general" ? (
          <>
            <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-[#2c2c2c]">
                <h2 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-[#ececec]">
                  Project settings
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
                  General configuration, naming, and workspace framing.
                </p>
              </div>

              <div className="divide-y divide-slate-200 dark:divide-[#2c2c2c]">
                <label className="grid gap-3 px-6 py-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                  <div>
                    <p className="text-sm font-medium text-slate-950 dark:text-[#ececec]">
                      Workspace name
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
                      Displayed across the workspace shell.
                    </p>
                  </div>
                  <input
                    value={profile.name}
                    onChange={(event) => {
                      updateProfile({ name: event.target.value });
                      setSavedMessage();
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 dark:border-[#353535] dark:bg-[#232323] dark:text-[#ececec] dark:focus:border-[#5a5a5a]"
                  />
                </label>

                <label className="grid gap-3 px-6 py-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                  <div>
                    <p className="text-sm font-medium text-slate-950 dark:text-[#ececec]">
                      Organization
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
                      Faculty, lab, department, or research team name.
                    </p>
                  </div>
                  <input
                    value={profile.organization}
                    onChange={(event) => {
                      updateProfile({ organization: event.target.value });
                      setSavedMessage();
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 dark:border-[#353535] dark:bg-[#232323] dark:text-[#ececec] dark:focus:border-[#5a5a5a]"
                  />
                </label>

                <label className="grid gap-3 px-6 py-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                  <div>
                    <p className="text-sm font-medium text-slate-950 dark:text-[#ececec]">
                      Research domain
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
                      Used in the landing, workspace, and chat framing.
                    </p>
                  </div>
                  <input
                    value={profile.domain}
                    onChange={(event) => {
                      updateProfile({ domain: event.target.value });
                      setSavedMessage();
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 dark:border-[#353535] dark:bg-[#232323] dark:text-[#ececec] dark:focus:border-[#5a5a5a]"
                  />
                </label>
              </div>
            </section>

            <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
              <div className="flex items-center justify-between gap-4 px-6 py-5">
                <div>
                  <h3 className="text-xl font-semibold text-slate-950 dark:text-[#ececec]">
                    Workspace state
                  </h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
                    Changes persist locally for guests and sync to Supabase for signed-in users.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    resetProfile();
                    setSavedMessage("Workspace preferences reset to defaults.");
                  }}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-[#353535] dark:text-[#d0d0d0] dark:hover:border-[#444444] dark:hover:bg-[#232323]"
                >
                  Reset workspace
                </button>
              </div>
            </section>
          </>
        ) : null}

        {activeSection === "workspace" ? (
          <>
            <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-[#2c2c2c]">
                <h2 className="text-2xl font-semibold text-slate-950 dark:text-[#ececec]">
                  Workspace focus
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
                  Set the default analysis mode this workspace should optimize for.
                </p>
              </div>
              <div className="grid gap-3 px-6 py-5">
                {WORKSPACE_GOALS.map((item) => {
                  const isActive = profile.goal === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        updateProfile({ goal: item.id });
                        setSavedMessage();
                      }}
                      className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
                        isActive
                          ? "border-slate-400 bg-slate-50 dark:border-[#4d4d4d] dark:bg-[#232323]"
                          : "border-slate-200 bg-white hover:border-slate-300 dark:border-[#303030] dark:bg-[#1d1d1d] dark:hover:border-[#3b3b3b]"
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-950 dark:text-[#ececec]">
                        {item.label}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#8f8f8f]">
                        {item.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-[#2c2c2c]">
                <h2 className="text-2xl font-semibold text-slate-950 dark:text-[#ececec]">
                  Intake defaults
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
                  Choose which source path should feel primary across imports and onboarding.
                </p>
              </div>
              <div className="grid gap-3 px-6 py-5">
                {WORKSPACE_SOURCES.map((item) => {
                  const isActive = profile.primarySource === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        updateProfile({ primarySource: item.id });
                        setSavedMessage();
                      }}
                      className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
                        isActive
                          ? "border-slate-400 bg-slate-50 dark:border-[#4d4d4d] dark:bg-[#232323]"
                          : "border-slate-200 bg-white hover:border-slate-300 dark:border-[#303030] dark:bg-[#1d1d1d] dark:hover:border-[#3b3b3b]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-950 dark:text-[#ececec]">
                          {item.label}
                        </p>
                        <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500 dark:border-[#353535] dark:text-[#8f8f8f]">
                          {item.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#8f8f8f]">
                        {item.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-[#2c2c2c]">
                <h2 className="text-2xl font-semibold text-slate-950 dark:text-[#ececec]">
                  Output defaults
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
                  Highlight the experiences this workspace should prioritize.
                </p>
              </div>
              <div className="grid gap-3 px-6 py-5 md:grid-cols-2">
                {WORKSPACE_OUTPUTS.map((item) => {
                  const isActive = profile.desiredOutputs.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleOutput(item.id)}
                      className={`rounded-2xl border p-4 text-left transition-colors ${
                        isActive
                          ? "border-slate-400 bg-slate-50 dark:border-[#4d4d4d] dark:bg-[#232323]"
                          : "border-slate-200 bg-white hover:border-slate-300 dark:border-[#303030] dark:bg-[#1d1d1d] dark:hover:border-[#3b3b3b]"
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-950 dark:text-[#ececec]">
                        {item.label}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#8f8f8f]">
                        {item.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}

        {activeSection === "access" ? (
          <>
            <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-[#2c2c2c]">
                <h2 className="text-2xl font-semibold text-slate-950 dark:text-[#ececec]">
                  Project access
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
                  Who this workspace belongs to and how the profile is being remembered.
                </p>
              </div>

              <div className="divide-y divide-slate-200 dark:divide-[#2c2c2c]">
                <div className="grid gap-3 px-6 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
                  <div>
                    <p className="text-sm font-medium text-slate-950 dark:text-[#ececec]">
                      Session owner
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
                      Active account linked to this workspace.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#303030] dark:bg-[#202020]">
                    <p className="text-sm font-medium text-slate-950 dark:text-[#ececec]">
                      {authProfile?.full_name || "Guest session"}
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
                      {user?.email ?? "No email connected"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 px-6 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
                  <div>
                    <p className="text-sm font-medium text-slate-950 dark:text-[#ececec]">
                      Sync mode
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
                      Profile memory persists locally and, when signed in, in Supabase.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600 dark:border-[#353535] dark:text-[#c9c9c9]">
                      {user ? "Supabase sync enabled" : "Local browser storage"}
                    </span>
                    <span className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600 dark:border-[#353535] dark:text-[#c9c9c9]">
                      {isAdmin ? "Admin privileges" : "Standard access"}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {message ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-[#214834] dark:bg-[#182920] dark:text-[#7ed9a8]">
            {message}
          </div>
        ) : null}
      </div>
    </div>
  );
}
