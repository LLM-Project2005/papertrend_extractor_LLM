"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import CreateEntityModal from "@/components/workspace/CreateEntityModal";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { FileIcon, LogoMarkIcon, MoreHorizontalIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";

export default function ProjectIndexClient() {
  const router = useRouter();
  const { hydrated, user } = useAuth();
  const {
    allProjects,
    organizations,
    profile,
    selectedOrganizationId,
    workspaceLoading,
    refreshOrganizations,
    createOrganization,
    createProject,
    renameProject,
    setSelectedProjectId,
  } = useWorkspaceProfile();
  const [query, setQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    refreshOrganizations().catch(() => undefined);
  }, [hydrated, refreshOrganizations, router, user]);

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allProjects;
    return allProjects.filter((project) => {
      return `${project.name} ${project.description ?? ""}`.toLowerCase().includes(needle);
    });
  }, [allProjects, query]);

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draftName.trim();
    if (!name) {
      setError("Project name is required.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      // Organizations remain internal for database compatibility. Users do
      // not need to choose one when creating a project.
      let organizationId =
        selectedOrganizationId ?? organizations[0]?.id ?? null;
      if (!organizationId) {
        const organization = await createOrganization(
          profile.name.trim() || "Personal projects",
          "personal"
        );
        organizationId = organization.id;
      }

      const project = await createProject(name, { organizationId });
      setSelectedProjectId(project.id);
      setDraftName("");
      setShowCreateModal(false);
      router.push("/workspace/home");
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Failed to create project."
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleRenameProject(projectId: string, currentName: string) {
    const nextName = window.prompt("Rename project", currentName);
    if (!nextName?.trim() || nextName.trim() === currentName) return;

    try {
      await renameProject(projectId, nextName.trim());
      setError(null);
    } catch (renameError) {
      setError(
        renameError instanceof Error ? renameError.message : "Failed to rename project."
      );
    }
  }

  if (!hydrated || workspaceLoading) {
    return <main className="min-h-screen bg-slate-50 dark:bg-black" />;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-black dark:text-white">
      <header className="border-b border-slate-200 bg-white/80 dark:border-[#1f1f1f] dark:bg-transparent">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-4">
          <Link
            href="/"
            className="flex h-9 w-9 items-center justify-center text-slate-950 dark:text-white"
            aria-label="Go to front page"
          >
            <LogoMarkIcon className="h-7 w-7" />
          </Link>
          <div>
            <p className="text-xs font-medium uppercase tracking-normal text-slate-500 dark:text-[#8f8f8f]">
              Papertrend
            </p>
            <span className="text-lg font-semibold">Projects</span>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-16">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-semibold tracking-normal text-slate-950 dark:text-white">
              Your projects
            </h1>
            <p className="mt-4 text-base leading-8 text-slate-600 dark:text-[#a3a3a3]">
              Choose a project to manage its folders, papers, dashboard, and research chat.
            </p>
          </div>

          <div className="flex w-full max-w-xl flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-[#1f1f1f] dark:bg-[#050505]">
              <SearchIcon className="h-4 w-4 text-slate-400 dark:text-[#7a7a7a]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects"
                className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-[#6f6f6f]"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setDraftName("");
                setError(null);
                setShowCreateModal(true);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-[#e5e5e5]"
            >
              <PlusIcon className="h-4 w-4" />
              <span>New project</span>
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => (
            <article
              key={project.id}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:border-[#3a3a3a] dark:hover:bg-[#0a0a0a]"
            >
              <div className="flex items-start justify-between gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProjectId(project.id);
                    router.push("/workspace/home");
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2 text-slate-500 dark:text-[#8f8f8f]">
                    <FileIcon className="h-4 w-4" />
                    <span className="text-xs font-medium uppercase tracking-normal">Project</span>
                  </div>
                  <p className="mt-3 text-2xl font-semibold text-slate-900 dark:text-white">
                    {project.name}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-[#9c9c9c]">
                    {project.description || "Folders, papers, analytics, and research chat."}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void handleRenameProject(project.id, project.name)}
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:text-[#666666] dark:hover:bg-[#111111] dark:hover:text-white"
                  aria-label={`Rename ${project.name}`}
                  title="Rename project"
                >
                  <MoreHorizontalIcon className="h-4 w-4" />
                </button>
              </div>
            </article>
          ))}
        </div>

        {visibleProjects.length === 0 ? (
          <div className="mt-16 rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center dark:border-[#1f1f1f] dark:bg-[#050505]">
            <p className="text-lg font-medium text-slate-900 dark:text-white">No projects yet</p>
            <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-[#9c9c9c]">
              Create a project to start organizing and analyzing papers.
            </p>
          </div>
        ) : null}
      </section>

      <CreateEntityModal
        open={showCreateModal}
        title="Create project"
        description="Give this research space a name. Folders and files will stay inside the project."
        value={draftName}
        fieldLabel="Project name"
        fieldPlaceholder="Project name"
        submitLabel="Create project"
        busyLabel="Creating..."
        busy={creating}
        error={error}
        onValueChange={setDraftName}
        onClose={() => {
          if (creating) return;
          setShowCreateModal(false);
          setError(null);
        }}
        onSubmit={handleCreateProject}
      />
    </main>
  );
}
