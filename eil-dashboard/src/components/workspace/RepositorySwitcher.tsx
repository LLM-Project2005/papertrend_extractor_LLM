"use client";

/*
 * The repository's name in the header opens a list of the reader's
 * repositories, so another one is a click away instead of a trip to
 * /workspaces (2026-10-21). Choosing one keeps the reader on the same section -
 * the Dashboard stays the Dashboard, with its tab - and drops what belonged to
 * the old repository: an open paper, a search, a Library folder.
 *
 * A disclosure, like the account menu beside it: a click outside, Escape or
 * tabbing past the list closes it; the arrow keys, Home and End move through
 * the repositories, and a filter appears when there are many.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { menuItemClass, menuLabelClass } from "@/components/ui/controls";
import { CheckIcon, ChevronDownIcon, SearchIcon, StackIcon } from "@/components/ui/Icons";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import type { WorkspaceOrganizationRow, WorkspaceProjectRow } from "@/types/database";

/** With more repositories than this, the list opens with a filter. */
export const FILTER_FROM = 8;

/** Query parameters that name a section rather than something in the old repository. */
const KEPT_PARAMS = ["tab", "section"];

/**
 * Where the page goes when the repository changes: the same workspace page,
 * keeping only its section (a Dashboard tab, a Settings section). A paper, a
 * search or a Library folder belonged to the old repository.
 */
export function switchTarget(pathname: string, search: string): string {
  const base = pathname.startsWith("/workspace/") && pathname !== "/workspace/" ? pathname : "/workspace/home";
  const params = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of KEPT_PARAMS) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `${base}?${query}` : base;
}

export interface RepositoryMenuProps {
  projects: Array<Pick<WorkspaceProjectRow, "id" | "name" | "organization_id">>;
  organizations?: Array<Pick<WorkspaceOrganizationRow, "id" | "name">>;
  currentId: string | null;
  currentName: string;
  onSelect: (projectId: string) => void;
  onAllRepositories?: () => void;
  /** Opens on the first render; for tests. */
  defaultOpen?: boolean;
}

export function RepositoryMenu({ projects, organizations = [], currentId, currentName, onSelect, onAllRepositories, defaultOpen = false }: RepositoryMenuProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [filter, setFilter] = useState("");
  const openRef = useRef(open);
  openRef.current = open;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      // Only while open, and marked as handled, so a dialog's Escape is not taken.
      if (event.key !== "Escape" || !openRef.current || event.defaultPrevented) return;
      event.preventDefault();
      if (containerRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
      setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const showFilter = projects.length >= FILTER_FROM;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? projects.filter((project) => project.name.toLowerCase().includes(needle)) : projects;
  }, [filter, projects]);
  // Grouped by organization only when the reader's repositories span several.
  const orgName = new Map(organizations.map((organization) => [organization.id, organization.name]));
  const grouped = new Set(projects.map((project) => project.organization_id)).size > 1;
  const groups = grouped
    ? [...new Set(shown.map((project) => project.organization_id))].map((id) => ({ id, name: orgName.get(id) ?? "Other repositories", items: shown.filter((project) => project.organization_id === id) }))
    : [{ id: "all", name: "", items: shown }];

  // On opening, focus goes to the filter, or to the open repository in the list.
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (showFilter) filterRef.current?.focus();
      else (listRef.current?.querySelector<HTMLElement>('[aria-current="true"]') ?? listRef.current?.querySelector<HTMLElement>("button"))?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, showFilter]);

  function items(): HTMLButtonElement[] {
    return [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-repository]") ?? [])];
  }

  function moveFocus(event: React.KeyboardEvent) {
    const list = items();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = index < 0 ? 0 : Math.min(list.length - 1, index + 1);
    else if (event.key === "ArrowUp") next = index <= 0 ? (showFilter && index === 0 ? -1 : 0) : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    if (next === null) return;
    event.preventDefault();
    if (next === -1) filterRef.current?.focus();
    else list[next]?.focus();
  }

  function choose(projectId: string) {
    setOpen(false);
    setFilter("");
    if (projectId !== currentId) onSelect(projectId);
    else buttonRef.current?.focus();
  }

  return (
    <div
      ref={containerRef}
      className="relative min-w-0"
      onBlur={(event) => {
        // Tabbing past the last entry closes it, as a click elsewhere does.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={currentName ? `Repository: ${currentName}. Switch repository` : "Select a repository"}
        className="-my-1 flex min-w-0 max-w-[13rem] items-center gap-1 rounded-md px-1.5 py-1 text-ink transition-colors hover:bg-subtle hover:text-ink sm:max-w-[22rem]"
      >
        <span className="min-w-0 truncate font-medium">{currentName || "Select repository"}</span>
        <ChevronDownIcon className={`h-3.5 w-3.5 flex-none text-mute transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div
          id={panelId}
          // On a phone the name sits past the menu button and the logo, so a
          // panel hung from it ran off the screen: there it spans the screen
          // under the header instead.
          className="fixed inset-x-3 top-16 z-50 origin-top rounded-xl border border-hairline bg-surface p-1.5 shadow-overlay motion-safe:animate-scale-in sm:absolute sm:inset-x-auto sm:left-0 sm:top-auto sm:mt-2 sm:w-[min(320px,calc(100vw-1.5rem))] sm:origin-top-left"
          onKeyDown={moveFocus}
        >
          {showFilter ? (
            <label className="relative mb-1 block">
              <span className="sr-only">Find a repository</span>
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
              <input
                ref={filterRef}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Find a repository"
                // The field border, and the site's focus outline: outline-none
                // left a hairline change no one could see (UI audit C2).
                className="h-9 w-full rounded-lg border border-field bg-canvas pl-8 pr-2.5 text-base text-ink placeholder:text-mute sm:text-sm"
              />
            </label>
          ) : null}
          <ul ref={listRef} aria-label="Your repositories" className="max-h-[min(60vh,24rem)] overflow-y-auto overscroll-contain">
            {shown.length === 0 ? <li className="px-2.5 py-2 text-sm text-mute">No repository matches “{filter.trim()}”.</li> : null}
            {groups.map((group) => (
              <li key={group.id}>
                {group.name ? <p className={menuLabelClass}>{group.name}</p> : null}
                <ul>
                  {group.items.map((project) => {
                    const current = project.id === currentId;
                    return (
                      <li key={project.id}>
                        <button
                          type="button"
                          data-repository={project.id}
                          aria-current={current ? "true" : undefined}
                          onClick={() => choose(project.id)}
                          className={menuItemClass(current, "justify-between")}
                        >
                          <span className="min-w-0 truncate" title={project.name}>
                            {project.name}
                          </span>
                          {current ? <CheckIcon className="h-4 w-4 flex-none" aria-hidden /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 border-t border-hairline pt-1.5">
            <Link
              href="/workspaces"
              prefetch={false}
              onClick={() => {
                setOpen(false);
                onAllRepositories?.();
              }}
              className={menuItemClass()}
            >
              {/* Not Home's icon: this is the repository picker (UI audit C19). */}
              <StackIcon className="h-4 w-4" />
              <span>All repositories</span>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The header's switcher: the reader's repositories, and the page they are on,
 * in the new one. `onNavigate` hears of a move to another page (the header's
 * loading bar); `onDone` of any choice (the phone drawer closes).
 */
export default function RepositorySwitcher({ onNavigate, onDone }: { onNavigate?: (href: string) => void; onDone?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { allProjects, projects, organizations, currentProject, setSelectedProjectId } = useWorkspaceProfile();
  const list = allProjects.length > 0 ? allProjects : projects;
  return (
    <RepositoryMenu
      projects={list}
      organizations={organizations}
      currentId={currentProject?.id ?? null}
      currentName={currentProject?.name ?? ""}
      onAllRepositories={() => {
        onNavigate?.("/workspaces");
        onDone?.();
      }}
      onSelect={(projectId) => {
        setSelectedProjectId(projectId);
        const target = switchTarget(pathname, typeof window === "undefined" ? "" : window.location.search);
        // The same page in another repository is no page load: the loading bar would wait out its 12 seconds.
        if (target.split("?")[0] !== pathname) onNavigate?.(target);
        router.push(target);
        onDone?.();
      }}
    />
  );
}
