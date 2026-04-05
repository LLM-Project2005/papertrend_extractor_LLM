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
import { SearchIcon } from "@/components/ui/Icons";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";

interface SearchPageItem {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  keywords?: string[];
  featured?: boolean;
}

interface SearchResult {
  id: string;
  label: string;
  description: string;
  category: "Pages" | "Organizations" | "Projects" | "Folders";
  icon: ComponentType<{ className?: string }>;
  featured?: boolean;
  searchText: string;
  onSelect: () => void;
}

const CATEGORY_ORDER: SearchResult["category"][] = [
  "Pages",
  "Organizations",
  "Projects",
  "Folders",
];

function includesQuery(value: string, query: string) {
  return value.toLowerCase().includes(query);
}

export default function WorkspaceGlobalSearch({
  pageItems,
}: {
  pageItems: SearchPageItem[];
}) {
  const router = useRouter();
  const {
    organizations,
    allProjects,
    allFolders,
    currentOrganization,
    currentProject,
    setSelectedOrganizationId,
    setSelectedProjectId,
    setSelectedFolderId,
  } = useWorkspaceProfile();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
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

  const projectById = useMemo(
    () => new Map(allProjects.map((project) => [project.id, project])),
    [allProjects]
  );
  const organizationIcon =
    pageItems.find((item) => item.id === "organizations")?.icon ?? SearchIcon;
  const projectIcon =
    pageItems.find((item) => item.id === "project-overview")?.icon ?? SearchIcon;
  const folderIcon =
    pageItems.find((item) => item.id === "library")?.icon ?? SearchIcon;

  const searchResults = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    const results: SearchResult[] = [
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
      ...organizations.map((organization) => ({
        id: `organization:${organization.id}`,
        label: organization.name,
        description: "Open this organization and its projects",
        category: "Organizations" as const,
        icon: organizationIcon,
        featured: currentOrganization?.id === organization.id,
        searchText: `${organization.name} ${organization.type.replace(/_/g, " ")}`,
        onSelect: () => {
          setSelectedOrganizationId(organization.id);
          router.push(`/organizations/${organization.id}/projects`);
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
          searchText: `${project.name} ${project.description ?? ""} ${organization?.name ?? ""}`,
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
            searchText: `${folder.name} ${folder.description ?? ""} ${project?.name ?? ""}`,
            onSelect: () => {
              if (folder.project_id) {
                setSelectedProjectId(folder.project_id);
              }
              setSelectedFolderId(folder.id);
              router.push("/workspace/library");
            },
          };
        }),
    ];

    if (!normalizedQuery) {
      return results.filter((result) => result.featured).slice(0, 8);
    }

    return results
      .filter((result) => includesQuery(result.searchText, normalizedQuery))
      .slice(0, 12);
  }, [
    allFolders,
    allProjects,
    currentOrganization?.id,
    currentProject?.id,
    deferredQuery,
    folderIcon,
    organizations,
    pageItems,
    projectById,
    projectIcon,
    router,
    setSelectedFolderId,
    setSelectedOrganizationId,
    setSelectedProjectId,
    organizationIcon,
  ]);

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
    <div ref={containerRef} className="relative w-full">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (searchResults[0]) {
            handleSelect(searchResults[0]);
          }
        }}
        className="relative"
      >
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-[#8e8e8e]" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search anything"
          aria-label="Search anything in the workspace"
          className="h-10 w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-11 pr-4 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300 dark:border-[#353535] dark:bg-[#171717] dark:text-white dark:placeholder:text-[#6f6f6f] dark:focus:border-[#4a4a4a]"
        />
      </form>

      {open ? (
        <div className="absolute left-0 right-0 z-50 mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.16)] dark:border-[#2f2f2f] dark:bg-[#171717] dark:shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
          {groupedResults.length > 0 ? (
            <div className="max-h-[420px] overflow-y-auto p-2">
              {groupedResults.map((group) => (
                <div key={group.category} className="py-1">
                  <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
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
                          className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-slate-100 dark:hover:bg-[#202020]"
                        >
                          <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 dark:border-[#2f2f2f] dark:bg-[#1e1e1e] dark:text-[#d0d0d0]">
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
