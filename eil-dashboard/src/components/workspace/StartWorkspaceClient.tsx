"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import {
  WORKSPACE_GOALS,
  WORKSPACE_OUTPUTS,
  WORKSPACE_SOURCES,
} from "@/lib/workspace-profile";
import type {
  WorkspaceGoal,
  WorkspaceOutput,
  WorkspaceSource,
} from "@/types/workspace";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CircleIcon,
  HomeIcon,
  UploadIcon,
} from "@/components/ui/Icons";

function SectionHeader({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
        {step}
      </p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-[#ececec]">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#8f8f8f]">{description}</p>
    </div>
  );
}

export default function StartWorkspaceClient() {
  const router = useRouter();
  const { profile, hydrated, updateProfile } = useWorkspaceProfile();
  const [name, setName] = useState(profile.name);
  const [organization, setOrganization] = useState(profile.organization);
  const [domain, setDomain] = useState(profile.domain);
  const [goal, setGoal] = useState<WorkspaceGoal>(profile.goal);
  const [primarySource, setPrimarySource] = useState<WorkspaceSource>(
    profile.primarySource
  );
  const [desiredOutputs, setDesiredOutputs] = useState<WorkspaceOutput[]>(
    profile.desiredOutputs
  );

  const activeGoal = useMemo(
    () => WORKSPACE_GOALS.find((item) => item.id === goal),
    [goal]
  );
  const activeSource = useMemo(
    () => WORKSPACE_SOURCES.find((source) => source.id === primarySource),
    [primarySource]
  );

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    setName(profile.name);
    setOrganization(profile.organization);
    setDomain(profile.domain);
    setGoal(profile.goal);
    setPrimarySource(profile.primarySource);
    setDesiredOutputs(profile.desiredOutputs);
  }, [hydrated, profile]);

  function toggleOutput(output: WorkspaceOutput) {
    setDesiredOutputs((current) =>
      current.includes(output)
        ? current.filter((item) => item !== output)
        : [...current, output]
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    updateProfile({
      name: name.trim() || profile.name,
      organization: organization.trim() || profile.organization,
      domain: domain.trim() || profile.domain,
      goal,
      primarySource,
      desiredOutputs:
        desiredOutputs.length > 0 ? desiredOutputs : profile.desiredOutputs,
      onboardingComplete: true,
    });

    router.push("/workspace/home");
  }

  const checklist = [
    {
      title: "Workspace profile",
      detail: "Set the name, organization, and domain.",
      done: Boolean(name.trim() && organization.trim() && domain.trim()),
    },
    {
      title: "First intake path",
      detail: "Choose where the first documents will come from.",
      done: Boolean(activeSource),
    },
    {
      title: "Primary outputs",
      detail: "Decide whether analytics, chat, or the paper library lead the experience.",
      done: desiredOutputs.length > 0,
    },
  ];

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_340px]">
      <section className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
          <SectionHeader
            step="Step 1"
            title="Workspace basics"
            description="Set the identity of the workspace before anyone starts exploring the corpus."
          />

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-[#d0d0d0]">
                Workspace name
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#232323] dark:text-[#ececec] dark:focus:border-[#5a5a5a] dark:focus:ring-white/5"
                placeholder="Faculty research workspace"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-[#d0d0d0]">
                Team or organization
              </span>
              <input
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#232323] dark:text-[#ececec] dark:focus:border-[#5a5a5a] dark:focus:ring-white/5"
                placeholder="Department, lab, or faculty"
              />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-[#d0d0d0]">
              Research domain
            </span>
            <input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#232323] dark:text-[#ececec] dark:focus:border-[#5a5a5a] dark:focus:ring-white/5"
              placeholder="Education, engineering, health sciences, policy, ..."
            />
          </label>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
          <SectionHeader
            step="Step 2"
            title="Primary objective"
            description="Choose what the workspace should help the team do first."
          />

          <div className="space-y-3">
            {WORKSPACE_GOALS.map((item) => {
              const isActive = goal === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setGoal(item.id)}
                  className={`w-full rounded-xl border px-4 py-4 text-left transition-colors ${
                    isActive
                      ? "border-slate-900 bg-slate-900 text-white dark:border-[#ececec] dark:bg-[#ececec] dark:text-[#171717]"
                      : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 dark:border-[#303030] dark:bg-[#1d1d1d] dark:text-[#ececec] dark:hover:border-[#444444]"
                  }`}
                >
                  <p className="text-sm font-medium">{item.label}</p>
                  <p
                    className={`mt-2 text-sm leading-6 ${
                      isActive ? "text-slate-200 dark:text-[#444444]" : "text-slate-500 dark:text-[#8f8f8f]"
                    }`}
                  >
                    {item.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
          <SectionHeader
            step="Step 3"
            title="First intake path"
            description="Pick the source path that should be emphasized first in the workspace."
          />

          <div className="space-y-3">
            {WORKSPACE_SOURCES.map((item) => {
              const isActive = primarySource === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPrimarySource(item.id)}
                  className={`w-full rounded-xl border px-4 py-4 text-left transition-colors ${
                    isActive
                      ? "border-slate-900 bg-slate-50 dark:border-[#4d4d4d] dark:bg-[#232323]"
                      : "border-slate-200 bg-white hover:border-slate-300 dark:border-[#303030] dark:bg-[#1d1d1d] dark:hover:border-[#444444]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-900 dark:text-[#ececec]">{item.label}</p>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] ${
                        item.status === "ready"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-[#193126] dark:text-[#7ed9a8]"
                          : "bg-slate-100 text-slate-500 dark:bg-[#252525] dark:text-[#8f8f8f]"
                      }`}
                    >
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
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
          <SectionHeader
            step="Step 4"
            title="Prioritized outputs"
            description="Select the modules that should matter most in the first version."
          />

          <div className="grid gap-3 md:grid-cols-2">
            {WORKSPACE_OUTPUTS.map((item) => {
              const isActive = desiredOutputs.includes(item.id);

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleOutput(item.id)}
                  className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                    isActive
                      ? "border-slate-900 bg-slate-50 dark:border-[#4d4d4d] dark:bg-[#232323]"
                      : "border-slate-200 bg-white hover:border-slate-300 dark:border-[#303030] dark:bg-[#1d1d1d] dark:hover:border-[#444444]"
                  }`}
                >
                  <p className="text-sm font-medium text-slate-900 dark:text-[#ececec]">{item.label}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#8f8f8f]">
                    {item.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <aside className="space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
          <p className="text-sm font-medium text-slate-500 dark:text-[#8f8f8f]">Current summary</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 dark:text-[#ececec]">
            {name || profile.name}
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
            {organization || profile.organization}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">{domain || profile.domain}</p>

          <dl className="mt-6 space-y-4 text-sm">
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500 dark:text-[#8f8f8f]">Goal</dt>
              <dd className="text-right font-medium text-slate-900 dark:text-[#ececec]">
                {activeGoal?.label}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500 dark:text-[#8f8f8f]">Primary source</dt>
              <dd className="text-right font-medium text-slate-900 dark:text-[#ececec]">
                {activeSource?.label}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
          <h3 className="text-base font-semibold text-slate-900 dark:text-[#ececec]">Readiness</h3>
          <div className="mt-4 space-y-4">
            {checklist.map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center">
                  {item.done ? (
                    <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <CircleIcon className="h-5 w-5 text-slate-300 dark:text-[#4c4c4c]" />
                  )}
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-[#ececec]">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-[#8f8f8f]">
                    {item.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-[#252525] dark:text-[#b8b8b8]">
              <HomeIcon className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-[#ececec]">What happens next</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#8f8f8f]">
                After this setup, users land in a workspace home first, then move
                into dashboard, chat, papers, or imports from a calmer product shell.
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-[#252525] dark:text-[#b8b8b8]">
              <UploadIcon className="h-4 w-4" />
            </span>
            <p className="text-sm leading-6 text-slate-500 dark:text-[#8f8f8f]">
              PDF upload and notebook sync remain the real intake paths today.
            </p>
          </div>

          <button
            type="submit"
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-[#ececec] dark:text-[#171717] dark:hover:bg-white"
          >
            <span>Enter workspace</span>
            <ArrowRightIcon className="h-4 w-4" />
          </button>
        </section>
      </aside>
    </form>
  );
}
