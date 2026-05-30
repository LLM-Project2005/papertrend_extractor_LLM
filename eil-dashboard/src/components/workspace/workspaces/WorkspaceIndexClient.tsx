"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import CreateEntityModal from "@/components/workspace/CreateEntityModal";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { LogoMarkIcon, SearchIcon } from "@/components/ui/Icons";
import type { WorkspaceOrganizationRow } from "@/types/database";

const ORGANIZATION_TYPES: Array<WorkspaceOrganizationRow["type"]> = [
  "personal",
  "academic",
  "research_lab",
  "department",
  "company",
  "other",
];

export default function WorkspaceIndexClient() {
  const router = useRouter();
  const { hydrated, user } = useAuth();
  const {
    organizations,
    createOrganization,
    refreshOrganizations,
    setSelectedOrganizationId,
  } = useWorkspaceProfile();
  const [query, setQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [type, setType] = useState<WorkspaceOrganizationRow["type"]>("personal");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (!user) {
      router.replace("/login");
      return;
    }

    refreshOrganizations().catch(() => undefined);
  }, [hydrated, refreshOrganizations, router, user]);

  const visibleOrganizations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return organizations;
    }
    return organizations.filter((organization) =>
      organization.name.toLowerCase().includes(needle)
    );
  }, [organizations, query]);

  async function handleCreateOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draftName.trim()) {
      setError("Workspace name is required.");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const organization = await createOrganization(draftName, type);
      setDraftName("");
      setType("personal");
      setShowCreateModal(false);
      router.push(`/workspaces/${organization.id}/projects`);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Failed to create workspace."
      );
    } finally {
      setCreating(false);
    }
  }

  if (!hydrated) {
    return <main className="min-h-screen bg-slate-50 dark:bg-black" />;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-black dark:text-white">
      <header className="border-b border-slate-200 bg-white/80 dark:border-[#1f1f1f] dark:bg-transparent">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-950 dark:border-[#2a2a2a] dark:bg-white dark:text-black">
              <LogoMarkIcon className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold">Workspaces</span>
          </div>

          <button
            type="button"
            onClick={() => {
              setDraftName("");
              setType("personal");
              setError(null);
              setShowCreateModal(true);
            }}
            className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-[#e5e5e5]"
          >
            New workspace
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-16">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-normal text-slate-950 dark:text-white">Your Workspaces</h1>
          <p className="mt-4 text-base leading-8 text-slate-600 dark:text-[#a3a3a3]">
            Create a clean home for each team, lab, or research initiative before
            you start building projects.
          </p>
        </div>

        <div className="mt-10 max-w-sm">
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-[#1f1f1f] dark:bg-[#050505]">
            <SearchIcon className="h-4 w-4 text-slate-400 dark:text-[#7a7a7a]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search for a workspace"
              className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-[#6f6f6f]"
            />
          </label>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visibleOrganizations.map((organization) => (
            <button
              key={organization.id}
              type="button"
              onClick={() => {
                setSelectedOrganizationId(organization.id);
                router.push(`/workspaces/${organization.id}/projects`);
              }}
              className="rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:border-[#3a3a3a] dark:hover:bg-[#0a0a0a]"
            >
              <p className="text-xl font-semibold text-slate-900 dark:text-white">{organization.name}</p>
              <p className="mt-2 text-sm capitalize text-slate-500 dark:text-[#9c9c9c]">
                {organization.type.replace(/_/g, " ")}
              </p>
            </button>
          ))}
        </div>

        {visibleOrganizations.length === 0 ? (
          <div className="mt-16 rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center dark:border-[#1f1f1f] dark:bg-[#050505]">
            <p className="text-lg font-medium text-slate-900 dark:text-white">No workspaces yet</p>
            <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-[#9c9c9c]">
              Start by creating one workspace, then add projects inside it.
            </p>
          </div>
        ) : null}
      </section>

      <CreateEntityModal
        open={showCreateModal}
        title="Create workspace"
        description="Group related research projects under one team, lab, department, or initiative."
        value={draftName}
        fieldLabel="Workspace name"
        fieldPlaceholder="Workspace name"
        submitLabel="Create workspace"
        busyLabel="Creating..."
        busy={creating}
        error={error}
        onValueChange={setDraftName}
        onClose={() => {
          if (creating) {
            return;
          }
          setShowCreateModal(false);
          setError(null);
        }}
        onSubmit={handleCreateOrganization}
      >
        <label className="grid gap-3">
          <span className="text-sm font-medium text-slate-700 dark:text-white">Type</span>
          <select
            value={type}
            onChange={(event) =>
              setType(event.target.value as WorkspaceOrganizationRow["type"])
            }
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-slate-900 dark:border-[#1f1f1f] dark:bg-black dark:text-white dark:focus:border-white"
          >
            {ORGANIZATION_TYPES.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      </CreateEntityModal>
    </main>
  );
}
