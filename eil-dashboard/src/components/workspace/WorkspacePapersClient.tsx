"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDashboardData } from "@/hooks/useData";
import { filterDashboardData } from "@/lib/dashboard-filters";
import { TRACK_COLS } from "@/lib/constants";
import Sidebar from "@/components/Sidebar";
import PaperExplorer from "@/components/tabs/PaperExplorer";
import { CloseIcon, FilterIcon, SearchIcon } from "@/components/ui/Icons";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";

export default function WorkspacePapersClient() {
  const {
    selectedFolderId,
    selectedProjectId,
    setSelectedFolderId,
    folders,
    selectedYears,
    setSelectedYears,
    selectedTracks,
    setSelectedTracks,
    searchQuery,
    setSearchQuery,
  } = useWorkspaceProfile();
  const router = useRouter();
  const scopedFolderIds = useMemo(() => folders.map((folder) => folder.id), [folders]);
  const { data, loading, allYears } = useDashboardData(
    selectedFolderId,
    scopedFolderIds,
    {
      projectId: selectedProjectId,
      enabled: Boolean(selectedProjectId),
    }
  );
  const searchParams = useSearchParams();
  const [filterOpen, setFilterOpen] = useState(false);

  const linkedPaperId = useMemo(() => {
    const value = (searchParams.get("paperId") ?? "").trim();
    return value || null;
  }, [searchParams]);
  const drilldown = useMemo(() => {
    const track = (searchParams.get("track") ?? "").trim().toUpperCase();
    const year = (searchParams.get("year") ?? "").trim();
    const topic = (searchParams.get("topic") ?? "").trim();
    const keyword = (searchParams.get("keyword") ?? "").trim();
    const folder = (searchParams.get("folder") ?? "").trim();
    const paperIds = [
      ...new Set(
        (searchParams.get("paperIds") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      ),
    ];
    const query = paperIds.length > 0 ? "" : keyword || topic || "";
    const active = Boolean(track || year || query || folder || paperIds.length > 0);
    const parts = [
      track ? `Track: ${track}` : "",
      year ? `Year: ${year}` : "",
      keyword ? `Keyword: ${keyword}` : topic ? `Topic: ${topic}` : "",
      paperIds.length > 0 ? `${paperIds.length} linked paper${paperIds.length === 1 ? "" : "s"}` : "",
    ].filter(Boolean);

    return {
      active,
      track: TRACK_COLS.includes(track as (typeof TRACK_COLS)[number])
        ? track
        : "",
      year,
      query,
      folder,
      paperIds,
      label: parts.join(" | "),
      signature: [track, year, topic, keyword, folder, paperIds.join(",")].join("|"),
    };
  }, [searchParams]);

  useEffect(() => {
    if (allYears.length > 0 && selectedYears.length === 0) {
      setSelectedYears(allYears);
    }
  }, [allYears, selectedYears.length]);

  useEffect(() => {
    if (!drilldown.active) {
      return;
    }

    if (drilldown.folder && folders.some((folder) => folder.id === drilldown.folder)) {
      setSelectedFolderId(drilldown.folder);
    }
    if (drilldown.track) {
      setSelectedTracks([drilldown.track]);
    }
    if (drilldown.year) {
      setSelectedYears([drilldown.year]);
    }
    if (drilldown.query) {
      setSearchQuery(drilldown.query);
    } else if (drilldown.paperIds.length > 0) {
      setSearchQuery("");
    }
  }, [
    drilldown.active,
    drilldown.folder,
    drilldown.paperIds,
    drilldown.query,
    drilldown.signature,
    drilldown.track,
    drilldown.year,
    folders,
    setSearchQuery,
    setSelectedFolderId,
    setSelectedTracks,
    setSelectedYears,
  ]);

  function clearDrilldown() {
    setSearchQuery("");
    setSelectedTracks([...TRACK_COLS]);
    if (allYears.length > 0) {
      setSelectedYears(allYears);
    }
    router.replace("/workspace/papers");
  }

  const filteredData = useMemo(() => {
    if (!data) {
      return { trends: [], tracksSingle: [], tracksMulti: [] };
    }

    const base = filterDashboardData(data, selectedYears, selectedTracks, searchQuery);
    if (drilldown.paperIds.length === 0) {
      return base;
    }

    const allowedPaperIds = new Set(drilldown.paperIds);
    return {
      trends: base.trends.filter((row) => allowedPaperIds.has(row.paper_id)),
      tracksSingle: base.tracksSingle.filter((row) => allowedPaperIds.has(row.paper_id)),
      tracksMulti: base.tracksMulti.filter((row) => allowedPaperIds.has(row.paper_id)),
    };
  }, [data, drilldown.paperIds, searchQuery, selectedTracks, selectedYears]);

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
            className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-[#242424]"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#050505] dark:text-[#a3a3a3]">
            {selectedYears.length} year{selectedYears.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#050505] dark:text-[#a3a3a3]">
            {selectedTracks.length} track{selectedTracks.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
          >
            <FilterIcon className="h-4 w-4" />
            <span>Filters</span>
          </button>
        </div>
      </div>

      {drilldown.active ? (
        <section className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">Dashboard drilldown</p>
              <p className="mt-1 text-sky-700 dark:text-sky-300">
                {drilldown.label || "Showing papers from the selected chart segment."}
              </p>
            </div>
            <button
              type="button"
              onClick={clearDrilldown}
              className="inline-flex h-9 items-center rounded-full border border-sky-200 bg-white px-3 text-xs font-semibold text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-800 dark:bg-[#050505] dark:text-sky-200 dark:hover:bg-sky-950/50"
            >
              Clear
            </button>
          </div>
        </section>
      ) : null}

      <div className="min-w-0">
        {filterOpen && (
          <div className="fixed inset-0 z-40 bg-slate-950/45">
            <div className="ml-auto h-full w-full max-w-sm border-l border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505] xl:max-w-md">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-[#1f1f1f] sm:px-5">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Paper filters
                </p>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0]"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="h-[calc(100%-65px)] overflow-y-auto p-3 sm:p-4">
                <Sidebar
                  folders={folders}
                  selectedFolderIds={
                    selectedFolderId && selectedFolderId !== "all"
                      ? [selectedFolderId]
                      : []
                  }
                  allFoldersSelected={selectedFolderId === "all"}
                  onFolderChange={(folderIds, allSelected) =>
                    setSelectedFolderId(
                      allSelected || folderIds.length === 0 ? "all" : folderIds[0]
                    )
                  }
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
