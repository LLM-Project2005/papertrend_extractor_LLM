"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import InsightsTab from "@/components/dashboard/InsightsTab";
import { usePaperViewer } from "@/components/workspace/PaperViewerProvider";
import RepositorySemanticMapView from "@/components/workspace/RepositorySemanticMap";
import Sidebar from "@/components/Sidebar";
import Overview from "@/components/tabs/Overview";
import TrendAnalysis from "@/components/tabs/TrendAnalysis";
import TrackAnalysis from "@/components/tabs/TrackAnalysis";
import KeywordExplorer from "@/components/tabs/KeywordExplorer";
import Modal, { useDialogLayer } from "@/components/ui/Modal";
import { useIsNarrow } from "@/lib/use-narrow";
import { TabIndicator, useTabIndicator } from "@/components/ui/TabIndicator";
import { CloseIcon, FilterIcon, SearchIcon } from "@/components/ui/Icons";
import { useDashboardData } from "@/hooks/useData";
import { TRACK_COLS, TRACK_NAMES, type TrackKey } from "@/lib/constants";
import { readCategoryLabelMap } from "@/lib/analysis-profile";
import { buildCategoryOptions, normalizeCategoryKey } from "@/lib/category-options";
import { filterDashboardData } from "@/lib/dashboard-filters";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import type { PaperId, TrackRow, TrendRow } from "@/types/database";
import { explicitDrilldownIds } from "@/lib/dashboard-drilldown";

const TAB_DEFINITIONS = [
  { key: "overview", label: "Overview" },
  { key: "trend_analysis", label: "Trend Analysis" },
  { key: "track_analysis", label: "Category Analysis" },
  { key: "keyword_explorer", label: "Keyword Explorer" },
  { key: "semantic_map", label: "Semantic Map" },
  { key: "adaptive", label: "Adaptive" },
] as const;

const EMPTY_FOLDER_FILTER: string[] = [];

type DashboardDrilldownTarget = {
  track?: string;
  year?: string;
  topic?: string;
  keyword?: string;
  paperIds?: string[];
  /** Names the list when it is the papers behind an insight. */
  label?: string;
};

type DashboardDrilldownPaper = {
  paperId: PaperId;
  title: string;
  year: string;
  /** The paper's own topic label, and the theme it was grouped under. */
  topics: Array<{ label: string; theme: string }>;
  keywords: string[];
  tracks: string[];
  evidence: string;
};

function normalizeTabKey(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/-/g, "_");
}

function normalizeTrackKey(value: string | null | undefined): TrackKey | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  const direct = TRACK_COLS.find((track) => track === normalized);
  if (direct) {
    return direct as TrackKey;
  }

  return (
    TRACK_COLS.find((track) =>
      normalized.startsWith(`${track} `) || normalized.startsWith(`${track} -`)
    ) as TrackKey | undefined
  ) ?? null;
}

function normalizeDrilldownCategoryKey(value: string | null | undefined): string | null {
  const cleaned = normalizeCategoryKey(String(value ?? ""));
  return cleaned || normalizeTrackKey(value);
}

function trackLabelsForRow(
  row: TrackRow | undefined,
  categoryLabels: Record<TrackKey, string>
): string[] {
  if (!row) {
    return [];
  }

  return TRACK_COLS.filter((track) => {
    const field = track.toLowerCase() as keyof TrackRow;
    return Number(row[field] ?? 0) > 0;
  }).map((track) => categoryLabels[track as TrackKey] || TRACK_NAMES[track as TrackKey]);
}

function matchesTrack(row: TrackRow | undefined, track: TrackKey | null): boolean {
  if (!track) {
    return true;
  }
  if (!row) {
    return false;
  }
  const field = track.toLowerCase() as keyof TrackRow;
  return Number(row[field] ?? 0) > 0;
}

function buildDashboardDrilldownTitle(
  target: DashboardDrilldownTarget | null,
  categoryLabel: (key: string) => string
): string {
  if (!target) {
    return "Associated papers";
  }
  if (target.label) {
    return target.label;
  }

  // The category is named as the reader knows it ("English Language
  // Instruction"), not by its internal key ("eli").
  const parts = [
    target.track ? `Category: ${categoryLabel(target.track)}` : "",
    target.year ? `Year: ${target.year}` : "",
    target.keyword ? `Keyword: ${target.keyword}` : target.topic ? `Topic: ${target.topic}` : "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" | ") : "Associated papers";
}

function FilterPanel({
  allYears,
  selectedYears,
  onYearsChange,
  selectedTracks,
  onTracksChange,
  categoryOptions,
  useMock,
  showHeader = true,
  showCategories = true,
}: {
  allYears: string[];
  selectedYears: string[];
  onYearsChange: (years: string[]) => void;
  selectedTracks: string[];
  onTracksChange: (tracks: string[]) => void;
  categoryOptions: ReturnType<typeof buildCategoryOptions>;
  useMock: boolean;
  showHeader?: boolean;
  showCategories?: boolean;
}) {
  return (
    <Sidebar
      allYears={allYears}
      selectedYears={selectedYears}
      onYearsChange={onYearsChange}
      selectedTracks={selectedTracks}
      onTracksChange={onTracksChange}
      categoryOptions={categoryOptions}
      useMock={useMock}
      title="Analytics filters"
      description="Choose years and categories before reading the dashboard."
      showHeader={showHeader}
      showFolders={false}
      showCategories={showCategories}
    />
  );
}

export default function DashboardClient({
  basePath = "/workspace/dashboard",
}: {
  basePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    selectedProjectId,
    workspaceLoading,
    currentProject,
    profile,
    folders,
    selectedYears,
    setSelectedYears,
    selectedTracks,
    setSelectedTracks,
    searchQuery,
    setSearchQuery,
  } = useWorkspaceProfile();
  const { session } = useAuth();
  const paperViewer = usePaperViewer();
  const categoryLabels = useMemo(() => readCategoryLabelMap(profile), [profile]);

  const scopedFolderIds = useMemo(() => folders.map((folder) => folder.id), [folders]);
  const selectedFolderIds = EMPTY_FOLDER_FILTER;
  // No data mode is read from the URL. "?data=mock" used to serve invented
  // topics to a signed-in reader through a v1 debugging dropdown.
  const { data, loading, refreshing, allYears, refresh } = useDashboardData(
    "all",
    scopedFolderIds,
    {
      mode: "auto",
      projectId: selectedProjectId,
      enabled: Boolean(selectedProjectId),
      refetchOnWindowFocus: false,
    }
  );
  // The server says whether this repository classifies papers; before data
  // arrives, the repository's own profile does.
  const classificationEnabled =
    data?.classificationEnabled ?? currentProject?.analysis_profile?.classificationEnabled ?? true;
  const categoryOptions = useMemo(
    () => (classificationEnabled ? buildCategoryOptions(data, profile, categoryLabels) : []),
    [categoryLabels, classificationEnabled, data, profile]
  );
  // The saved selection starts as the four legacy slots (EL, ELI, LAE,
  // Other). In a repository with its own categories only "Other" matched, so
  // the category charts showed nothing and the chip read "1 category". Until
  // the reader chooses, the selection means every category of this repository.
  const effectiveSelectedTracks = useMemo(() => {
    const keys = categoryOptions.map((category) => category.key);
    if (keys.length === 0) return selectedTracks;
    const untouched = TRACK_COLS.every((track) => selectedTracks.includes(track));
    const chosen = selectedTracks.map((track) => normalizeCategoryKey(track)).filter((key) => keys.includes(key));
    return untouched || chosen.length === 0 ? keys : chosen;
  }, [categoryOptions, selectedTracks]);
  const activeCategoryCount = effectiveSelectedTracks.length;
  const themeStatus = data?.topicThemes ?? null;
  const [filterOpen, setFilterOpen] = useState(false);
  const filterSheetRef = useRef<HTMLDivElement>(null);
  // Below xl the filters open as a sheet over the page, a dialog layer; from
  // xl they are a side panel and the sheet is hidden, so it takes nothing.
  const filterSheetIsOverlay = useIsNarrow(1280);
  const [drilldownTarget, setDrilldownTarget] = useState<DashboardDrilldownTarget | null>(null);
  const previousAllYearsRef = useRef<string[]>([]);
  const liveDataError = data?.diagnostics?.errorMessage ?? null;

  useEffect(() => {
    const previousAllYears = previousAllYearsRef.current;
    const previousAllYearSet = new Set(previousAllYears);
    const hadAllYearsSelectedPreviously =
      previousAllYears.length > 0 &&
      selectedYears.length === previousAllYears.length &&
      selectedYears.every((year) => previousAllYearSet.has(year));

    if (allYears.length === 0) {
      previousAllYearsRef.current = allYears;
      return;
    }

    if (selectedYears.length === 0) {
      previousAllYearsRef.current = allYears;
      return;
    }

    if (hadAllYearsSelectedPreviously) {
      setSelectedYears(allYears);
      previousAllYearsRef.current = allYears;
      return;
    }

    const nextYears = selectedYears.filter((year) => allYears.includes(year));
    if (nextYears.length === 0) {
      setSelectedYears([]);
      previousAllYearsRef.current = allYears;
      return;
    }

    if (nextYears.length !== selectedYears.length) {
      setSelectedYears(nextYears);
      previousAllYearsRef.current = allYears;
      return;
    }

    previousAllYearsRef.current = allYears;
  }, [allYears, selectedYears, setSelectedYears]);

  const [isRoutePending, startRouteTransition] = useTransition();
  const routeTabKey = useMemo(() => {
    const tabParam = normalizeTabKey(searchParams.get("tab"));
    if (tabParam && TAB_DEFINITIONS.some((tab) => tab.key === tabParam)) {
      return tabParam;
    }
    return "overview";
  }, [searchParams]);
  const [optimisticTabKey, setOptimisticTabKey] = useState(routeTabKey);
  const currentTabKey = optimisticTabKey;
  const isSemanticMapTab = currentTabKey === "semantic_map";
  useDialogLayer(filterOpen && filterSheetIsOverlay && !isSemanticMapTab, filterSheetRef, () => setFilterOpen(false));
  const [tabNav, setTabNav] = useState<HTMLElement | null>(null);
  const tabBox = useTabIndicator(tabNav, currentTabKey);
  const requestHeaders = useMemo<Record<string, string>>(
    (): Record<string, string> => session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {},
    [session?.access_token]
  );

  useEffect(() => {
    setOptimisticTabKey(routeTabKey);
  }, [routeTabKey]);

  useEffect(() => {
    const tabParam = normalizeTabKey(searchParams.get("tab"));
    if (tabParam === routeTabKey) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", routeTabKey);
    const nextQuery = params.toString();
    startRouteTransition(() => {
      router.replace(nextQuery ? `${basePath}?${nextQuery}` : basePath, {
        scroll: false,
      });
    });
  }, [basePath, routeTabKey, router, searchParams, startRouteTransition]);

  const updateRoute = (mutator: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutator(params);
    const nextQuery = params.toString();
    startRouteTransition(() => {
      router.replace(nextQuery ? `${basePath}?${nextQuery}` : basePath, {
        scroll: false,
      });
    });
  };

  const updateRouteForTab = (tabKey: string) => {
    setOptimisticTabKey(tabKey);
    updateRoute((params) => {
      params.set("tab", tabKey);
    });
  };

  const openPaperDrilldown = (target: DashboardDrilldownTarget) => {
    setDrilldownTarget(target);
  };

  const filteredData = useMemo(() => {
    if (!data) {
      return {
        trends: [],
        tracksSingle: [],
        tracksMulti: [],
        categoryAssignments: [],
        topicFamilies: [],
      };
    }

    return filterDashboardData(
      data,
      selectedYears,
      selectedTracks,
      searchQuery,
      categoryOptions.map((category) => category.key)
    );
  }, [categoryOptions, data, searchQuery, selectedTracks, selectedYears]);

  const adaptiveDataVersion = `${data?.trends.length ?? 0}:${data?.categoryAssignments?.length ?? 0}:${data?.topicThemes?.status ?? ""}:${data?.topicThemes?.ungroupedTopics ?? 0}:${refreshing ? 1 : 0}`;

  const drilldownPapers = useMemo<DashboardDrilldownPaper[]>(() => {
    if (!drilldownTarget) {
      return [];
    }

    const inView = new Set<string>([
      ...filteredData.trends.map((row) => row.paper_id),
      ...filteredData.tracksSingle.map((row) => row.paper_id),
      ...filteredData.tracksMulti.map((row) => row.paper_id),
      ...(filteredData.categoryAssignments ?? []).map((row) => row.paper_id),
    ]);
    // The chart said which papers it counted: exactly those are listed, with
    // no rule of the list's own on top (docs/32, 2.8).
    const explicitPaperIds = explicitDrilldownIds(drilldownTarget, inView);
    const hasExplicitPaperIds = explicitPaperIds !== null;
    const track = normalizeTrackKey(drilldownTarget.track);
    const categoryKey = normalizeDrilldownCategoryKey(drilldownTarget.track);
    const categoryLabelByKey = new Map(
      categoryOptions.map((category) => [category.key, category.label])
    );
    const singleByPaper = new Map(filteredData.tracksSingle.map((row) => [row.paper_id, row]));
    const multiByPaper = new Map(filteredData.tracksMulti.map((row) => [row.paper_id, row]));
    const categoryRowsByPaper = (filteredData.categoryAssignments ?? []).reduce<
      Record<string, NonNullable<typeof filteredData.categoryAssignments>>
    >((accumulator, row) => {
      (accumulator[row.paper_id] ??= []).push(row);
      return accumulator;
    }, {});
    const hasDynamicCategories = (filteredData.categoryAssignments ?? []).length > 0;
    const trendsByPaper = filteredData.trends.reduce<Record<string, TrendRow[]>>(
      (accumulator, row) => {
        (accumulator[row.paper_id] ??= []).push(row);
        return accumulator;
      },
      {}
    );

    const paperIds = new Set<PaperId>([
      ...filteredData.trends.map((row) => row.paper_id),
      ...filteredData.tracksSingle.map((row) => row.paper_id),
      ...filteredData.tracksMulti.map((row) => row.paper_id),
      ...(filteredData.categoryAssignments ?? []).map((row) => row.paper_id),
    ]);

    return [...paperIds]
      .flatMap((paperId) => {
        if (explicitPaperIds && !explicitPaperIds.has(paperId)) {
          return [];
        }

        const trendRows = trendsByPaper[paperId] ?? [];
        const singleTrack = singleByPaper.get(paperId);
        const multiTrack = multiByPaper.get(paperId);
        const representative = trendRows[0] ?? singleTrack ?? multiTrack;
        if (!representative) {
          return [];
        }

        if (!hasExplicitPaperIds && drilldownTarget.year && representative.year !== drilldownTarget.year) {
          return [];
        }

        const categoryRows = categoryRowsByPaper[paperId] ?? [];
        const matchesDynamicCategory =
          !categoryKey ||
          categoryRows.some((row) => normalizeCategoryKey(row.category_key) === categoryKey);

        if (!hasExplicitPaperIds && categoryKey && hasDynamicCategories && !matchesDynamicCategory) {
          return [];
        }
        if (
          !hasExplicitPaperIds &&
          track &&
          !hasDynamicCategories &&
          !matchesTrack(singleTrack, track) &&
          !matchesTrack(multiTrack, track)
        ) {
          return [];
        }

        if (!hasExplicitPaperIds) {
          if (
            drilldownTarget.keyword &&
            !trendRows.some((row) => row.keyword === drilldownTarget.keyword)
          ) {
            return [];
          }
          if (
            drilldownTarget.topic &&
            !trendRows.some((row) => row.topic === drilldownTarget.topic)
          ) {
            return [];
          }
        }

        const matchingEvidence =
          trendRows.find((row) =>
            drilldownTarget.keyword
              ? row.keyword === drilldownTarget.keyword
              : drilldownTarget.topic
                ? row.topic === drilldownTarget.topic
                : false
          )?.evidence || trendRows.find((row) => row.evidence)?.evidence || "";

        return [
          {
            paperId,
            title: representative.title || "Untitled paper",
            year: representative.year || "Unknown year",
            topics: [
              ...new Map(
                trendRows
                  .filter((row) => row.topic)
                  .map((row) => {
                    const label = row.raw_topic || row.topic;
                    return [label, { label, theme: row.topic }] as const;
                  })
              ).values(),
            ].slice(0, 6),
            keywords: [...new Set(trendRows.map((row) => row.keyword).filter(Boolean))].slice(0, 8),
            // With classification off the legacy slots only say "Other".
            tracks: !classificationEnabled
              ? []
              : categoryRows.length > 0
                ? [
                    ...new Set(
                      categoryRows.map(
                        (row) =>
                          categoryLabelByKey.get(normalizeCategoryKey(row.category_key)) ||
                          row.category_label
                      )
                    ),
                  ]
                : [
                    ...new Set([
                      ...trackLabelsForRow(singleTrack, categoryLabels),
                      ...trackLabelsForRow(multiTrack, categoryLabels),
                    ]),
                  ],
            evidence: matchingEvidence,
          },
        ];
      })
      .sort(
        (left, right) =>
          String(right.year).localeCompare(String(left.year)) ||
          left.title.localeCompare(right.title)
      );
  }, [
    categoryLabels,
    categoryOptions,
    classificationEnabled,
    drilldownTarget,
    filteredData,
  ]);

  // With no repository chosen the data hook never starts, so its loading flag
  // stayed true and the page spun forever.
  if (!selectedProjectId && !workspaceLoading) {
    return (
      <div className="app-surface flex min-h-[60vh] items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Choose a repository</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            The dashboard shows one repository at a time. Pick one from the repository menu, or create one and add papers in the
            library.
          </p>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-6 pt-2 sm:pt-4" role="status" aria-label="Loading dashboard data">
        <div className="space-y-3">
          <span className="skeleton block h-9 w-48" />
          <span className="skeleton block h-4 w-96 max-w-full" />
        </div>
        <span className="skeleton block h-10 w-full max-w-2xl" />
        <div className="flex gap-4 border-b border-hairline pb-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <span key={index} className="skeleton block h-4 w-24" />
          ))}
        </div>
        <span className="skeleton block h-28 w-full" />
        <span className="skeleton block h-80 w-full" />
        <p className="sr-only">Loading dashboard data…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pt-2 sm:pt-4">
      <div className="space-y-5">
        {/*
          This page had no h1 at all - it opened straight onto a search field.
          Every other workspace page names itself, so this was the one place a
          reader could arrive and have nothing tell them where they were, and the
          one page a screen reader announced with no title.
        */}
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            Dashboard
          </h1>
          <p className="mt-2 text-[15px] leading-7 text-body">
            Trends, topics, and coverage across the analyzed papers in this repository.
          </p>
        </div>

        {!isSemanticMapTab ? <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full max-w-2xl">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search papers, topics, keywords, or years…"
              aria-label="Search the dashboard"
              className="h-10 w-full rounded-lg border border-hairline bg-surface py-2 pl-10 pr-3 text-base text-ink shadow-raise outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-mute hover:border-hairline-strong focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-sm"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-subtle px-3 py-1.5 text-xs text-body">
              {selectedYears.length === 0 || selectedYears.length === allYears.length
                ? "All years"
                : `${selectedYears.length} year${selectedYears.length === 1 ? "" : "s"}`}
            </span>
            {/*
              This chip said "4 categories" on a repository with classification
              switched off - a count of filter checkboxes, not of anything in the
              data.
            */}
            <span className="rounded-full bg-subtle px-3 py-1.5 text-xs text-body">
              {classificationEnabled
                ? `${activeCategoryCount} categor${activeCategoryCount === 1 ? "y" : "ies"}`
                : "Categories off"}
            </span>
            <button
              type="button"
              onClick={() => {
                void refresh();
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-hairline bg-surface px-3.5 text-sm font-medium text-ink shadow-raise transition-[background-color,border-color,transform] duration-150 hover:border-hairline-strong hover:bg-subtle active:scale-[0.98]"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => setFilterOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-hairline bg-surface px-3.5 text-sm font-medium text-ink shadow-raise transition-[background-color,border-color,transform] duration-150 hover:border-hairline-strong hover:bg-subtle active:scale-[0.98]"
            >
              <FilterIcon className="h-4 w-4" />
              <span>Filters</span>
            </button>
          </div>
        </div> : null}

        {!isSemanticMapTab && liveDataError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            Dashboard data could not be loaded for this repository. {liveDataError}
          </div>
        ) : null}

        {/*
          Topics are grouped into themes after a paper is analysed, by a request
          the dashboard makes itself. While that runs, the new papers' topics are
          shown under their own labels - say so, rather than let a reader wonder
          why a theme they expect is missing.
        */}
        {!isSemanticMapTab && themeStatus && themeStatus.ungroupedTopics > 0 && themeStatus.status !== "ready" ? (
          <div
            role="status"
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#cfcfcf]"
          >
            {themeStatus.status === "pending"
              ? `Grouping ${themeStatus.ungroupedTopics} new topic${themeStatus.ungroupedTopics === 1 ? "" : "s"} into themes. The charts update when it finishes - usually within a minute.`
              : `${themeStatus.ungroupedTopics} topic${themeStatus.ungroupedTopics === 1 ? " is" : "s are"} shown under ${themeStatus.ungroupedTopics === 1 ? "its paper's" : "their papers'"} own label${themeStatus.ungroupedTopics === 1 ? "" : "s"}, because grouping could not run just now. It will be tried again later.`}
          </div>
        ) : null}

        <nav
          ref={setTabNav}
          className={`relative flex gap-1 overflow-x-auto border-b border-hairline ${tabBox ? "tabs-sliding" : ""}`}
          aria-label="Tabs"
          aria-busy={isRoutePending}
        >
          <TabIndicator box={tabBox} />
          {TAB_DEFINITIONS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-current={currentTabKey === tab.key ? "page" : undefined}
              onClick={() => updateRouteForTab(tab.key)}
              className={`tab-btn ${
                currentTabKey === tab.key ? "tab-btn-active" : "tab-btn-inactive"
              }`}
            >
              {tab.label}
            </button>
          ))}
          {isRoutePending ? (
            <span
              className="my-auto h-2 w-2 flex-none animate-pulse rounded-full bg-slate-950 dark:bg-white"
              title="Changing view"
            />
          ) : null}
        </nav>
      </div>

      <div className="min-w-0">
        {!isSemanticMapTab && filterOpen && (
          <div
            ref={filterSheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Analytics filters"
            className="fixed inset-0 z-40 bg-black/55 xl:hidden"
            onClick={(event) => {
              if (event.target === event.currentTarget) setFilterOpen(false);
            }}
          >
            <div className="ml-auto h-full w-full max-w-sm border-l border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505] xl:max-w-md">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-[#1f1f1f] sm:px-5">
                <p className="text-sm font-medium text-slate-900 dark:text-[#ececec]">
                  Analytics filters
                </p>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  aria-label="Close analytics filters"
                  className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0]"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="h-[calc(100%-65px)] overflow-y-auto overscroll-contain p-3 sm:p-4">
                <FilterPanel
                  allYears={allYears}
                  selectedYears={selectedYears}
                  onYearsChange={setSelectedYears}
                  selectedTracks={effectiveSelectedTracks}
                  onTracksChange={setSelectedTracks}
                  categoryOptions={categoryOptions}
                  useMock={false}
                  showHeader={false}
                  showCategories={classificationEnabled}
                />
              </div>
            </div>
          </div>
        )}

        {!isSemanticMapTab && filterOpen && (
          <div
            className="fixed inset-0 z-30 hidden bg-transparent xl:block"
            onClick={() => setFilterOpen(false)}
          />
        )}

        {drilldownTarget ? (
          <Modal onClose={() => setDrilldownTarget(null)}>
            <div className="max-h-[88vh] w-[min(920px,94vw)] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#030303]">
              <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-5 dark:border-[#1f1f1f] dark:bg-[#030303] sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                      Dashboard drilldown
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                      {buildDashboardDrilldownTitle(drilldownTarget, (key) => {
                        const normalized = normalizeDrilldownCategoryKey(key);
                        return (
                          categoryOptions.find((category) => category.key === normalized)?.label ??
                          categoryLabels[key.toLowerCase() as TrackKey] ??
                          key
                        );
                      })}
                    </h2>
                    <p className="mt-2 text-sm text-slate-500 dark:text-[#a3a3a3]">
                      {drilldownPapers.length} associated paper{drilldownPapers.length === 1 ? "" : "s"} in the current dashboard scope.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrilldownTarget(null)}
                    className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0]"
                    aria-label="Close drilldown"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-3 px-5 py-5 sm:px-6">
                {drilldownPapers.length > 0 ? (
                  drilldownPapers.map((paper) => (
                    <article
                      key={paper.paperId}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold leading-6 text-slate-900 dark:text-[#f2f2f2]">
                            {paper.title}
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-[#a3a3a3]">
                            {paper.year}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            // Opens over this list, which is still here when the paper closes.
                            if (paperViewer) {
                              paperViewer.openPaper({ paperId: String(paper.paperId) });
                              return;
                            }
                            setDrilldownTarget(null);
                            router.push(`/workspace/library?paperId=${paper.paperId}`);
                          }}
                          className="inline-flex h-9 flex-none items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#030303] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
                        >
                          Open paper
                        </button>
                      </div>

                      {paper.tracks.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {paper.tracks.map((track) => (
                            <span
                              key={`${paper.paperId}-${track}`}
                              className="rounded-full bg-white px-3 py-1.5 text-xs text-slate-600 dark:bg-[#030303] dark:text-[#d0d0d0]"
                            >
                              {track}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {paper.topics.length > 0 || paper.keywords.length > 0 ? (
                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                              Topics
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {paper.topics.length > 0 ? (
                                paper.topics.map((topic) => (
                                  <span
                                    key={`${paper.paperId}-${topic.label}`}
                                    title={topic.theme !== topic.label ? `Grouped under the theme "${topic.theme}"` : undefined}
                                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 dark:border-[#1f1f1f] dark:bg-[#030303] dark:text-[#cfcfcf]"
                                  >
                                    {topic.label}
                                    {topic.theme !== topic.label ? (
                                      <span className="text-slate-500 dark:text-[#8e8e8e]"> · {topic.theme}</span>
                                    ) : null}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-slate-500 dark:text-[#a3a3a3]">
                                  No topic rows
                                </span>
                              )}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                              Keywords
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {paper.keywords.length > 0 ? (
                                paper.keywords.map((keyword) => (
                                  <span
                                    key={`${paper.paperId}-${keyword}`}
                                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 dark:border-[#1f1f1f] dark:bg-[#030303] dark:text-[#cfcfcf]"
                                  >
                                    {keyword}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-slate-500 dark:text-[#a3a3a3]">
                                  No keyword rows
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {paper.evidence ? (
                        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-[#cfcfcf]">
                          {paper.evidence}
                        </p>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-8 dark:border-[#1f1f1f] dark:bg-[#050505]">
                    <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                      No papers matched this dashboard item in the current filter scope.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Modal>
        ) : null}

        {!isSemanticMapTab ? <div className="hidden xl:block">
          <div
            className={`fixed right-6 top-[124px] z-40 hidden w-full max-w-sm xl:block ${
              // invisible, not only transparent: a closed panel leaves the tab
              // order and the accessibility tree.
              filterOpen ? "" : "pointer-events-none invisible -translate-y-1 opacity-0"
            } transition-[opacity,transform,visibility] duration-150 ease-out-expo`}
          >
            <div className="rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#050505]">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-[#1f1f1f]">
                <p className="text-sm font-medium text-slate-900 dark:text-[#ececec]">
                  Analytics filters
                </p>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  aria-label="Close analytics filters"
                  className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0]"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto p-4">
                <FilterPanel
                  allYears={allYears}
                  selectedYears={selectedYears}
                  onYearsChange={setSelectedYears}
                  selectedTracks={effectiveSelectedTracks}
                  onTracksChange={setSelectedTracks}
                  categoryOptions={categoryOptions}
                  useMock={false}
                  showHeader={false}
                  showCategories={classificationEnabled}
                />
              </div>
            </div>
          </div>
        </div> : null}

        <section className="min-w-0">
          {currentTabKey === "overview" ? (
            <Overview
              trends={filteredData.trends}
              tracksSingle={filteredData.tracksSingle}
              tracksMulti={filteredData.tracksMulti}
              categoryAssignments={filteredData.categoryAssignments}
              categoryOptions={categoryOptions}
              selectedTracks={effectiveSelectedTracks}
              categoryLabels={categoryLabels}
              classificationEnabled={classificationEnabled}
              onDrilldown={openPaperDrilldown}
            />
          ) : null}
          {currentTabKey === "trend_analysis" ? (
            <TrendAnalysis
              trends={filteredData.trends}
              onDrilldown={openPaperDrilldown}
            />
          ) : null}
          {currentTabKey === "track_analysis" ? (
            <TrackAnalysis
              trends={filteredData.trends}
              tracksSingle={filteredData.tracksSingle}
              tracksMulti={filteredData.tracksMulti}
              categoryAssignments={filteredData.categoryAssignments}
              categoryOptions={categoryOptions}
              selectedTracks={effectiveSelectedTracks}
              categoryLabels={categoryLabels}
              classificationEnabled={classificationEnabled}
              onDrilldown={openPaperDrilldown}
            />
          ) : null}
          {currentTabKey === "keyword_explorer" ? (
            <KeywordExplorer
              trends={filteredData.trends}
              topicFamilies={filteredData.topicFamilies}
              folderIds={selectedFolderIds}
              projectId={selectedProjectId ?? undefined}
              selectedYears={selectedYears}
              selectedTracks={effectiveSelectedTracks}
              onDrilldown={openPaperDrilldown}
            />
          ) : null}
          {currentTabKey === "semantic_map" && selectedProjectId ? (
            <RepositorySemanticMapView
              projectId={selectedProjectId}
              projectName={currentProject?.name ?? "Repository"}
              requestHeaders={requestHeaders}
            />
          ) : null}
          {currentTabKey === "adaptive" ? (
            <InsightsTab
              projectId={selectedProjectId ?? null}
              accessToken={session?.access_token ?? null}
              selectedYears={selectedYears}
              selectedTracks={selectedTracks}
              searchQuery={searchQuery}
              dataVersion={adaptiveDataVersion}
              onOpenPapers={(paperIds, label) => openPaperDrilldown({ paperIds: paperIds.map(String), label })}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
