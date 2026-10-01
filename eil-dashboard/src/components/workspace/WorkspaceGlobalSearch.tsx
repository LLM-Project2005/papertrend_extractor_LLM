"use client";

import { usePaperViewer } from "@/components/workspace/PaperViewerProvider";
import { hasOpenDialog } from "@/components/ui/Modal";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { docsSearchItems } from "@/lib/docs-content";
import {
  ChartIcon,
  ChatIcon,
  CloudIcon,
  FileIcon,
  HomeIcon,
  PaperIcon,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
  UploadIcon,
  UserIcon,
} from "@/components/ui/Icons";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import type { IngestionRunRow } from "@/types/database";
import { hasUsableAnalysis } from "@/lib/usable-analysis";
import { getRunDisplayTitle, getRunStatusLabel } from "@/lib/ingestion-status";

interface SearchPageItem {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  keywords?: string[];
  featured?: boolean;
}

type SearchCategory =
  | "Actions"
  | "Pages"
  | "Papers"
  | "Repositories"
  | "Docs";

interface SearchResult {
  id: string;
  label: string;
  description: string;
  category: SearchCategory;
  icon: ComponentType<{ className?: string }>;
  featured?: boolean;
  searchText: string;
  onSelect: () => void;
}

const CATEGORY_ORDER: SearchCategory[] = [
  "Actions",
  "Pages",
  "Papers",
  "Repositories",
  "Docs",
];

const ACTION_ITEMS: Array<{
  id: string;
  label: string;
  description: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  keywords: string[];
  featured?: boolean;
}> = [
  {
    id: "analyze-paper",
    label: "Analyze paper",
    description: "Upload PDFs and queue them for extraction, metadata, topics, and keywords.",
    href: "/workspace/library?action=upload",
    icon: UploadIcon,
    keywords: ["analyse", "analyze", "upload", "upload file", "paper analysis", "queue", "pdf"],
    featured: true,
  },
  // "Search library", "Deep research agent", "Create a chart", "Switch
  // repository", "Configure repository" and "Profile" were here too, each the
  // same address as a page below, so the list showed them twice (docs/32,
  // 2.11, SHELL-7). Their words are the pages' keywords now, and searching the
  // Library is offered for whatever was typed.
];

const DOC_ITEMS: Array<{
  id: string;
  label: string;
  description: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  keywords: string[];
}> = [
  {
    id: "docs-home",
    label: "Documentation",
    description: "Open the public Papertrend documentation home.",
    href: "/docs",
    icon: FileIcon,
    keywords: ["docs", "documentation", "guide", "manual", "help", "product docs"],
  },
  {
    id: "docs-search",
    label: "Search docs",
    description: "Search public docs for features, troubleshooting, and evaluation guidance.",
    href: "/docs/search",
    icon: SearchIcon,
    keywords: [
      "search docs",
      "docs search",
      "documentation search",
      "help search",
      "troubleshooting",
      "evaluation",
    ],
  },
  ...docsSearchItems.map((item) => ({
    id: item.id,
    label: item.sectionId ? `${item.title} docs` : item.title,
    description: item.sectionId ? `Section in ${item.description}` : item.description,
    href: item.href,
    icon: item.sectionId ? SearchIcon : FileIcon,
    keywords: [
      "docs",
      "documentation",
      "guide",
      "manual",
      "help",
      item.category,
      item.title,
      item.description,
      ...item.tags,
      item.searchText,
    ],
  })),
];

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreResult(result: SearchResult, query: string) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) {
    return result.featured ? 1 : 0;
  }

  const haystack = normalizeSearch(`${result.label} ${result.description} ${result.searchText}`);
  const label = normalizeSearch(result.label);
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  let score = 0;

  if (label === normalizedQuery) score += 80;
  if (label.startsWith(normalizedQuery)) score += 48;
  if (haystack.includes(normalizedQuery)) score += 30;

  for (const token of tokens) {
    if (label.includes(token)) score += 12;
    if (haystack.includes(token)) score += 7;
  }

  if (tokens.length > 0 && tokens.every((token) => haystack.includes(token))) {
    score += 18;
  }

  if (result.category === "Actions") score += 5;
  if (result.category === "Papers") score += 3;

  return score;
}

/** The paper's own title where the analysis found one, as the Library names it. */
function titleOf(run: IngestionRunRow) {
  return getRunDisplayTitle(run);
}

function runDescription(run: IngestionRunRow) {
  const updated = run.updated_at ? new Date(run.updated_at).toLocaleDateString() : null;
  return [getRunStatusLabel(run), updated].filter(Boolean).join(" • ");
}

export default function WorkspaceGlobalSearch({
  pageItems,
}: {
  pageItems: SearchPageItem[];
}) {
  const router = useRouter();
  const paperViewer = usePaperViewer();
  const { session } = useAuth();
  const {
    allProjects,
    currentProject,
    selectedProjectId,
    setSelectedProjectId,
    setSelectedFolderId,
  } = useWorkspaceProfile();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const [libraryRuns, setLibraryRuns] = useState<IngestionRunRow[]>([]);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Only while open, and marked as handled (docs/32, 2.9).
        if (!openRef.current || event.defaultPrevented) return;
        event.preventDefault();
        // Focus goes back to the button, not to the top of the page.
        if (containerRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
        setOpen(false);
        return;
      }
      // "/" opens search from anywhere, as the badge on the button promises,
      // unless the reader is typing in a field (where "/" is just a slash) or
      // a dialog is open over the page.
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !hasOpenDialog()) {
        const target = event.target as HTMLElement | null;
        const typing =
          target?.isContentEditable ||
          (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
        if (!typing) {
          event.preventDefault();
          setOpen(true);
        }
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // The repository's papers are read when search opens, so each opening
  // finds papers analysed since; every page used to fetch them on load
  // (docs/32, 2.11, SHELL-7).
  useEffect(() => {
    if (!session?.access_token || !selectedProjectId) {
      setLibraryRuns([]);
      return;
    }
    if (!open) return;

    const controller = new AbortController();
    fetch(
      `/api/workspace/library?projectId=${encodeURIComponent(
        selectedProjectId
      )}&includeTrashed=false`,
      {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: controller.signal,
      }
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          runs?: IngestionRunRow[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load library files.");
        }
        setLibraryRuns(payload.runs ?? []);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          setLibraryRuns([]);
        }
      });

    return () => controller.abort();
  }, [open, selectedProjectId, session?.access_token]);

  const projectIcon =
    pageItems.find((item) => item.id === "project-overview")?.icon ?? HomeIcon;

  const allResults = useMemo<SearchResult[]>(() => {
    const navigate = (href: string) => {
      if (href.startsWith("/workspace/library")) {
        setSelectedFolderId("all");
      }
      router.push(href);
    };

    return [
      ...ACTION_ITEMS.map((item) => ({
        id: `action:${item.id}`,
        label: item.label,
        description: item.description,
        category: "Actions" as const,
        icon: item.icon,
        featured: item.featured,
        searchText: item.keywords.join(" "),
        onSelect: () => navigate(item.href),
      })),
      ...pageItems.map((item) => ({
        id: `page:${item.id}`,
        label: item.label,
        description: item.description,
        category: "Pages" as const,
        icon: item.icon,
        featured: item.featured,
        searchText: [item.label, item.description, ...(item.keywords ?? [])].join(" "),
        onSelect: () => {
          setSelectedFolderId("all");
          router.push(item.href);
        },
      })),
      ...libraryRuns.map((run) => ({
        id: `run:${run.id}`,
        label: titleOf(run),
        description: runDescription(run) || "Open this repository paper",
        category: "Papers" as const,
        icon: hasUsableAnalysis(run) ? PaperIcon : CloudIcon,
        featured: false,
        // What a reader would type: the title, the file name, the state. Model
        // names, storage paths and stock words matched almost any query.
        searchText: [titleOf(run), run.source_filename ?? "", getRunStatusLabel(run)].join(" "),
        onSelect: () => {
          if (hasUsableAnalysis(run) && paperViewer) {
            paperViewer.openPaper({ runId: run.id });
            return;
          }
          setSelectedFolderId("all");
          router.push(`/workspace/library?runId=${encodeURIComponent(run.id)}`);
        },
      })),
      ...allProjects.map((project) => {
        return {
          id: `project:${project.id}`,
          label: project.name,
          description: "Open this repository",
          category: "Repositories" as const,
          icon: projectIcon,
          featured: currentProject?.id === project.id,
          searchText: `${project.name} ${project.description ?? ""} switch repository project`,
          onSelect: () => {
            setSelectedProjectId(project.id);
            setSelectedFolderId("all");
            router.push("/workspace/home");
          },
        };
      }),
      ...DOC_ITEMS.map((item) => ({
        id: `docs:${item.id}`,
        label: item.label,
        description: item.description,
        category: "Docs" as const,
        icon: item.icon,
        featured: false,
        searchText: item.keywords.join(" "),
        onSelect: () => router.push(item.href),
      })),
    ];
  }, [
    allProjects,
    currentProject?.id,
    libraryRuns,
    paperViewer,
    pageItems,
    projectIcon,
    router,
    setSelectedFolderId,
    setSelectedProjectId,
  ]);

  const searchResults = useMemo(() => {
    const normalizedQuery = deferredQuery.trim();
    if (!normalizedQuery) {
      return allResults.filter((result) => result.featured).slice(0, 10);
    }

    const matches = allResults
      .map((result) => ({ result, score: scoreResult(result, normalizedQuery) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.result)
      .slice(0, 13);
    // The Library searches every paper by what was typed; the palette holds
    // only the first 200.
    return [
      ...matches,
      {
        id: "action:search-library",
        label: `Search the Library for \u201c${normalizedQuery}\u201d`,
        description: "Every paper in this repository, by title, file name and more",
        category: "Actions" as const,
        icon: PaperIcon,
        featured: false,
        searchText: normalizedQuery,
        onSelect: () => {
          setSelectedFolderId("all");
          router.push(`/workspace/library?q=${encodeURIComponent(normalizedQuery)}`);
        },
      },
    ];
  }, [allResults, deferredQuery, router, setSelectedFolderId]);

  const groupedResults = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        items: searchResults.filter((result) => result.category === category),
      })).filter((group) => group.items.length > 0),
    [searchResults]
  );

  function handleSelect(result: SearchResult) {
    setQuery("");
    setOpen(false);
    result.onSelect();
  }

  return (
    // Below lg the wrapper is not positioned, so the palette is placed against
    // the full-width header rather than the small button near the screen's
    // right edge, which pushed its left part off a phone's screen (docs/32, 2.10).
    <div ref={containerRef} className="lg:relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline bg-surface text-mute shadow-raise transition-[border-color,color] duration-150 hover:border-hairline-strong hover:text-ink sm:w-[184px] sm:justify-start sm:gap-2 sm:px-3"
        aria-label="Search repository"
        aria-keyshortcuts="/"
      >
        <SearchIcon className="h-4 w-4 flex-none" />
        <span className="hidden min-w-0 truncate text-sm sm:block">Search</span>
        <kbd className="ml-auto hidden rounded border border-hairline bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-mute xl:block">
          /
        </kbd>
      </button>

      {open ? (
        <div className="absolute inset-x-2 top-full z-50 mt-2 origin-top overflow-hidden rounded-xl border border-hairline bg-surface shadow-overlay motion-safe:animate-scale-in lg:inset-x-auto lg:right-0 lg:top-auto lg:w-[min(680px,calc(100vw-1rem))] lg:origin-top-right">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (searchResults[0]) {
                handleSelect(searchResults[0]);
              }
            }}
            className="border-b border-slate-200 p-2 dark:border-[#1f1f1f]"
          >
            <label className="relative block">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-[#8e8e8e]" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search actions, papers, repositories, docs…"
                aria-label="Search actions, papers, repositories, and documentation"
                className="h-11 w-full rounded-xl border border-transparent bg-slate-50 py-2.5 pl-10 pr-4 text-base text-slate-900 sm:text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300 dark:bg-[#0a0a0a] dark:text-white dark:placeholder:text-[#8f8f8f] dark:focus:border-[#3a3a3a]"
              />
            </label>
          </form>

          <p role="status" className="sr-only">
            {query.trim() ? `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}` : ""}
          </p>
          {groupedResults.length > 0 ? (
            <div className="max-h-[min(460px,calc(100dvh-9rem))] overflow-y-auto p-2">
              {groupedResults.map((group) => (
                <div key={group.category} className="py-1">
                  <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8f8f8f]">
                    {group.category}
                  </p>
                  <div className="space-y-1">
                    {group.items.map((result) => {
                      const Icon = result.icon;

                      return (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => handleSelect(result)}
                          className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-slate-100 dark:hover:bg-[#0a0a0a]"
                        >
                          <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 dark:border-[#1f1f1f] dark:bg-[#0a0a0a] dark:text-[#d0d0d0]">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">
                              {result.label}
                            </span>
                            <span className="mt-1 block text-sm text-slate-500 dark:text-[#9b9b9b]">
                              {result.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-slate-500 dark:text-[#9b9b9b]">
              No results found for &quot;{deferredQuery.trim()}&quot;.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
