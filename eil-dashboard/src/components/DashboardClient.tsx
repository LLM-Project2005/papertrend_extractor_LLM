"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import AdaptiveDashboardTab from "@/components/dashboard/AdaptiveDashboardTab";
import Sidebar from "@/components/Sidebar";
import Overview from "@/components/tabs/Overview";
import TrendAnalysis from "@/components/tabs/TrendAnalysis";
import TrackAnalysis from "@/components/tabs/TrackAnalysis";
import KeywordExplorer from "@/components/tabs/KeywordExplorer";
import Modal from "@/components/ui/Modal";
import { ChartIcon, CloseIcon, FilterIcon, SearchIcon } from "@/components/ui/Icons";
import { useDashboardData } from "@/hooks/useData";
import { TRACK_COLS, TRACK_NAMES, type TrackKey } from "@/lib/constants";
import { readCategoryLabelMap } from "@/lib/analysis-profile";
import { buildCategoryOptions, normalizeCategoryKey } from "@/lib/category-options";
import { filterDashboardData } from "@/lib/dashboard-filters";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import type { DashboardData, DashboardDataMode, PaperId, TrackRow, TrendRow } from "@/types/database";
import type { NormalizedAnalyticsPayload, VisualizationPlan } from "@/types/visualization";

const TAB_DEFINITIONS = [
  { key: "overview", label: "Overview" },
  { key: "trend_analysis", label: "Trend Analysis" },
  { key: "track_analysis", label: "Category Analysis" },
  { key: "keyword_explorer", label: "Keyword Explorer" },
  { key: "adaptive", label: "Adaptive" },
] as const;

const ADAPTIVE_SIGNATURE_SAMPLE_SIZE = 1200;
const ADAPTIVE_RENDER_ROW_LIMIT = 10000;

type DashboardDrilldownTarget = {
  track?: string;
  year?: string;
  topic?: string;
  keyword?: string;
  paperIds?: string[];
};

type DashboardDrilldownPaper = {
  paperId: PaperId;
  title: string;
  year: string;
  topics: string[];
  keywords: string[];
  tracks: string[];
  evidence: string;
};

type AdaptiveDashboardSnapshot = Pick<
  DashboardData,
  "trends" | "tracksSingle" | "tracksMulti" | "topicFamilies"
>;

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

function buildDashboardDrilldownTitle(target: DashboardDrilldownTarget | null): string {
  if (!target) {
    return "Associated papers";
  }

  const parts = [
    target.track ? `Category: ${target.track}` : "",
    target.year ? `Year: ${target.year}` : "",
    target.keyword ? `Keyword: ${target.keyword}` : target.topic ? `Topic: ${target.topic}` : "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" | ") : "Associated papers";
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
  categoryOptions,
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
  categoryOptions: ReturnType<typeof buildCategoryOptions>;
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
      categoryOptions={categoryOptions}
      useMock={useMock}
      title="Analytics filters"
      description="Choose folders, years, and categories before reading the dashboard."
      showHeader={showHeader}
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
    selectedFolderId,
    selectedProjectId,
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
  const categoryLabels = useMemo(() => readCategoryLabelMap(profile), [profile]);

  const scopedFolderIds = useMemo(() => folders.map((folder) => folder.id), [folders]);
  const routeSelectedFolderIds = useMemo(
    () => parseSelectedFolderIds(searchParams, selectedFolderId),
    [searchParams, selectedFolderId]
  );
  const [optimisticFolderIds, setOptimisticFolderIds] = useState(routeSelectedFolderIds);
  const selectedFolderIds = optimisticFolderIds;
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
      enabled: Boolean(selectedProjectId),
      refetchOnWindowFocus: false,
    }
  );
  const categoryOptions = useMemo(
    () => buildCategoryOptions(data, profile, categoryLabels),
    [categoryLabels, data, profile]
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [drilldownTarget, setDrilldownTarget] = useState<DashboardDrilldownTarget | null>(null);
  const [planState, setPlanState] = useState<{
    plan: VisualizationPlan;
    source: "agent" | "fallback";
  } | null>(null);
  const [adaptiveSnapshot, setAdaptiveSnapshot] = useState<AdaptiveDashboardSnapshot | null>(null);
  const [adaptiveAnalytics, setAdaptiveAnalytics] = useState<NormalizedAnalyticsPayload | null>(null);
  const [generatedAdaptiveSignature, setGeneratedAdaptiveSignature] = useState<string | null>(null);
  const [adaptiveGenerating, setAdaptiveGenerating] = useState(false);
  const [adaptiveError, setAdaptiveError] = useState<string | null>(null);
  const previousAllYearsRef = useRef<string[]>([]);
  const liveDataError = data?.diagnostics?.errorMessage ?? null;

  useEffect(() => {
    setOptimisticFolderIds(routeSelectedFolderIds);
  }, [routeSelectedFolderIds]);

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
  const isAdaptiveTab = currentTabKey === "adaptive";

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

  const updateFolderSelection = (folderIds: string[], allSelected: boolean) => {
    const nextFolderIds = allSelected || folderIds.length === 0 ? [] : [...folderIds];
    setOptimisticFolderIds(nextFolderIds);
    updateRoute((params) => {
      if (nextFolderIds.length === 0) {
        params.delete("folders");
      } else {
        params.set("folders", nextFolderIds.join(","));
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

    return filterDashboardData(data, selectedYears, selectedTracks, searchQuery);
  }, [data, searchQuery, selectedTracks, selectedYears]);

  const drilldownPapers = useMemo<DashboardDrilldownPaper[]>(() => {
    if (!drilldownTarget) {
      return [];
    }

    const explicitPaperIds = new Set((drilldownTarget.paperIds ?? []).filter(Boolean));
    const hasExplicitPaperIds = explicitPaperIds.size > 0;
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
        if (hasExplicitPaperIds && !explicitPaperIds.has(paperId)) {
          return [];
        }

        const trendRows = trendsByPaper[paperId] ?? [];
        const singleTrack = singleByPaper.get(paperId);
        const multiTrack = multiByPaper.get(paperId);
        const representative = trendRows[0] ?? singleTrack ?? multiTrack;
        if (!representative) {
          return [];
        }

        if (drilldownTarget.year && representative.year !== drilldownTarget.year) {
          return [];
        }

        const categoryRows = categoryRowsByPaper[paperId] ?? [];
        const matchesDynamicCategory =
          !categoryKey ||
          categoryRows.some((row) => normalizeCategoryKey(row.category_key) === categoryKey);

        if (categoryKey && hasDynamicCategories && !matchesDynamicCategory) {
          return [];
        }
        if (
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
            topics: [...new Set(trendRows.map((row) => row.topic).filter(Boolean))].slice(0, 6),
            keywords: [...new Set(trendRows.map((row) => row.keyword).filter(Boolean))].slice(0, 8),
            tracks:
              categoryRows.length > 0
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
    drilldownTarget,
    filteredData,
  ]);

  const adaptivePlanSignature = useMemo(() => {
    if (!data || !isAdaptiveTab) {
      return null;
    }

    const sampledTrends = filteredData.trends.slice(0, ADAPTIVE_SIGNATURE_SAMPLE_SIZE);
    const sampledTracksSingle = filteredData.tracksSingle.slice(
      0,
      ADAPTIVE_SIGNATURE_SAMPLE_SIZE
    );
    const sampledCategoryAssignments = (filteredData.categoryAssignments ?? []).slice(
      0,
      ADAPTIVE_SIGNATURE_SAMPLE_SIZE
    );
    const sampledTopicFamilies = (filteredData.topicFamilies ?? []).slice(0, 200);

    return stableSerialize({
      projectId: selectedProjectId ?? "all",
      mode: data.useMock ? "mock" : "live",
      diagnostics: data.diagnostics?.dataSource ?? null,
      folders: [...selectedFolderIds].sort(),
      selectedYears: [...selectedYears].sort(),
      selectedTracks: [...selectedTracks].sort(),
      searchQuery: searchQuery.trim(),
      trendRowCount: filteredData.trends.length,
      tracksSingleRowCount: filteredData.tracksSingle.length,
      categoryAssignmentRowCount: filteredData.categoryAssignments?.length ?? 0,
      topicFamilyCount: filteredData.topicFamilies?.length ?? 0,
      trendRows: sampledTrends.map((row) => ({
        paper_id: row.paper_id,
        folder_id: row.folder_id ?? null,
        year: row.year,
        topic: row.topic,
        keyword: row.keyword,
        keyword_frequency: row.keyword_frequency,
      })),
      topicFamilies: sampledTopicFamilies.map((family) => ({
        id: family.id,
        canonicalTopic: family.canonicalTopic,
        aliases: [...family.aliases].sort(),
        totalKeywordFrequency: family.totalKeywordFrequency,
        paperIds: [...family.paperIds].sort(),
      })),
      tracksSingle: sampledTracksSingle.map((row) => ({
        paper_id: row.paper_id,
        year: row.year,
        el: row.el,
        eli: row.eli,
        lae: row.lae,
        other: row.other,
      })),
      categoryAssignments: sampledCategoryAssignments.map((row) => ({
        paper_id: row.paper_id,
        year: row.year,
        category_key: row.category_key,
        category_label: row.category_label,
        assignment_type: row.assignment_type,
      })),
    });
  }, [
    data,
    filteredData.categoryAssignments,
    filteredData.topicFamilies,
    filteredData.tracksSingle,
    filteredData.trends,
    searchQuery,
    isAdaptiveTab,
    selectedFolderIds,
    selectedProjectId,
    selectedTracks,
    selectedYears,
  ]);

  const adaptiveRenderData = useMemo(
    () => ({
      trends: filteredData.trends.slice(0, ADAPTIVE_RENDER_ROW_LIMIT),
      tracksSingle: filteredData.tracksSingle.slice(0, ADAPTIVE_RENDER_ROW_LIMIT),
      tracksMulti: filteredData.tracksMulti.slice(0, ADAPTIVE_RENDER_ROW_LIMIT),
      topicFamilies: (filteredData.topicFamilies ?? []).slice(0, 300),
    }),
    [
      filteredData.topicFamilies,
      filteredData.tracksMulti,
      filteredData.tracksSingle,
      filteredData.trends,
    ]
  );
  const adaptiveSection =
    planState?.plan.sections.find(
      (section) => section.section_key === "adaptive"
    ) ?? null;
  const adaptiveFiltersChanged = Boolean(
    generatedAdaptiveSignature && adaptivePlanSignature !== generatedAdaptiveSignature
  );

  async function generateAdaptiveCharts() {
    if (!data || !adaptivePlanSignature || adaptiveGenerating) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    setAdaptiveGenerating(true);
    setAdaptiveError(null);
    try {
      const response = await fetch("/api/visualization-plan", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          selectedYears,
          selectedTracks,
          searchQuery,
          folderIds: selectedFolderIds,
          projectId: selectedProjectId,
          context: {
            goal: "Build the clearest non-redundant charts for this exact filtered research corpus. Prefer robust comparisons and disclose sparse evidence.",
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        plan?: VisualizationPlan;
        source?: "agent" | "fallback";
        analytics?: NormalizedAnalyticsPayload;
        error?: string;
      };
      if (!response.ok || !payload.plan || !payload.analytics) {
        throw new Error(payload.error || "The visualization agent could not build a chart plan.");
      }
      setPlanState({ plan: payload.plan, source: payload.source ?? "fallback" });
      setAdaptiveAnalytics(payload.analytics);
      setAdaptiveSnapshot({
        trends: adaptiveRenderData.trends.map((row) => ({ ...row })),
        tracksSingle: adaptiveRenderData.tracksSingle.map((row) => ({ ...row })),
        tracksMulti: adaptiveRenderData.tracksMulti.map((row) => ({ ...row })),
        topicFamilies: adaptiveRenderData.topicFamilies.map((row) => ({
          ...row,
          aliases: [...row.aliases],
          matchedTerms: [...row.matchedTerms],
          relatedKeywords: [...row.relatedKeywords],
          representativeKeywords: [...row.representativeKeywords],
          paperIds: [...row.paperIds],
        })),
      });
      setGeneratedAdaptiveSignature(adaptivePlanSignature);
    } catch (error) {
      setAdaptiveError(
        error instanceof DOMException && error.name === "AbortError"
          ? "Chart generation timed out. Please try again."
          : error instanceof Error
            ? error.message
            : "Chart generation failed."
      );
    } finally {
      window.clearTimeout(timeout);
      setAdaptiveGenerating(false);
    }
  }

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
              className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-[#242424]"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#050505] dark:text-[#a3a3a3]">
              {allFoldersSelected
                ? `All folders (${folders.length})`
                : `${selectedFolderIds.length} folder${
                    selectedFolderIds.length === 1 ? "" : "s"
                  }`}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#050505] dark:text-[#a3a3a3]">
              {selectedYears.length === 0
                ? "All years"
                : `${selectedYears.length} year${selectedYears.length === 1 ? "" : "s"}`}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#050505] dark:text-[#a3a3a3]">
              {selectedTracks.length} categor{selectedTracks.length === 1 ? "y" : "ies"}
            </span>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#bdbdbd]">
              <span className="text-xs font-medium uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
                Data
              </span>
              <select
                value={dashboardDataMode}
                onChange={(event) => updateDataMode(event.target.value as DashboardDataMode)}
                className="bg-transparent text-sm font-medium text-slate-700 outline-none dark:text-[#f2f2f2]"
                  title="Choose whether the dashboard should recover gracefully, use project data, or use preview data."
              >
                <option value="auto">Smart</option>
                <option value="live">Project</option>
                <option value="mock">Preview</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                void refresh();
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
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

        <section className="app-surface px-4 py-4 sm:px-5">
          {liveDataError ? (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              Live dashboard data could not be loaded for this scope. {liveDataError}
            </div>
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#6f6f6f]">
                Visualization planner
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-[#f2f2f2]">
                {planState?.plan.dashboard_title ??
                  (data?.useMock ? "Preview chart workspace" : "Generate adaptive charts")}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
                {planState?.plan.summary ??
                  "The visualization agent will inspect the current filters and choose only charts supported by that exact data snapshot."}
              </p>
              {adaptiveFiltersChanged ? (
                <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                  Filters changed. Existing charts still show the previous snapshot until you update them.
                </p>
              ) : null}
              {adaptiveError ? (
                <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-300">{adaptiveError}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#050505] dark:text-[#a3a3a3]">
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
              {planState ? (
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-[#050505] dark:text-[#a3a3a3]">
                  {planState.source === "agent" ? "Agent plan" : "Safe fallback"}
                </span>
              ) : null}
              {isAdaptiveTab ? (
                <button
                  type="button"
                  onClick={() => void generateAdaptiveCharts()}
                  disabled={adaptiveGenerating || !data}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-[#e8e8e8]"
                >
                  <ChartIcon className="h-4 w-4" />
                  {adaptiveGenerating
                    ? "Building charts..."
                    : planState
                      ? adaptiveFiltersChanged
                        ? "Update charts"
                        : "Regenerate"
                      : "Generate charts"}
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <nav
          className="flex gap-2 overflow-x-auto pb-1"
          aria-label="Tabs"
          aria-busy={isRoutePending}
        >
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
          {isRoutePending ? (
            <span
              className="my-auto h-2 w-2 flex-none animate-pulse rounded-full bg-slate-950 dark:bg-white"
              title="Changing view"
            />
          ) : null}
        </nav>
      </div>

      <div className="min-w-0">
        {filterOpen && (
          <div className="fixed inset-0 z-40 bg-black/55 xl:hidden">
            <div className="ml-auto h-full w-full max-w-sm border-l border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505] xl:max-w-md">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-[#1f1f1f] sm:px-5">
                <p className="text-sm font-medium text-slate-900 dark:text-[#ececec]">
                  Analytics filters
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
                  categoryOptions={categoryOptions}
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

        {drilldownTarget ? (
          <Modal onClose={() => setDrilldownTarget(null)}>
            <div className="max-h-[88vh] w-[min(920px,94vw)] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#030303]">
              <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-5 dark:border-[#1f1f1f] dark:bg-[#030303] sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
                      Dashboard drilldown
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                      {buildDashboardDrilldownTitle(drilldownTarget)}
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
                            <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
                              Topics
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {paper.topics.length > 0 ? (
                                paper.topics.map((topic) => (
                                  <span
                                    key={`${paper.paperId}-${topic}`}
                                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 dark:border-[#1f1f1f] dark:bg-[#030303] dark:text-[#cfcfcf]"
                                  >
                                    {topic}
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
                            <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#8e8e8e]">
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

        <div className="hidden xl:block">
          <div
            className={`fixed right-6 top-[124px] z-40 hidden w-full max-w-sm xl:block ${
              filterOpen ? "" : "pointer-events-none opacity-0"
            } transition-all`}
          >
            <div className="rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#050505]">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-[#1f1f1f]">
                <p className="text-sm font-medium text-slate-900 dark:text-[#ececec]">
                  Analytics filters
                </p>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0]"
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
                  categoryOptions={categoryOptions}
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
              categoryAssignments={filteredData.categoryAssignments}
              categoryOptions={categoryOptions}
              selectedTracks={selectedTracks}
              categoryLabels={categoryLabels}
              useMock={data?.useMock ?? true}
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
              selectedTracks={selectedTracks}
              categoryLabels={categoryLabels}
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
              selectedTracks={selectedTracks}
              onDrilldown={openPaperDrilldown}
            />
          ) : null}
          {currentTabKey === "adaptive" ? (
            adaptiveSection && adaptiveSnapshot && adaptiveAnalytics ? (
              <AdaptiveDashboardTab
                data={adaptiveSnapshot}
                analytics={adaptiveAnalytics}
                adaptiveSection={adaptiveSection}
                folderNamesById={folderNamesById}
              />
            ) : (
              <section className="app-surface flex min-h-[360px] flex-col items-center justify-center px-6 py-12 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 text-slate-600 dark:border-[#2a2a2a] dark:text-[#d4d4d4]">
                  <ChartIcon className="h-5 w-5" />
                </span>
                <h2 className="mt-5 text-xl font-semibold text-slate-900 dark:text-white">
                  Build charts for this research scope
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                  The agent will inspect the selected folders, years, categories, and search query, then call the chart builder with only statistically usable views.
                </p>
                <button
                  type="button"
                  onClick={() => void generateAdaptiveCharts()}
                  disabled={adaptiveGenerating || !data}
                  className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-[#e8e8e8]"
                >
                  <ChartIcon className="h-4 w-4" />
                  {adaptiveGenerating ? "Building charts..." : "Generate charts"}
                </button>
              </section>
            )
          ) : null}
        </section>
      </div>
    </div>
  );
}
