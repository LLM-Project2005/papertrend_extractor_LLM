"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import AdaptiveDashboardTab from "@/components/dashboard/AdaptiveDashboardTab";
import Sidebar from "@/components/Sidebar";
import Overview from "@/components/tabs/Overview";
import TrendAnalysis from "@/components/tabs/TrendAnalysis";
import TrackAnalysis from "@/components/tabs/TrackAnalysis";
import KeywordExplorer from "@/components/tabs/KeywordExplorer";
import { CloseIcon, FilterIcon, SearchIcon } from "@/components/ui/Icons";
import { useDashboardData } from "@/hooks/useData";
import { TRACK_COLS, type TrackKey } from "@/lib/constants";
import { filterDashboardData } from "@/lib/dashboard-filters";
import { createDefaultVisualizationPlan } from "@/lib/visualization-plan";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import type { DashboardDataMode } from "@/types/database";
import type { VisualizationPlan } from "@/types/visualization";

const TAB_DEFINITIONS = [
  { key: "overview", label: "Overview" },
  { key: "trend_analysis", label: "Trend Analysis" },
  { key: "track_analysis", label: "Track Analysis" },
  { key: "keyword_explorer", label: "Keyword Explorer" },
  { key: "adaptive", label: "Adaptive" },
] as const;

const ADAPTIVE_PLAN_CACHE_PREFIX = "adaptive-plan-cache:v1";

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeTabKey(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/-/g, "_");
}

function parseSelectedFolderIds(
  searchParams: URLSearchParams,
  fallbackFolderId: string
): string[] {
  const raw = searchParams.get("folders");
  if (raw) {
    return [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  }

  if (fallbackFolderId && fallbackFolderId !== "all") {
    return [fallbackFolderId];
  }

  return [];
}

function FilterPanel({
  folders,
  selectedFolderIds,
  allFoldersSelected,
  onFolderChange,
  allYears,
  selectedYears,
  onYearsChange,
  selectedTracks,
  onTracksChange,
  useMock,
  showHeader = true,
}: {
  folders: ReturnType<typeof useWorkspaceProfile>["folders"];
  selectedFolderIds: string[];
  allFoldersSelected: boolean;
  onFolderChange: (folderIds: string[], allSelected: boolean) => void;
  allYears: string[];
  selectedYears: string[];
  onYearsChange: (years: string[]) => void;
  selectedTracks: string[];
  onTracksChange: (tracks: string[]) => void;
  useMock: boolean;
  showHeader?: boolean;
}) {
  return (
    <Sidebar
      folders={folders}
      selectedFolderIds={selectedFolderIds}
      allFoldersSelected={allFoldersSelected}
      onFolderChange={onFolderChange}
      allYears={allYears}
      selectedYears={selectedYears}
      onYearsChange={onYearsChange}
      selectedTracks={selectedTracks}
      onTracksChange={onTracksChange}
      useMock={useMock}
      title="Analytics filters"
      description="Choose folders, years, and tracks before reading the dashboard."
      showHeader={showHeader}
    />
  );
}

export default function DashboardClient({
  basePath = "/organizations",
}: {
  basePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    selectedFolderId,
    selectedProjectId,
    folders,
    selectedYears,
    setSelectedYears,
    selectedTracks,
    setSelectedTracks,
    searchQuery,
    setSearchQuery,
  } = useWorkspaceProfile();
  const { session } = useAuth();

  const scopedFolderIds = useMemo(() => folders.map((folder) => folder.id), [folders]);
  const selectedFolderIds = useMemo(
    () => parseSelectedFolderIds(searchParams, selectedFolderId),
    [searchParams, selectedFolderId]
  );
  const allFoldersSelected = selectedFolderIds.length === 0;
  const folderNamesById = useMemo(
    () =>
      Object.fromEntries(folders.map((folder) => [folder.id, folder.name] as const)),
    [folders]
  );
  const dashboardDataMode: DashboardDataMode =
    searchParams.get("data") === "mock"
      ? "mock"
      : searchParams.get("data") === "live"
        ? "live"
        : "auto";
  const { data, loading, refreshing, allYears, refresh } = useDashboardData(
    allFoldersSelected ? "all" : selectedFolderIds,
    scopedFolderIds,
    {
      mode: dashboardDataMode,
      projectId: selectedProjectId,
      refetchOnWindowFocus: false,
    }
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [planState, setPlanState] = useState<{
    plan: VisualizationPlan;
    source: "agent" | "fallback";
  } | null>(null);
  const lastPlanSignatureRef = useRef<string | null>(null);
  const liveDataError = data?.diagnostics?.errorMessage ?? null;

  useEffect(() => {
    if (allYears.length === 0) {
      return;
    }

    if (selectedYears.length === 0) {
      setSelectedYears(allYears);
      return;
    }

    const nextYears = selectedYears.filter((year) => allYears.includes(year));
    if (nextYears.length === 0) {
      setSelectedYears(allYears);
      return;
    }

    if (nextYears.length !== selectedYears.length) {
      setSelectedYears(nextYears);
    }
  }, [allYears, selectedYears, setSelectedYears]);

  const currentTabKey = useMemo(() => {
    const tabParam = normalizeTabKey(searchParams.get("tab"));
    if (tabParam && TAB_DEFINITIONS.some((tab) => tab.key === tabParam)) {
      return tabParam;
    }
    return "overview";
  }, [searchParams]);

  useEffect(() => {
    const tabParam = normalizeTabKey(searchParams.get("tab"));
    if (tabParam === currentTabKey) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", currentTabKey);
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${basePath}?${nextQuery}` : basePath, {
      scroll: false,
    });
  }, [basePath, currentTabKey, router, searchParams]);

  const updateRoute = (mutator: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutator(params);
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${basePath}?${nextQuery}` : basePath, {
      scroll: false,
    });
  };

  const updateRouteForTab = (tabKey: string) => {
    updateRoute((params) => {
      params.set("tab", tabKey);
    });
  };

  const updateFolderSelection = (folderIds: string[], allSelected: boolean) => {
    updateRoute((params) => {
      if (allSelected || folderIds.length === 0) {
        params.delete("folders");
      } else {
        params.set("folders", folderIds.join(","));
      }
    });
  };

  const updateDataMode = (mode: DashboardDataMode) => {
    updateRoute((params) => {
      if (mode === "auto") {
        params.delete("data");
      } else {
        params.set("data", mode);
      }
    });
  };

  const filteredData = useMemo(() => {
    if (!data) {
      return { trends: [], tracksSingle: [], tracksMulti: [], topicFamilies: [] };
    }

    return filterDashboardData(data, selectedYears, selectedTracks, searchQuery);
  }, [data, searchQuery, selectedTracks, selectedYears]);

  const adaptivePlanSignature = useMemo(() => {
    if (!data) {
      return null;
    }

    return stableSerialize({
      projectId: selectedProjectId ?? "all",
      mode: data.useMock ? "mock" : "live",
      diagnostics: data.diagnostics?.dataSource ?? null,
      folders: [...selectedFolderIds].sort(),
      selectedYears: [...selectedYears].sort(),
      selectedTracks: [...selectedTracks].sort(),
      searchQuery: searchQuery.trim(),
      trendRows: filteredData.trends.map((row) => ({
        paper_id: row.paper_id,
        folder_id: row.folder_id ?? null,
        year: row.year,
        topic: row.topic,
        keyword: row.keyword,
        keyword_frequency: row.keyword_frequency,
      })),
      topicFamilies: (filteredData.topicFamilies ?? []).map((family) => ({
        id: family.id,
        canonicalTopic: family.canonicalTopic,
        aliases: [...family.aliases].sort(),
        totalKeywordFrequency: family.totalKeywordFrequency,
        paperIds: [...family.paperIds].sort(),
      })),
      tracksSingle: filteredData.tracksSingle.map((row) => ({
        paper_id: row.paper_id,
        year: row.year,
        el: row.el,
        eli: row.eli,
        lae: row.lae,
        other: row.other,
      })),
    });
  }, [
    data,
    filteredData.topicFamilies,
    filteredData.tracksSingle,
    filteredData.trends,
    searchQuery,
    selectedFolderIds,
    selectedProjectId,
    selectedTracks,
    selectedYears,
  ]);

  useEffect(() => {
    if (!data || selectedYears.length === 0 || !adaptivePlanSignature) {
      return;
    }

    let cancelled = false;
    const includeFolderComparison =
      selectedFolderIds.length > 1 || (selectedFolderIds.length === 0 && folders.length > 1);
    const fallbackPlan = createDefaultVisualizationPlan(
      data.useMock ? "mock" : "live",
      selectedTracks as TrackKey[],
      includeFolderComparison
    );
    const cacheKey = [
      ADAPTIVE_PLAN_CACHE_PREFIX,
      session?.user?.id ?? "anonymous",
      selectedProjectId ?? "all",
      adaptivePlanSignature,
    ].join(":");

    try {
      const cachedValue = window.sessionStorage.getItem(cacheKey);
      if (cachedValue) {
        const parsed = JSON.parse(cachedValue) as {
          plan?: VisualizationPlan;
          source?: "agent" | "fallback";
        };
        if (parsed.plan) {
          setPlanState({
            plan: parsed.plan,
            source: parsed.source ?? "agent",
          });
          lastPlanSignatureRef.current = adaptivePlanSignature;
          return;
        }
      }
    } catch {
      // Ignore cache parsing issues and rebuild below.
    }

    if (lastPlanSignatureRef.current !== adaptivePlanSignature || !planState) {
      setPlanState((current) => current ?? { plan: fallbackPlan, source: "fallback" });
    }

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/visualization-plan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token
              ? { Authorization: `Bearer ${session.access_token}` }
              : {}),
          },
          body: JSON.stringify({
            selectedYears,
            selectedTracks,
            searchQuery,
            folderIds: selectedFolderIds,
            projectId: selectedProjectId,
          }),
        });
        const payload = (await response.json()) as {
          plan?: VisualizationPlan;
          source?: "agent" | "fallback";
        };

        if (!response.ok || !payload.plan || cancelled) {
          return;
        }

        const nextState = {
          plan: payload.plan,
          source: payload.source ?? "fallback",
        } as const;
        lastPlanSignatureRef.current = adaptivePlanSignature;
        setPlanState(nextState);
        try {
          window.sessionStorage.setItem(cacheKey, JSON.stringify(nextState));
        } catch {
          // Ignore cache write failures.
        }
      } catch {
        if (!cancelled) {
          lastPlanSignatureRef.current = adaptivePlanSignature;
          setPlanState({ plan: fallbackPlan, source: "fallback" });
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    data,
    adaptivePlanSignature,
    folders.length,
    planState,
    searchQuery,
    selectedFolderIds,
    selectedProjectId,
    selectedTracks,
    selectedYears,
    session?.access_token,
  ]);

  if (loading && !data) {
    return (
      <div className="app-surface flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-500 border-t-transparent dark:border-[#8e8e8e]" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Loading dashboard data...
          </p>
        </div>
      </div>
    );
  }

  const adaptiveSection = planState?.plan.sections[0] ?? null;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="space-y-4">
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
              {allFoldersSelected
                ? `All folders (${folders.length})`
                : `${selectedFolderIds.length} folder${
                    selectedFolderIds.length === 1 ? "" : "s"
                  }`}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#212121] dark:text-[#a3a3a3]">
              {selectedYears.length} year{selectedYears.length === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#212121] dark:text-[#a3a3a3]">
              {selectedTracks.length} track{selectedTracks.length === 1 ? "" : "s"}
            </span>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 dark:border-[#2f2f2f] dark:bg-[#212121] dark:text-[#bdbdbd]">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400 dark:text-[#8e8e8e]">
                Data
              </span>
              <select
                value={dashboardDataMode}
                onChange={(event) => updateDataMode(event.target.value as DashboardDataMode)}
                className="bg-transparent text-sm font-medium text-slate-700 outline-none dark:text-[#f2f2f2]"
                title="Choose whether the dashboard should recover gracefully, force workspace data, or use preview data."
              >
                <option value="auto">Smart</option>
                <option value="live">Workspace</option>
                <option value="mock">Preview</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                void refresh();
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#2f2f2f] dark:bg-[#212121] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
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

        <section className="app-surface px-4 py-4 sm:px-5">
          {liveDataError ? (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              Live dashboard data could not be loaded for this scope. {liveDataError}
            </div>
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
                Visualization planner
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-[#f2f2f2]">
                {planState?.plan.dashboard_title ??
                  (data?.useMock ? "Preview adaptive workspace" : "Adaptive analytics workspace")}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
                {planState?.plan.summary ??
                  "Adaptive charts focus on the strongest normalized corpus signals for the current filters."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#212121] dark:text-[#a3a3a3]">
                {data?.useMock ? "Preview data" : "Live data"}
              </span>
              {refreshing ? (
                <span className="rounded-full bg-sky-100 px-3 py-1.5 text-xs text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                  Refreshing in background
                </span>
              ) : null}
              {data?.diagnostics?.recoveredFromLegacyScope ? (
                <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  Showing recovered legacy analyses
                </span>
              ) : null}
              <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#212121] dark:text-[#a3a3a3]">
                {planState?.source === "agent" ? "Adaptive plan" : "Fallback plan"}
              </span>
            </div>
          </div>
        </section>

        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Tabs">
          {TAB_DEFINITIONS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => updateRouteForTab(tab.key)}
              className={`tab-btn ${
                currentTabKey === tab.key ? "tab-btn-active" : "tab-btn-inactive"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-w-0">
        {filterOpen && (
          <div className="fixed inset-0 z-40 bg-black/55 xl:hidden">
            <div className="ml-auto h-full w-full max-w-sm border-l border-slate-200 bg-white dark:border-[#2c2c2c] dark:bg-[#1d1d1d] xl:max-w-md">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-[#2c2c2c] sm:px-5">
                <p className="text-sm font-medium text-slate-900 dark:text-[#ececec]">
                  Analytics filters
                </p>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#353535] dark:bg-[#232323] dark:text-[#d0d0d0]"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="h-[calc(100%-65px)] overflow-y-auto p-3 sm:p-4">
                <FilterPanel
                  folders={folders}
                  selectedFolderIds={selectedFolderIds}
                  allFoldersSelected={allFoldersSelected}
                  onFolderChange={updateFolderSelection}
                  allYears={allYears}
                  selectedYears={selectedYears}
                  onYearsChange={setSelectedYears}
                  selectedTracks={selectedTracks}
                  onTracksChange={setSelectedTracks}
                  useMock={data?.useMock ?? true}
                  showHeader={false}
                />
              </div>
            </div>
          </div>
        )}

        {filterOpen && (
          <div
            className="fixed inset-0 z-30 hidden bg-transparent xl:block"
            onClick={() => setFilterOpen(false)}
          />
        )}

        <div className="hidden xl:block">
          <div
            className={`fixed right-6 top-[124px] z-40 hidden w-full max-w-sm xl:block ${
              filterOpen ? "" : "pointer-events-none opacity-0"
            } transition-all`}
          >
            <div className="rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-[#2c2c2c]">
                <p className="text-sm font-medium text-slate-900 dark:text-[#ececec]">
                  Analytics filters
                </p>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#353535] dark:bg-[#232323] dark:text-[#d0d0d0]"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto p-4">
                <FilterPanel
                  folders={folders}
                  selectedFolderIds={selectedFolderIds}
                  allFoldersSelected={allFoldersSelected}
                  onFolderChange={updateFolderSelection}
                  allYears={allYears}
                  selectedYears={selectedYears}
                  onYearsChange={setSelectedYears}
                  selectedTracks={selectedTracks}
                  onTracksChange={setSelectedTracks}
                  useMock={data?.useMock ?? true}
                  showHeader={false}
                />
              </div>
            </div>
          </div>
        </div>

        <section className="min-w-0">
          {currentTabKey === "overview" ? (
            <Overview
              trends={filteredData.trends}
              tracksSingle={filteredData.tracksSingle}
              tracksMulti={filteredData.tracksMulti}
              selectedTracks={selectedTracks}
              useMock={data?.useMock ?? true}
            />
          ) : null}
          {currentTabKey === "trend_analysis" ? (
            <TrendAnalysis trends={filteredData.trends} />
          ) : null}
          {currentTabKey === "track_analysis" ? (
            <TrackAnalysis
              trends={filteredData.trends}
              tracksSingle={filteredData.tracksSingle}
              tracksMulti={filteredData.tracksMulti}
              selectedTracks={selectedTracks}
            />
          ) : null}
          {currentTabKey === "keyword_explorer" ? (
            <KeywordExplorer
              trends={filteredData.trends}
              topicFamilies={filteredData.topicFamilies}
              folderIds={selectedFolderIds}
              projectId={selectedProjectId ?? undefined}
              selectedYears={selectedYears}
              selectedTracks={selectedTracks}
            />
          ) : null}
          {currentTabKey === "adaptive" && adaptiveSection ? (
            <AdaptiveDashboardTab
              data={filteredData}
              adaptiveSection={adaptiveSection}
              folderNamesById={folderNamesById}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
