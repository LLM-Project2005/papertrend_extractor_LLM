"use client";

import { useState } from "react";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import {
  WORKSPACE_GOALS,
  WORKSPACE_OUTPUTS,
  WORKSPACE_SOURCES,
} from "@/lib/workspace-profile";
import type { WorkspaceOutput } from "@/types/workspace";

export default function WorkspaceSettingsClient() {
  const { profile, updateProfile, resetProfile } = useWorkspaceProfile();
  const [message, setMessage] = useState<string | null>(null);

  function toggleOutput(output: WorkspaceOutput) {
    const outputs = profile.desiredOutputs.includes(output)
      ? profile.desiredOutputs.filter((item) => item !== output)
      : [...profile.desiredOutputs, output];

    updateProfile({ desiredOutputs: outputs });
    setMessage("Workspace preferences updated.");
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
          Workspace settings
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-900">
          Adjust how this workspace presents itself
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          These preferences are currently stored in the browser so you can shape
          the workspace experience before adding full multi-workspace persistence.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-700">
              Workspace name
            </span>
            <input
              value={profile.name}
              onChange={(event) => {
                updateProfile({ name: event.target.value });
                setMessage("Workspace preferences updated.");
              }}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-[#172029] focus:outline-none focus:ring-2 focus:ring-[#172029]/10"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-700">
              Organization
            </span>
            <input
              value={profile.organization}
              onChange={(event) => {
                updateProfile({ organization: event.target.value });
                setMessage("Workspace preferences updated.");
              }}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-[#172029] focus:outline-none focus:ring-2 focus:ring-[#172029]/10"
            />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-gray-700">
            Research domain
          </span>
          <input
            value={profile.domain}
            onChange={(event) => {
              updateProfile({ domain: event.target.value });
              setMessage("Workspace preferences updated.");
            }}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-[#172029] focus:outline-none focus:ring-2 focus:ring-[#172029]/10"
          />
        </label>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">Primary goal</h2>
          <div className="mt-4 space-y-3">
            {WORKSPACE_GOALS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  updateProfile({ goal: item.id });
                  setMessage("Workspace preferences updated.");
                }}
                className={`w-full rounded-[22px] border px-4 py-4 text-left transition-colors ${
                  profile.goal === item.id
                    ? "border-[#172029] bg-[#172029] text-white"
                    : "border-gray-200 bg-[#faf8f4] hover:border-[#d6b889]"
                }`}
              >
                <p className="text-sm font-semibold">{item.label}</p>
                <p
                  className={`mt-2 text-sm leading-6 ${
                    profile.goal === item.id ? "text-[#dce6ea]" : "text-gray-600"
                  }`}
                >
                  {item.description}
                </p>
              </button>
            ))}
          </div>
        </article>

        <article className="rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">Primary source</h2>
          <div className="mt-4 space-y-3">
            {WORKSPACE_SOURCES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  updateProfile({ primarySource: item.id });
                  setMessage("Workspace preferences updated.");
                }}
                className={`w-full rounded-[22px] border px-4 py-4 text-left transition-colors ${
                  profile.primarySource === item.id
                    ? "border-[#8f6d43] bg-[#f3e4c7]"
                    : "border-gray-200 bg-[#faf8f4] hover:border-[#d6b889]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-900">{item.label}</p>
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
            ))}
          </div>
        </article>
      </section>

      <section className="rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-gray-900">Desired outputs</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {WORKSPACE_OUTPUTS.map((item) => {
            const isActive = profile.desiredOutputs.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleOutput(item.id)}
                className={`rounded-[22px] border p-4 text-left transition-colors ${
                  isActive
                    ? "border-[#172029] bg-[#edf3f5]"
                    : "border-gray-200 bg-[#faf8f4] hover:border-[#d6b889]"
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

        {message && (
          <div className="mt-5 rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              resetProfile();
              setMessage("Workspace preferences reset to defaults.");
            }}
            className="rounded-full border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50"
          >
            Reset workspace profile
          </button>
        </div>
      </section>
    </div>
  );
}
