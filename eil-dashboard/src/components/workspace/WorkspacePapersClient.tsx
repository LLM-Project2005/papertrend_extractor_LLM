"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDashboardData } from "@/hooks/useData";
import { filterDashboardData } from "@/lib/dashboard-filters";
import Sidebar from "@/components/Sidebar";
import PaperExplorer from "@/components/tabs/PaperExplorer";
import { CloseIcon, FilterIcon, SearchIcon } from "@/components/ui/Icons";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";

export default function WorkspacePapersClient() {
  const {
    selectedFolderId,
    setSelectedFolderId,
    folders,
    selectedYears,
    setSelectedYears,
    selectedTracks,
    setSelectedTracks,
    searchQuery,
    setSearchQuery,
  } = useWorkspaceProfile();
  const { data, loading, allYears } = useDashboardData(selectedFolderId);
  const searchParams = useSearchParams();
  const [filterOpen, setFilterOpen] = useState(false);

  const linkedPaperId = useMemo(() => {
    const value = Number.parseInt(searchParams.get("paperId") ?? "", 10);
    return Number.isFinite(value) ? value : null;
  }, [searchParams]);

  useEffect(() => {
    if (allYears.length > 0 && selectedYears.length === 0) {
      setSelectedYears(allYears);
    }
  }, [allYears, selectedYears.length]);

  const filteredData = useMemo(() => {
    if (!data) {
      return { trends: [], tracksSingle: [], tracksMulti: [] };
    }

    return filterDashboardData(data, selectedYears, selectedTracks, searchQuery);
  }, [data, searchQuery, selectedTracks, selectedYears]);

  if (loading || !data) {
    return (
      <div className="app-surface flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-500 border-t-transparent dark:border-[#8e8e8e]" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Loading paper library...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative block w-full max-w-2xl">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-[#8e8e8e]" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search papers, topics, keywords, or years"
            className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#212121] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-white/10"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#212121] dark:text-[#a3a3a3]">
            {selectedYears.length} year{selectedYears.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#212121] dark:text-[#a3a3a3]">
            {selectedTracks.length} track{selectedTracks.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#2f2f2f] dark:bg-[#212121] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
          >
            <FilterIcon className="h-4 w-4" />
            <span>Filters</span>
          </button>
        </div>
      </div>

      <div className="min-w-0">
        {filterOpen && (
          <div className="fixed inset-0 z-40 bg-slate-950/45">
            <div className="ml-auto h-full w-full max-w-sm border-l border-slate-200 bg-white dark:border-[#2f2f2f] dark:bg-[#212121] xl:max-w-md">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-[#2f2f2f] sm:px-5">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Paper filters
                </p>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#353535] dark:bg-[#171717] dark:text-[#d0d0d0]"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="h-[calc(100%-65px)] overflow-y-auto p-3 sm:p-4">
                <Sidebar
                  folders={folders}
                  selectedFolderId={selectedFolderId}
                  onFolderChange={setSelectedFolderId}
                  allYears={allYears}
                  selectedYears={selectedYears}
                  onYearsChange={setSelectedYears}
                  selectedTracks={selectedTracks}
                  onTracksChange={setSelectedTracks}
                  useMock={data.useMock}
                  title="Paper filters"
                  description="Filter the library before reviewing titles, keywords, evidence, and track assignments."
                />
              </div>
            </div>
          </div>
        )}

        <section className="min-w-0">
          <PaperExplorer
            trends={filteredData.trends}
            tracksSingle={filteredData.tracksSingle}
            linkedPaperId={linkedPaperId}
          />
        </section>
      </div>
    </div>
  );
}
