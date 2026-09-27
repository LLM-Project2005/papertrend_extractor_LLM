"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import CreateEntityModal from "@/components/workspace/CreateEntityModal";
import AnalysisProfileEditor from "@/components/workspace/AnalysisProfileEditor";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { createGeneralAnalysisProfile, sanitizeProjectAnalysisProfile } from "@/lib/project-analysis-profile";
import { BooksIcon, LogoMarkIcon, PencilSquareIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";
import ThemeToggle from "@/components/theme/ThemeToggle";
import WorkspaceProfileMenu from "@/components/workspace/WorkspaceProfileMenu";

const PROJECT_ANALYSIS_PROFILES_ENABLED =
  process.env.NEXT_PUBLIC_PROJECT_ANALYSIS_PROFILES_ENABLED === "true";

export default function ProjectIndexClient() {
  const router = useRouter();
  const { hydrated, user } = useAuth();
  const {
    allProjects,
    organizations,
    selectedOrganizationId,
    workspaceLoading,
    workspaceLoadError,
    refreshOrganizations,
    refreshAllProjects,
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
  const [analysisProfileError, setAnalysisProfileError] = useState<string | null>(null);
  const [analysisProfile, setAnalysisProfile] = useState(createGeneralAnalysisProfile);

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
    setAnalysisProfileError(null);
    try {
      // Organizations remain internal for database compatibility. Users do
      // not need to choose one when creating a repository.
      let organizationId =
        selectedOrganizationId ?? organizations[0]?.id ?? null;
      if (!organizationId) {
        const organization = await createOrganization(
          "Personal repositories",
          "personal"
        );
        organizationId = organization.id;
      }

      let normalizedProfile;
      try {
        normalizedProfile = sanitizeProjectAnalysisProfile(analysisProfile);
      } catch (profileValidationError) {
        setAnalysisProfileError(profileValidationError instanceof Error ? profileValidationError.message : "Check the analysis profile fields.");
        return;
      }
      const project = await createProject(name, {
        organizationId,
        analysisProfile: normalizedProfile,
      });
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

  const header = (
    <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/80 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Papertrend front page">
          <LogoMarkIcon className="h-6 w-6 text-ink" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">Papertrend</span>
        </Link>
        <div className="flex items-center gap-1.5">
          <ThemeToggle compact />
          <WorkspaceProfileMenu />
        </div>
      </div>
    </header>
  );

  if (!hydrated || workspaceLoading) {
    // This is where /login lands and where every workspace breadcrumb points.
    // It shows the real chrome with the cards blocked out, so the first screen
    // after signing in says the app is working and does not jump when the
    // repositories arrive.
    return (
      <main className="min-h-[100dvh] bg-canvas text-ink">
        {header}
        <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16" aria-busy="true">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Repositories</h1>
          <p className="mt-2 text-[15px] leading-7 text-body">Loading your repositories...</p>
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="skeleton h-44 rounded-xl" />
            ))}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-canvas text-ink">
      {header}

      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <h1 className="text-3xl font-semibold tracking-tight text-ink">Repositories</h1>
            <p className="mt-2 text-[15px] leading-7 text-body">
              Each repository keeps its own papers, dashboard and chat. Open one, or start a new
              collection.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row md:max-w-md">
            <label className="relative block min-w-0 flex-1">
              <span className="sr-only">Search repositories</span>
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search repositories"
                className="h-10 w-full rounded-lg border border-hairline bg-surface py-2 pl-10 pr-3 text-base text-ink shadow-raise outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-mute hover:border-hairline-strong focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setDraftName("");
                setAnalysisProfile(createGeneralAnalysisProfile());
                setError(null);
                setAnalysisProfileError(null);
                setShowCreateModal(true);
              }}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-medium text-canvas shadow-raise transition-[background-color,transform] duration-150 hover:bg-ink/85 active:scale-[0.98]"
            >
              <PlusIcon className="h-4 w-4" />
              <span>New repository</span>
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {workspaceLoadError ? (
          <div className="mt-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
            <div>
              <p className="font-medium">Repositories could not be loaded</p>
              <p className="mt-1 text-amber-900 dark:text-amber-200/90">
                Your data has not been removed. {workspaceLoadError}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshAllProjects()}
              className="shrink-0 rounded-lg border border-amber-300 px-3 py-2 font-medium transition-colors hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40"
            >
              Retry
            </button>
          </div>
        ) : null}

        <ul className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => (
            <li key={project.id} className="group relative">
              <button
                type="button"
                onClick={() => {
                  setSelectedProjectId(project.id);
                  router.push("/workspace/home");
                }}
                className="flex h-full min-h-44 w-full flex-col rounded-xl border border-hairline bg-surface p-5 text-left shadow-raise transition-[border-color,box-shadow,transform] duration-200 ease-out-quart hover:-translate-y-0.5 hover:border-hairline-strong hover:shadow-float active:translate-y-0 motion-reduce:hover:translate-y-0"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-subtle text-body ring-1 ring-inset ring-hairline">
                  <BooksIcon className="h-5 w-5" />
                </span>
                <span className="mt-4 block truncate pr-8 text-base font-semibold tracking-tight text-ink">
                  {project.name}
                </span>
                {project.description ? (
                  <span className="mt-1.5 line-clamp-2 text-sm leading-6 text-body">{project.description}</span>
                ) : null}
                <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-5 text-xs text-mute">
                  {PROJECT_ANALYSIS_PROFILES_ENABLED && project.analysis_profile ? (
                    <span className="rounded-full bg-subtle px-2 py-0.5 font-medium text-body">
                      {project.analysis_profile.displayName}
                    </span>
                  ) : null}
                  {project.updated_at ? (
                    <span>
                      Updated{" "}
                      {new Date(project.updated_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  ) : null}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void handleRenameProject(project.id, project.name)}
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-mute opacity-100 transition-[opacity,background-color,color] duration-150 hover:bg-subtle hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                aria-label={`Rename ${project.name}`}
                title="Rename repository"
              >
                <PencilSquareIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>

        {!workspaceLoadError && visibleProjects.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-hairline-strong px-6 py-16 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-body">
              <BooksIcon className="h-5 w-5" />
            </span>
            <p className="mt-4 text-base font-medium text-ink">
              {query.trim() ? "No repository matches that name" : "Start your first repository"}
            </p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-body">
              {query.trim()
                ? "Check the spelling, or clear the search to see them all."
                : "A repository holds one collection of papers: a thesis, a review, a course reading list."}
            </p>
          </div>
        ) : null}
      </section>

      <CreateEntityModal
        open={showCreateModal}
        title="Create repository"
        description="Give this research space a name. Papers and analyses will stay inside the repository."
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
          setAnalysisProfileError(null);
        }}
        onSubmit={handleCreateProject}
        wide
      >
        {PROJECT_ANALYSIS_PROFILES_ENABLED ? (
          <AnalysisProfileEditor
            value={analysisProfile}
            onChange={(nextProfile) => {
              setAnalysisProfile(nextProfile);
              setAnalysisProfileError(null);
            }}
            templates={allProjects
              .filter((project) => project.analysis_profile)
              .map((project) => ({
                projectId: project.id,
                projectName: project.name,
                profile: project.analysis_profile!,
              }))}
            compact
            error={analysisProfileError}
          />
        ) : null}
      </CreateEntityModal>
    </main>
  );
}
