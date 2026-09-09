"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import AnalysisProfileEditor from "@/components/workspace/AnalysisProfileEditor";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import {
  WORKSPACE_GOALS,
  WORKSPACE_OUTPUTS,
  WORKSPACE_SOURCES,
} from "@/lib/workspace-profile";
import { createGeneralAnalysisProfile, sanitizeProjectAnalysisProfile } from "@/lib/project-analysis-profile";
import type { ProjectAnalysisProfile, WorkspaceOutput } from "@/types/workspace";

const SETTINGS_SECTIONS = [
  {
    id: "analysis",
    label: "Analysis & classification",
    description: "Choose how this repository classifies new and existing papers.",
  },
  {
    id: "general",
    label: "General",
    description: "Workspace display preferences and saved account state.",
  },
  {
    id: "project",
    label: "Repository",
    description: "Goal, intake source, and output defaults.",
  },
  {
    id: "access",
    label: "Access",
    description: "Account and synced repository state.",
  },
] as const;

const PROJECT_ANALYSIS_PROFILES_ENABLED =
  process.env.NEXT_PUBLIC_PROJECT_ANALYSIS_PROFILES_ENABLED === "true";
const VISIBLE_SETTINGS_SECTIONS = PROJECT_ANALYSIS_PROFILES_ENABLED
  ? SETTINGS_SECTIONS
  : SETTINGS_SECTIONS.filter((section) => section.id !== "analysis");

type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export default function WorkspaceSettingsClient() {
  const searchParams = useSearchParams();
  const {
    profile,
    updateProfile,
    resetProfile,
    currentProject,
    allProjects,
    updateProjectAnalysisProfile,
  } = useWorkspaceProfile();
  const { user, session, profile: authProfile, isAdmin } = useAuth();
  const [activeSection, setActiveSection] = useState<SectionId>("general");
  const [message, setMessage] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProjectAnalysisProfile>(createGeneralAnalysisProfile);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [classificationCoverage, setClassificationCoverage] = useState({ classified: 0, previousProfile: 0, unclassified: 0, failed: 0 });
  const [coverageRevision, setCoverageRevision] = useState(0);
  const [reclassificationJob, setReclassificationJob] = useState<{ id: string; status: string; total_items: number; processed_items: number; failed_items: number; error_message?: string | null } | null>(null);
  const [reclassificationBusy, setReclassificationBusy] = useState(false);
  const currentProjectId = currentProject?.id ?? null;
  const reclassificationJobId = reclassificationJob?.id ?? null;
  const reclassificationJobStatus = reclassificationJob?.status ?? null;

  const savedProjectProfile = useMemo(
    () => currentProject?.analysis_profile ?? createGeneralAnalysisProfile(),
    [currentProject]
  );
  const profileDirty = JSON.stringify(profileDraft) !== JSON.stringify(savedProjectProfile);

  useEffect(() => {
    const requested = searchParams.get("section");
    if (VISIBLE_SETTINGS_SECTIONS.some((section) => section.id === requested)) {
      setActiveSection(requested as SectionId);
    }
  }, [searchParams]);

  useEffect(() => {
    setProfileDraft(savedProjectProfile);
    setProfileError(null);
  }, [savedProjectProfile]);

  useEffect(() => {
    if (!PROJECT_ANALYSIS_PROFILES_ENABLED || !currentProjectId || !session?.access_token) return;
    fetch(`/api/workspace/projects/${encodeURIComponent(currentProjectId)}/analysis-profile`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).then(async (response) => {
      const payload = await response.json() as { coverage?: typeof classificationCoverage };
      if (response.ok && payload.coverage) setClassificationCoverage(payload.coverage);
    }).catch(() => undefined);
  }, [coverageRevision, currentProjectId, session?.access_token]);

  useEffect(() => {
    if (!profileDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const warnLinkNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (target && !window.confirm("Discard unsaved analysis profile changes?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", warnLinkNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", warnLinkNavigation, true);
    };
  }, [profileDirty]);

  function setSavedMessage(nextMessage = "Repository preferences updated.") {
    setMessage(nextMessage);
  }

  function toggleOutput(output: WorkspaceOutput) {
    const outputs = profile.desiredOutputs.includes(output)
      ? profile.desiredOutputs.filter((item) => item !== output)
      : [...profile.desiredOutputs, output];

    updateProfile({ desiredOutputs: outputs });
    setSavedMessage();
  }

  async function saveAnalysisProfile() {
    if (!currentProject) return;
    setSavingProfile(true);
    setProfileError(null);
    try {
      const normalized = sanitizeProjectAnalysisProfile(profileDraft);
      await updateProjectAnalysisProfile(currentProject.id, normalized);
      setProfileDraft(normalized);
      setCoverageRevision((revision) => revision + 1);
      setMessage("Analysis profile saved. New uploads will use it immediately.");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Could not save the analysis profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function startReclassification() {
    if (!currentProject || !session?.access_token || profileDirty) return;
    setReclassificationBusy(true);
    setProfileError(null);
    try {
      const response = await fetch(`/api/workspace/projects/${encodeURIComponent(currentProject.id)}/reclassify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json() as { jobId?: string; error?: string };
      if (!response.ok || !payload.jobId) throw new Error(payload.error ?? "Could not start reclassification.");
      setReclassificationJob({ id: payload.jobId, status: "queued", total_items: 0, processed_items: 0, failed_items: 0 });
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Could not start reclassification.");
    } finally {
      setReclassificationBusy(false);
    }
  }

  async function updateReclassification(action: "cancel" | "retry") {
    if (!currentProject || !session?.access_token || !reclassificationJob) return;
    setReclassificationBusy(true);
    setProfileError(null);
    try {
      const response = await fetch(`/api/workspace/projects/${encodeURIComponent(currentProject.id)}/reclassify/${encodeURIComponent(reclassificationJob.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json() as { job?: typeof reclassificationJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error ?? `Could not ${action} reclassification.`);
      setReclassificationJob(payload.job);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : `Could not ${action} reclassification.`);
    } finally {
      setReclassificationBusy(false);
    }
  }

  useEffect(() => {
    if (!currentProjectId || !session?.access_token || !reclassificationJobId || !reclassificationJobStatus || !["queued", "processing"].includes(reclassificationJobStatus)) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/workspace/projects/${encodeURIComponent(currentProjectId)}/reclassify/${encodeURIComponent(reclassificationJobId)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const payload = await response.json() as { job?: typeof reclassificationJob };
        if (response.ok && payload.job) {
          setReclassificationJob(payload.job);
          if (payload.job.status === "succeeded") setClassificationCoverage((current) => ({ ...current, classified: payload.job!.total_items, previousProfile: 0, unclassified: 0 }));
        }
      } catch {
        // A transient refresh failure should not change or cancel the server job.
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [currentProjectId, reclassificationJobId, reclassificationJobStatus, session?.access_token]);

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505]">
        <div className="border-b border-slate-200 px-5 py-5 dark:border-[#1f1f1f]">
          <h1 className="text-2xl font-semibold text-slate-950 dark:text-[#ececec]">
            Settings
          </h1>
        </div>

        <div className="space-y-6 px-4 py-5">
          <div>
            <p className="px-2 text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#7d7d7d]">
              Configuration
            </p>
            <nav className="mt-3 space-y-1">
              {VISIBLE_SETTINGS_SECTIONS.map((section) => {
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-slate-100 font-medium text-slate-950 dark:bg-[#050505] dark:text-[#f2f2f2]"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-[#b8b8b8] dark:hover:bg-[#0a0a0a] dark:hover:text-[#ececec]"
                    }`}
                  >
                    {section.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="border-t border-slate-200 pt-5 dark:border-[#1f1f1f]">
            <p className="px-2 text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#7d7d7d]">
              Account
            </p>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
              <p className="text-sm font-medium text-slate-950 dark:text-[#ececec]">
                {authProfile?.full_name || user?.email || "Guest session"}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
                {user?.email ?? "No account connected"}
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-[#8f8f8f]">
                <span className="rounded-full border border-slate-200 px-2 py-1 dark:border-[#1f1f1f]">
                  {isAdmin ? "Admin" : "Member"}
                </span>
                <span className="rounded-full border border-slate-200 px-2 py-1 dark:border-[#1f1f1f]">
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
              VISIBLE_SETTINGS_SECTIONS.find((section) => section.id === activeSection)
                ?.description
            }
          </p>
        </section>

        {PROJECT_ANALYSIS_PROFILES_ENABLED && activeSection === "analysis" ? (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-[#242424] dark:bg-[#050505]">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-[#242424]">
              <p className="text-xs font-semibold uppercase text-slate-400 dark:text-[#777]">{currentProject?.name ?? "Repository"}</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">Analysis & classification</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#999]">
                This profile is owned by this repository. Changing it affects new uploads; existing papers keep their previous result until you reclassify them.
              </p>
            </div>
            <div className="px-6 py-6">
              <AnalysisProfileEditor
                value={profileDraft}
                onChange={(next) => {
                  setProfileDraft(next);
                  setProfileError(null);
                }}
                templates={allProjects
                  .filter((project) => project.id !== currentProject?.id && project.analysis_profile)
                  .map((project) => ({ projectId: project.id, projectName: project.name, profile: project.analysis_profile! }))}
                error={profileError}
              />
              <div className="mt-6 border-t border-slate-200 pt-5 dark:border-[#242424]">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Current-profile coverage</p>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-[#999]">
                      <span>{classificationCoverage.classified} classified</span>
                      <span>{classificationCoverage.previousProfile} previous profile</span>
                      <span>{classificationCoverage.unclassified} unclassified</span>
                      <span>{classificationCoverage.failed} failed analyses</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={profileDirty || savingProfile || reclassificationBusy || classificationCoverage.previousProfile + classificationCoverage.unclassified === 0 || Boolean(reclassificationJob && ["queued", "processing"].includes(reclassificationJob.status))}
                    onClick={() => void startReclassification()}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#333] dark:text-[#ddd] dark:hover:bg-[#0a0a0a]"
                  >
                    {reclassificationBusy ? "Starting..." : reclassificationJob && ["queued", "processing"].includes(reclassificationJob.status) ? "Reclassifying..." : "Reclassify existing papers"}
                  </button>
                </div>
                {reclassificationJob ? (
                  <div className="mt-4" role="status">
                    <div className="flex justify-between text-xs text-slate-500 dark:text-[#999]">
                      <span>{reclassificationJob.status === "succeeded" ? "Published" : reclassificationJob.status === "failed" ? "Previous classification preserved" : reclassificationJob.status === "canceled" ? "Canceled; previous classification preserved" : "Classifying extracted papers"}</span>
                      <span>{reclassificationJob.processed_items}/{reclassificationJob.total_items || "..."}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#181818]">
                      <div className="h-full bg-slate-900 transition-[width] duration-300 dark:bg-white" style={{ width: `${reclassificationJob.total_items ? Math.round((reclassificationJob.processed_items / reclassificationJob.total_items) * 100) : 2}%` }} />
                    </div>
                    {reclassificationJob.error_message ? <p className="mt-2 text-xs text-red-600 dark:text-red-300">{reclassificationJob.error_message}</p> : null}
                    <div className="mt-3 flex justify-end">
                      {["queued", "processing"].includes(reclassificationJob.status) ? (
                        <button type="button" disabled={reclassificationBusy} onClick={() => void updateReclassification("cancel")} className="text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40 dark:text-[#999] dark:hover:text-white">Cancel reclassification</button>
                      ) : reclassificationJob.status === "failed" ? (
                        <button type="button" disabled={reclassificationBusy} onClick={() => void updateReclassification("retry")} className="text-xs font-medium text-slate-700 hover:text-slate-950 disabled:opacity-40 dark:text-[#ccc] dark:hover:text-white">Retry failed papers</button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 dark:border-[#242424]">
              <p className="text-xs text-slate-500 dark:text-[#999]">
                {profileDirty ? "Unsaved changes" : `Profile ${savedProjectProfile.version} - ${savedProjectProfile.displayName}`}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!profileDirty || savingProfile}
                  onClick={() => {
                    setProfileDraft(savedProjectProfile);
                    setProfileError(null);
                  }}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40 dark:border-[#333] dark:text-[#ddd]"
                >
                  Discard
                </button>
                <button
                  type="button"
                  disabled={!profileDirty || savingProfile || !currentProject}
                  onClick={() => void saveAnalysisProfile()}
                  className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-black"
                >
                  {savingProfile ? "Saving..." : "Save profile"}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {activeSection === "general" ? (
          <>
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505]">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-[#1f1f1f]">
                <h2 className="text-3xl font-semibold tracking-normal text-slate-950 dark:text-[#ececec]">
                  Repository settings
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
                  General configuration, naming, and repository framing.
                </p>
              </div>

              <div className="divide-y divide-slate-200 dark:divide-[#2c2c2c]">
                <label className="grid gap-3 px-6 py-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                  <div>
                    <p className="text-sm font-medium text-slate-950 dark:text-[#ececec]">
                      Workspace display name
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
                      Used in account-level navigation. Classification rules live in Analysis & classification.
                    </p>
                  </div>
                  <input
                    value={profile.name}
                    onChange={(event) => {
                      updateProfile({ name: event.target.value });
                      setSavedMessage();
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#ececec] dark:focus:border-[#5a5a5a]"
                  />
                </label>

              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505]">
              <div className="flex items-center justify-between gap-4 px-6 py-5">
                <div>
                  <h3 className="text-xl font-semibold text-slate-950 dark:text-[#ececec]">
                    Repository state
                  </h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
                    Changes persist locally for guests and sync to the signed-in account database.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    resetProfile();
                    setSavedMessage("Repository preferences reset to defaults.");
                  }}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-[#1f1f1f] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:bg-[#0a0a0a]"
                >
                  Reset repository
                </button>
              </div>
            </section>
          </>
        ) : null}

        {activeSection === "project" ? (
          <>
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505]">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-[#1f1f1f]">
                <h2 className="text-2xl font-semibold text-slate-950 dark:text-[#ececec]">
                  Repository focus
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
                  Set the default analysis mode this repository should optimize for.
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
                      className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                        isActive
                          ? "border-slate-400 bg-slate-50 dark:border-[#1f1f1f] dark:bg-[#050505]"
                          : "border-slate-200 bg-white hover:border-slate-300 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:border-[#3a3a3a]"
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

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505]">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-[#1f1f1f]">
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
                      className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                        isActive
                          ? "border-slate-400 bg-slate-50 dark:border-[#1f1f1f] dark:bg-[#050505]"
                          : "border-slate-200 bg-white hover:border-slate-300 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:border-[#3a3a3a]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-950 dark:text-[#ececec]">
                          {item.label}
                        </p>
                        <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium uppercase tracking-normal text-slate-500 dark:border-[#1f1f1f] dark:text-[#8f8f8f]">
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

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505]">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-[#1f1f1f]">
                <h2 className="text-2xl font-semibold text-slate-950 dark:text-[#ececec]">
                  Output defaults
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
                  Highlight the experiences this repository should prioritize.
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
                      className={`rounded-xl border p-4 text-left transition-colors ${
                        isActive
                          ? "border-slate-400 bg-slate-50 dark:border-[#1f1f1f] dark:bg-[#050505]"
                          : "border-slate-200 bg-white hover:border-slate-300 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:border-[#3a3a3a]"
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
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505]">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-[#1f1f1f]">
                <h2 className="text-2xl font-semibold text-slate-950 dark:text-[#ececec]">
                  Repository access
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
                  Who this repository belongs to and how the profile is being remembered.
                </p>
              </div>

              <div className="divide-y divide-slate-200 dark:divide-[#2c2c2c]">
                <div className="grid gap-3 px-6 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
                  <div>
                    <p className="text-sm font-medium text-slate-950 dark:text-[#ececec]">
                      Session owner
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
                      Active account linked to this repository.
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
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
                    <span className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600 dark:border-[#1f1f1f] dark:text-[#c9c9c9]">
                      {user ? "Supabase sync enabled" : "Local browser storage"}
                    </span>
                    <span className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600 dark:border-[#1f1f1f] dark:text-[#c9c9c9]">
                      {isAdmin ? "Admin privileges" : "Standard access"}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {message ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
            {message}
          </div>
        ) : null}
      </div>
    </div>
  );
}
