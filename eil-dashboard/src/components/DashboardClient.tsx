"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import PlannedDashboardSection from "@/components/dashboard/PlannedDashboardSection";
import { useDashboardData } from "@/hooks/useData";
import { TRACK_COLS } from "@/lib/constants";
import { filterDashboardData } from "@/lib/dashboard-filters";
import { createDefaultVisualizationPlan } from "@/lib/visualization-plan";
import Sidebar from "@/components/Sidebar";
import Overview from "@/components/tabs/Overview";
import TrendAnalysis from "@/components/tabs/TrendAnalysis";
import TrackAnalysis from "@/components/tabs/TrackAnalysis";
import KeywordExplorer from "@/components/tabs/KeywordExplorer";
import PaperExplorer from "@/components/tabs/PaperExplorer";
import { CloseIcon, FilterIcon, SearchIcon } from "@/components/ui/Icons";
import type { TrackKey } from "@/lib/constants";
import type { VisualizationPlan } from "@/types/visualization";

const STATIC_TAB_DEFINITIONS = [
  { key: "overview", label: "Overview" },
  { key: "trend_analysis", label: "Trend Analysis" },
  { key: "track_analysis", label: "Track Analysis" },
  { key: "keyword_explorer", label: "Keyword Explorer" },
  { key: "paper_explorer", label: "Paper Explorer" },
] as const;

function normalizeTabKey(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/-/g, "_");
}

function FilterPanel({
  folders,
  selectedFolderId,
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
  selectedFolderId: string;
  onFolderChange: (folderId: string) => void;
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
      selectedFolderId={selectedFolderId}
      onFolderChange={onFolderChange}
      allYears={allYears}
      selectedYears={selectedYears}
      onYearsChange={onYearsChange}
      selectedTracks={selectedTracks}
      onTracksChange={onTracksChange}
      useMock={useMock}
      title="Analytics filters"
      description="Narrow the years and track categories before reading the dashboard."
      showHeader={showHeader}
    />
  );
}

export default function DashboardClient({
  basePath = "/workspace/dashboard",
}: {
  basePath?: string;
}) {
  const {
    selectedFolderId,
    folders,
    setSelectedFolderId,
    selectedYears,
    setSelectedYears,
    selectedTracks,
    setSelectedTracks,
    searchQuery,
    setSearchQuery,
  } = useWorkspaceProfile();
  const scopedFolderIds = useMemo(() => folders.map((folder) => folder.id), [folders]);
  const { data, loading, allYears } = useDashboardData(
    selectedFolderId,
    scopedFolderIds
  );
  const { session } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filterOpen, setFilterOpen] = useState(false);
  const [planState, setPlanState] = useState<{
    plan: VisualizationPlan;
    source: "agent" | "fallback";
  } | null>(null);

  const linkedPaperId = useMemo(() => {
    const value = Number.parseInt(searchParams.get("paperId") ?? "", 10);
    return Number.isFinite(value) ? value : null;
  }, [searchParams]);
  const plannerMode = searchParams.get("planner") === "classic" ? "classic" : "agent";
  useEffect(() => {
    if (allYears.length > 0 && selectedYears.length === 0) {
      setSelectedYears(allYears);
    }
  }, [allYears, selectedYears.length]);

  useEffect(() => {
    if (!data || selectedYears.length === 0 || plannerMode !== "agent") {
      return;
    }

    let cancelled = false;
    const fallbackPlan = createDefaultVisualizationPlan(
      data.useMock ? "mock" : "live",
      selectedTracks as TrackKey[]
    );

    if (!planState) {
      setPlanState({ plan: fallbackPlan, source: "fallback" });
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
            folderId: selectedFolderId,
          }),
        });

        const payload = (await response.json()) as {
          plan?: VisualizationPlan;
          source?: "agent" | "fallback";
        };

        if (!response.ok || !payload.plan || cancelled) {
          return;
        }

        setPlanState({
          plan: payload.plan,
          source: payload.source ?? "fallback",
        });
      } catch {
        if (!cancelled) {
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
    planState,
    plannerMode,
    searchQuery,
    selectedFolderId,
    selectedTracks,
    selectedYears,
    session?.access_token,
  ]);

  const fallbackPlan = useMemo(
    () =>
      createDefaultVisualizationPlan(
        data?.useMock ? "mock" : "live",
        selectedTracks as TrackKey[]
      ),
    [data?.useMock, selectedTracks]
  );

  const activePlan = plannerMode === "agent" ? planState?.plan ?? fallbackPlan : null;
  const tabDefinitions = plannerMode === "agent"
    ? (activePlan?.sections.map((section) => ({
        key: section.section_key,
        label: section.title,
      })) ?? STATIC_TAB_DEFINITIONS)
    : STATIC_TAB_DEFINITIONS;

  const currentTabKey = useMemo(() => {
    const tabParam = normalizeTabKey(searchParams.get("tab"));
    if (tabParam && tabDefinitions.some((tab) => tab.key === tabParam)) {
      return tabParam;
    }

    return tabDefinitions[0]?.key ?? "overview";
  }, [searchParams, tabDefinitions]);

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

  const updateRouteForTab = (tabKey: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tabKey);
    if (tabKey !== "paper_explorer") {
      params.delete("paperId");
    }
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${basePath}?${nextQuery}` : basePath, {
      scroll: false,
    });
  };

  const updatePlannerMode = (mode: "agent" | "classic") => {
    const params = new URLSearchParams(searchParams.toString());
    if (mode === "classic") {
      params.set("planner", "classic");
    } else {
      params.delete("planner");
    }

    const nextQuery = params.toString();
    router.replace(nextQuery ? `${basePath}?${nextQuery}` : basePath, {
      scroll: false,
    });
  };

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
            Loading dashboard data...
          </p>
        </div>
      </div>
    );
  }

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
              {selectedYears.length} year{selectedYears.length === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#212121] dark:text-[#a3a3a3]">
              {selectedTracks.length} track{selectedTracks.length === 1 ? "" : "s"}
            </span>
            <div className="inline-flex overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#2f2f2f] dark:bg-[#212121]">
              <button
                type="button"
                onClick={() => updatePlannerMode("agent")}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  plannerMode === "agent"
                    ? "bg-slate-900 text-white dark:bg-white dark:text-[#171717]"
                    : "text-slate-600 hover:bg-slate-50 dark:text-[#bdbdbd] dark:hover:bg-[#262626]"
                }`}
              >
                Adaptive
              </button>
              <button
                type="button"
                onClick={() => updatePlannerMode("classic")}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  plannerMode === "classic"
                    ? "bg-slate-900 text-white dark:bg-white dark:text-[#171717]"
                    : "text-slate-600 hover:bg-slate-50 dark:text-[#bdbdbd] dark:hover:bg-[#262626]"
                }`}
              >
                Classic
              </button>
            </div>
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

        {plannerMode === "agent" && activePlan ? (
          <section className="app-surface px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
                  Visualization planner
                </p>
                <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-[#f2f2f2]">
                  {activePlan.dashboard_title}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
                  {activePlan.summary}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#212121] dark:text-[#a3a3a3]">
                {planState?.source === "agent" ? "LLM plan" : "Fallback plan"}
              </span>
            </div>
          </section>
        ) : null}

        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Tabs">
          {tabDefinitions.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                updateRouteForTab(tab.key);
              }}
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
                  selectedFolderId={selectedFolderId}
                  onFolderChange={setSelectedFolderId}
                  allYears={allYears}
                  selectedYears={selectedYears}
                  onYearsChange={setSelectedYears}
                  selectedTracks={selectedTracks}
                  onTracksChange={setSelectedTracks}
                  useMock={data.useMock}
                  showHeader={false}
                />
              </div>
            </div>
          </div>
        )}

        {filterOpen && (
          <div className="fixed inset-0 z-30 hidden bg-transparent xl:block" onClick={() => setFilterOpen(false)} />
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
                  selectedFolderId={selectedFolderId}
                  onFolderChange={setSelectedFolderId}
                  allYears={allYears}
                  selectedYears={selectedYears}
                  onYearsChange={setSelectedYears}
                  selectedTracks={selectedTracks}
                  onTracksChange={setSelectedTracks}
                  useMock={data.useMock}
                  showHeader={false}
                />
              </div>
            </div>
          </div>
        </div>

        <section className="min-w-0">
          {plannerMode === "agent" && activePlan ? (
            <PlannedDashboardSection
              section={
                activePlan.sections.find((section) => section.section_key === currentTabKey) ??
                activePlan.sections[0]
              }
              data={filteredData}
              folderId={selectedFolderId}
              selectedYears={selectedYears}
              selectedTracks={selectedTracks}
              linkedPaperId={linkedPaperId}
              useMock={data.useMock}
            />
          ) : null}

          {plannerMode === "classic" && currentTabKey === "overview" ? (
            <Overview
              trends={filteredData.trends}
              tracksSingle={filteredData.tracksSingle}
              tracksMulti={filteredData.tracksMulti}
              selectedTracks={selectedTracks}
              useMock={data.useMock}
            />
          ) : null}
          {plannerMode === "classic" && currentTabKey === "trend_analysis" ? (
            <TrendAnalysis trends={filteredData.trends} />
          ) : null}
          {plannerMode === "classic" && currentTabKey === "track_analysis" ? (
            <TrackAnalysis
              trends={filteredData.trends}
              tracksSingle={filteredData.tracksSingle}
              tracksMulti={filteredData.tracksMulti}
              selectedTracks={selectedTracks}
            />
          ) : null}
          {plannerMode === "classic" && currentTabKey === "keyword_explorer" ? (
            <KeywordExplorer
              trends={filteredData.trends}
              folderId={selectedFolderId}
              selectedYears={selectedYears}
              selectedTracks={selectedTracks}
            />
          ) : null}
          {plannerMode === "classic" && currentTabKey === "paper_explorer" ? (
            <PaperExplorer
              trends={filteredData.trends}
              tracksSingle={filteredData.tracksSingle}
              linkedPaperId={linkedPaperId}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
