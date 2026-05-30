"use client";

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
  FolderIcon,
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
  | "Library"
  | "Workspaces"
  | "Projects"
  | "Folders"
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
  "Library",
  "Workspaces",
  "Projects",
  "Folders",
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
  {
    id: "search-library",
    label: "Search library",
    description: "Find papers, open a file, or jump into the analysis detail panel.",
    href: "/workspace/library",
    icon: PaperIcon,
    keywords: ["library", "paper", "papers", "file", "files", "detail", "analysis detail"],
    featured: true,
  },
  {
    id: "deep-research-agent",
    label: "Deep research agent",
    description: "Open chat and use the multi-step research agent for plans and reports.",
    href: "/workspace/chat",
    icon: SparkIcon,
    keywords: ["deep agent", "deep research", "agent", "langgraph", "research plan", "report"],
    featured: true,
  },
  {
    id: "chart-mode",
    label: "Create a chart",
    description: "Use chat chart mode to visualize papers, topics, keywords, and tracks.",
    href: "/workspace/chat",
    icon: ChartIcon,
    keywords: ["chart", "graph", "visualize", "visualise", "plot", "กราฟ", "แผนภูมิ"],
  },
  {
    id: "switch-project",
    label: "Switch project",
    description: "Choose another workspace project or create a new one.",
    href: "/workspaces",
    icon: HomeIcon,
    keywords: ["switch project", "change project", "workspace", "project picker"],
  },
  {
    id: "configure-workspace",
    label: "Configure workspace",
    description: "Update workspace identity, defaults, and display preferences.",
    href: "/workspace/settings",
    icon: SettingsIcon,
    keywords: ["settings", "configure", "configuration", "workspace settings", "preferences"],
  },
  {
    id: "profile",
    label: "Profile",
    description: "Manage your account name, avatar, and profile details.",
    href: "/workspace/profile",
    icon: UserIcon,
    keywords: ["profile", "account", "user", "avatar"],
  },
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
  if (result.category === "Library") score += 3;

  return score;
}

function titleOf(run: IngestionRunRow) {
  return run.display_name || run.source_filename || "Untitled paper";
}

function runDescription(run: IngestionRunRow) {
  const status = run.status === "succeeded" ? "analysis ready" : run.status;
  const updated = run.updated_at ? new Date(run.updated_at).toLocaleDateString() : null;
  return [status, updated].filter(Boolean).join(" • ");
}

export default function WorkspaceGlobalSearch({
  pageItems,
}: {
  pageItems: SearchPageItem[];
}) {
  const router = useRouter();
  const { session } = useAuth();
  const {
    organizations,
    allProjects,
    allFolders,
    currentOrganization,
    currentProject,
    selectedProjectId,
    setSelectedOrganizationId,
    setSelectedProjectId,
    setSelectedFolderId,
  } = useWorkspaceProfile();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
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
        setOpen(false);
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

  useEffect(() => {
    if (!session?.access_token || !selectedProjectId) {
      setLibraryRuns([]);
      return;
    }

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
  }, [selectedProjectId, session?.access_token]);

  const projectById = useMemo(
    () => new Map(allProjects.map((project) => [project.id, project])),
    [allProjects]
  );
  const workspaceIcon =
    pageItems.find((item) => item.id === "workspaces")?.icon ?? HomeIcon;
  const projectIcon =
    pageItems.find((item) => item.id === "project-overview")?.icon ?? HomeIcon;
  const folderIcon =
    pageItems.find((item) => item.id === "library")?.icon ?? FolderIcon;

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
        description: runDescription(run) || "Open this library file",
        category: "Library" as const,
        icon: run.status === "succeeded" ? PaperIcon : CloudIcon,
        featured: false,
        searchText: [
          titleOf(run),
          run.status,
          run.provider ?? "",
          run.model ?? "",
          run.source_path ?? "",
          run.error_message ?? "",
          "paper library analysis file pdf detail",
        ].join(" "),
        onSelect: () => {
          setSelectedFolderId("all");
          router.push(`/workspace/library?runId=${encodeURIComponent(run.id)}`);
        },
      })),
      ...organizations.map((organization) => ({
        id: `organization:${organization.id}`,
        label: organization.name,
        description: "Open this workspace and its projects",
        category: "Workspaces" as const,
        icon: workspaceIcon,
        featured: currentOrganization?.id === organization.id,
        searchText: `${organization.name} ${organization.type.replace(
          /_/g,
          " "
        )} workspace switch project organization`,
        onSelect: () => {
          setSelectedOrganizationId(organization.id);
          router.push("/workspaces");
        },
      })),
      ...allProjects.map((project) => {
        const organization = organizations.find(
          (item) => item.id === project.organization_id
        );

        return {
          id: `project:${project.id}`,
          label: project.name,
          description: organization
            ? `Project in ${organization.name}`
            : "Open this project workspace",
          category: "Projects" as const,
          icon: projectIcon,
          featured: currentProject?.id === project.id,
          searchText: `${project.name} ${project.description ?? ""} ${
            organization?.name ?? ""
          } switch project workspace`,
          onSelect: () => {
            setSelectedProjectId(project.id);
            setSelectedFolderId("all");
            router.push("/workspace/home");
          },
        };
      }),
      ...allFolders
        .filter((folder) => folder.project_id)
        .map((folder) => {
          const project = folder.project_id
            ? projectById.get(folder.project_id) ?? null
            : null;

          return {
            id: `folder:${folder.id}`,
            label: folder.name,
            description: project
              ? `Folder in ${project.name}`
              : "Open this folder in the library",
            category: "Folders" as const,
            icon: folderIcon,
            featured: false,
            searchText: `${folder.name} ${folder.description ?? ""} ${
              project?.name ?? ""
            } library folder papers files`,
            onSelect: () => {
              if (folder.project_id) {
                setSelectedProjectId(folder.project_id);
              }
              setSelectedFolderId(folder.id);
              router.push("/workspace/library");
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
    allFolders,
    allProjects,
    currentOrganization?.id,
    currentProject?.id,
    folderIcon,
    libraryRuns,
    organizations,
    pageItems,
    projectById,
    projectIcon,
    router,
    setSelectedFolderId,
    setSelectedOrganizationId,
    setSelectedProjectId,
    workspaceIcon,
  ]);

  const searchResults = useMemo(() => {
    const normalizedQuery = deferredQuery.trim();
    if (!normalizedQuery) {
      return allResults.filter((result) => result.featured).slice(0, 10);
    }

    return allResults
      .map((result) => ({ result, score: scoreResult(result, normalizedQuery) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.result)
      .slice(0, 14);
  }, [allResults, deferredQuery]);

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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white sm:w-[168px] sm:justify-start sm:gap-2 sm:px-3"
        aria-label="Search workspace"
      >
        <SearchIcon className="h-4 w-4 flex-none" />
        <span className="hidden min-w-0 truncate text-sm sm:block">Search</span>
        <span className="ml-auto hidden rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 dark:border-[#2a2a2a] dark:text-[#6f6f6f] xl:block">
          /
        </span>
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-3 w-[min(680px,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.16)] dark:border-[#1f1f1f] dark:bg-[#050505] dark:shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
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
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-[#8e8e8e]" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search actions, papers, projects, folders, docs..."
                aria-label="Search actions, papers, projects, folders, and documentation"
                className="h-11 w-full rounded-xl border border-transparent bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300 dark:bg-[#0a0a0a] dark:text-white dark:placeholder:text-[#6f6f6f] dark:focus:border-[#3a3a3a]"
              />
            </label>
          </form>

          {groupedResults.length > 0 ? (
            <div className="max-h-[460px] overflow-y-auto p-2">
              {groupedResults.map((group) => (
                <div key={group.category} className="py-1">
                  <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-normal text-slate-400 dark:text-[#6f6f6f]">
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
              No results found for "{deferredQuery.trim()}".
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
