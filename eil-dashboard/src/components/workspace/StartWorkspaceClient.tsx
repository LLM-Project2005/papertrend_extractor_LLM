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

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <section className="space-y-6">
        <div className="rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
            Step 1
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-900">
            Shape your workspace
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
            This setup is intentionally lightweight. It configures how the
            workspace introduces itself, what sources you expect to use, and
            which outputs should be emphasized first.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">
                Workspace name
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-[#172029] focus:outline-none focus:ring-2 focus:ring-[#172029]/10"
                placeholder="Faculty research workspace"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">
                Team or organization
              </span>
              <input
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
                className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-[#172029] focus:outline-none focus:ring-2 focus:ring-[#172029]/10"
                placeholder="Department, lab, or faculty"
              />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-medium text-gray-700">
              Research domain
            </span>
            <input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-[#172029] focus:outline-none focus:ring-2 focus:ring-[#172029]/10"
              placeholder="Education, engineering, health sciences, policy, ..."
            />
          </label>
        </div>

        <div className="rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
            Step 2
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900">
            Pick the primary objective
          </h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {WORKSPACE_GOALS.map((item) => {
              const isActive = goal === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setGoal(item.id)}
                  className={`rounded-[24px] border p-4 text-left transition-colors ${
                    isActive
                      ? "border-[#172029] bg-[#172029] text-white"
                      : "border-gray-200 bg-[#faf8f4] text-gray-800 hover:border-[#bfa986]"
                  }`}
                >
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p
                    className={`mt-2 text-sm leading-6 ${
                      isActive ? "text-[#dfe8eb]" : "text-gray-600"
                    }`}
                  >
                    {item.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
            Step 3
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900">
            Choose the first intake path
          </h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {WORKSPACE_SOURCES.map((item) => {
              const isActive = primarySource === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPrimarySource(item.id)}
                  className={`rounded-[24px] border p-4 text-left transition-colors ${
                    isActive
                      ? "border-[#8f6d43] bg-[#f3e4c7]"
                      : "border-gray-200 bg-[#faf8f4] hover:border-[#d8c2a1]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-gray-900">
                      {item.label}
                    </p>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                        item.status === "ready"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    {item.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
            Step 4
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900">
            Prioritize outputs for the first version
          </h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {WORKSPACE_OUTPUTS.map((item) => {
              const isActive = desiredOutputs.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleOutput(item.id)}
                  className={`rounded-[24px] border p-4 text-left transition-colors ${
                    isActive
                      ? "border-[#172029] bg-[#edf3f5]"
                      : "border-gray-200 bg-[#faf8f4] hover:border-[#d8c2a1]"
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    {item.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <aside className="space-y-6">
        <section className="rounded-[32px] border border-[#dfd5c6] bg-[#172029] p-6 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#9bb0bc]">
            Preview
          </p>
          <h2 className="mt-3 text-2xl font-semibold">{name || profile.name}</h2>
          <p className="mt-2 text-sm leading-6 text-[#d8e2e6]">
            {organization || profile.organization}
          </p>
          <p className="mt-1 text-sm leading-6 text-[#9bb0bc]">
            {domain || profile.domain}
          </p>

          <div className="mt-6 rounded-[24px] border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9bb0bc]">
              First workflow
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              {WORKSPACE_GOALS.find((item) => item.id === goal)?.label}
            </p>
            <p className="mt-2 text-sm leading-6 text-[#d8e2e6]">
              {activeSource?.label} will be the first intake path.
            </p>
          </div>

          <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9bb0bc]">
              Outputs
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {desiredOutputs.map((output) => (
                <span
                  key={output}
                  className="rounded-full bg-[#f3dfba] px-3 py-1 text-xs font-semibold text-[#172029]"
                >
                  {WORKSPACE_OUTPUTS.find((item) => item.id === output)?.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">What happens next</h3>
          <div className="mt-4 space-y-4 text-sm leading-6 text-gray-600">
            <p>
              1. You land in a workspace home, not directly in a chart screen.
            </p>
            <p>
              2. The dashboard stays available as a core analytics module inside
              the workspace.
            </p>
            <p>
              3. Imports remain connected to the same Supabase-backed ingestion
              flow you already have.
            </p>
          </div>

          <button
            type="submit"
            className="mt-6 w-full rounded-full bg-[#172029] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#253644]"
          >
            Enter workspace
          </button>
        </section>
      </aside>
    </form>
  );
}
