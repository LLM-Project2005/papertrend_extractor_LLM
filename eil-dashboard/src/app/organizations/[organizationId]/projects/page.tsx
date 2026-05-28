"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import CreateEntityModal from "@/components/workspace/CreateEntityModal";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { LogoMarkIcon, MoreHorizontalIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";

export default function ProjectsPage() {
  const params = useParams<{ organizationId: string }>();
  const organizationId = params.organizationId;
  const router = useRouter();
  const { hydrated, user } = useAuth();
  const {
    organizations,
    projects,
    currentOrganization,
    refreshOrganizations,
    refreshProjects,
    createProject,
    setSelectedOrganizationId,
    setSelectedProjectId,
  } = useWorkspaceProfile();
  const [query, setQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedOrganizationRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!user) {
      router.replace("/login");
      return;
    }

    if (initializedOrganizationRef.current === organizationId) {
      return;
    }

    initializedOrganizationRef.current = organizationId;
    setSelectedOrganizationId(organizationId);
    refreshOrganizations().catch(() => undefined);
    refreshProjects(organizationId).catch(() => undefined);
  }, [
    hydrated,
    organizationId,
    refreshOrganizations,
    refreshProjects,
    router,
    setSelectedOrganizationId,
    user,
  ]);

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return projects;
    }
    return projects.filter((project) => project.name.toLowerCase().includes(needle));
  }, [projects, query]);

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draftName.trim()) {
      setError("Project name is required.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const project = await createProject(draftName, { organizationId });
      flushSync(() => {
        setSelectedProjectId(project.id);
      });
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

  const heading =
    currentOrganization?.name ||
    organizations.find((organization) => organization.id === organizationId)?.name ||
    "Projects";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#111111] dark:text-white">
      <header className="border-b border-slate-200 bg-white/80 dark:border-white/10 dark:bg-transparent">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1f9d63] text-white">
            <LogoMarkIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm text-slate-500 dark:text-[#8f8f8f]">Organization</p>
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Link
                href="/organizations"
                className="text-slate-500 transition-colors hover:text-slate-900 dark:text-[#a3a3a3] dark:hover:text-white"
              >
                Organizations
              </Link>
              <span className="text-slate-400 dark:text-[#5f5f5f]">&gt;</span>
              <span>{heading}</span>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-16">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">Projects</h1>
            <p className="mt-4 text-base leading-8 text-slate-600 dark:text-[#a3a3a3]">
              Create a project for each research space you want to analyze and
              explore.
            </p>
          </div>

          <div className="flex w-full max-w-xl flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#171717]">
              <SearchIcon className="h-4 w-4 text-slate-400 dark:text-[#7a7a7a]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search for a project"
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
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1f9d63] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#198451]"
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
            <button
              key={project.id}
              type="button"
              onClick={() => {
                flushSync(() => {
                  setSelectedProjectId(project.id);
                });
                router.push("/workspace/home");
              }}
              className="rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-[#171717] dark:hover:border-white/20 dark:hover:bg-[#1b1b1b]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-2xl font-semibold text-slate-900 dark:text-white">{project.name}</p>
                  {project.description ? (
                    <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-[#9c9c9c]">
                      {project.description}
                    </p>
                  ) : (
                    <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-[#9c9c9c]">
                      Open this project to manage the library, dashboard, chat,
                      and analysis flow.
                    </p>
                  )}
                </div>
                <MoreHorizontalIcon className="h-4 w-4 text-slate-400 dark:text-[#666666]" />
              </div>
            </button>
          ))}
        </div>

        {visibleProjects.length === 0 ? (
          <div className="mt-16 rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center dark:border-white/10 dark:bg-[#141414]">
            <p className="text-lg font-medium text-slate-900 dark:text-white">No projects yet</p>
            <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-[#9c9c9c]">
              Create your first project in this organization to open the
              workspace.
            </p>
          </div>
        ) : null}

        <div className="mt-10">
          <Link
            href="/organizations"
            className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-[#9c9c9c] dark:hover:text-white"
          >
            Back to organizations
          </Link>
        </div>
      </section>

      <CreateEntityModal
        open={showCreateModal}
        title="Create project"
        description="Create a new project inside this organization and jump straight into the workspace."
        value={draftName}
        fieldLabel="Project name"
        fieldPlaceholder="Project name"
        submitLabel="Create project"
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
        onSubmit={handleCreateProject}
      />
    </main>
  );
}
