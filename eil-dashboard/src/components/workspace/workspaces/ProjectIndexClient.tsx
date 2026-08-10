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
      setError("Repository name is required.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      // Organizations remain internal for database compatibility. Users do
      // not need to choose one when creating a repository.
      let organizationId =
        selectedOrganizationId ?? organizations[0]?.id ?? null;
      if (!organizationId) {
        const organization = await createOrganization(
          profile.name.trim() || "Personal repositories",
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
        createError instanceof Error ? createError.message : "Failed to create repository."
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleRenameProject(projectId: string, currentName: string) {
    const nextName = window.prompt("Rename repository", currentName);
    if (!nextName?.trim() || nextName.trim() === currentName) return;

    try {
      await renameProject(projectId, nextName.trim());
      setError(null);
    } catch (renameError) {
      setError(
        renameError instanceof Error ? renameError.message : "Failed to rename repository."
      );
    }
  }

  if (!hydrated || workspaceLoading) {
    return <main className="min-h-screen bg-papertrend-canvas" />;
  }

  return (
    <main className="papertrend-product min-h-screen bg-papertrend-canvas text-papertrend-ink">
      <header className="border-b border-papertrend-line bg-papertrend-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-4">
          <Link
            href="/"
            className="flex h-9 w-9 items-center justify-center text-papertrend-ink transition-colors hover:text-papertrend-action"
            aria-label="Go to front page"
          >
            <LogoMarkIcon className="h-7 w-7" />
          </Link>
          <div>
            <p className="font-mono text-[10px] uppercase text-papertrend-muted">
              Papertrend
            </p>
            <span className="text-lg font-semibold">Repositories</span>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid gap-10 border-b border-papertrend-line pb-10 lg:grid-cols-[0.38fr_1fr] lg:items-end">
          <div className="font-mono text-xs text-papertrend-muted">
            <p className="text-papertrend-action">[ REPOSITORY INDEX ]</p>
            <p className="mt-3">{allProjects.length} research space{allProjects.length === 1 ? "" : "s"}</p>
          </div>
          <div>
            <h1 className="text-5xl font-semibold leading-none text-papertrend-ink sm:text-6xl">
              Your repositories
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-8 text-papertrend-muted">
              Choose a repository to manage its folders, papers, dashboard, and research chat.
            </p>
            <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row">
            <label className="flex min-h-11 flex-1 items-center gap-3 rounded-md border border-papertrend-line bg-papertrend-surface px-4 py-3">
              <SearchIcon className="h-4 w-4 text-papertrend-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search repositories"
                className="w-full bg-transparent text-sm text-papertrend-ink outline-none placeholder:text-papertrend-muted"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setDraftName("");
                setError(null);
                setShowCreateModal(true);
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-papertrend-action px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--pt-action-hover)]"
            >
              <PlusIcon className="h-4 w-4" />
              <span>New repository</span>
            </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-md border border-[var(--pt-danger)] bg-[var(--pt-danger-soft)] px-4 py-3 text-sm text-[var(--pt-danger)]">
            {error}
          </div>
        ) : null}

        <div className="mt-10 border-t border-papertrend-line">
          {visibleProjects.map((project, index) => (
            <article
              key={project.id}
              className="group grid border-b border-papertrend-line py-6 transition-colors hover:bg-papertrend-raised sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:items-center sm:px-4"
            >
              <span className="hidden font-mono text-xs text-papertrend-muted sm:block">{String(index + 1).padStart(2, "0")}</span>
              <div className="flex min-w-0 items-start justify-between gap-4 sm:contents">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProjectId(project.id);
                    router.push("/workspace/home");
                  }}
                  className="min-w-0 flex-1 text-left sm:pr-8"
                >
                  <div className="flex items-center gap-2 text-papertrend-muted">
                    <FileIcon className="h-4 w-4" />
                    <span className="text-xs font-medium uppercase tracking-normal">Repository</span>
                  </div>
                  <p className="mt-2 text-2xl font-semibold text-papertrend-ink transition-colors group-hover:text-papertrend-action">
                    {project.name}
                  </p>
                  <p className="mt-2 text-sm leading-7 text-papertrend-muted">
                    {project.description || "Folders, papers, analytics, and research chat."}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void handleRenameProject(project.id, project.name)}
                  className="rounded-md border border-transparent p-2 text-papertrend-muted transition-colors hover:border-papertrend-line hover:bg-papertrend-surface hover:text-papertrend-ink"
                  aria-label={`Rename ${project.name}`}
                  title="Rename repository"
                >
                  <MoreHorizontalIcon className="h-4 w-4" />
                </button>
              </div>
            </article>
          ))}
        </div>

        {visibleProjects.length === 0 ? (
          <div className="mt-16 border-y border-dashed border-papertrend-line bg-papertrend-surface px-6 py-14 text-center">
            <p className="text-lg font-medium text-papertrend-ink">No repositories yet</p>
            <p className="mt-3 text-sm leading-7 text-papertrend-muted">
              Create a repository to start organizing and analyzing papers.
            </p>
          </div>
        ) : null}
      </section>

      <CreateEntityModal
        open={showCreateModal}
        title="Create repository"
        description="Give this research space a name. Folders and files will stay inside the repository."
        value={draftName}
        fieldLabel="Repository name"
        fieldPlaceholder="Repository name"
        submitLabel="Create repository"
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
