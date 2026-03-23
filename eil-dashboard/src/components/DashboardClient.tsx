"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDashboardData } from "@/hooks/useData";
import { TRACK_COLS } from "@/lib/constants";
import { filterDashboardData } from "@/lib/dashboard-filters";
import Sidebar from "@/components/Sidebar";
import Overview from "@/components/tabs/Overview";
import TrendAnalysis from "@/components/tabs/TrendAnalysis";
import TrackAnalysis from "@/components/tabs/TrackAnalysis";
import KeywordExplorer from "@/components/tabs/KeywordExplorer";
import PaperExplorer from "@/components/tabs/PaperExplorer";
import { CloseIcon, FilterIcon } from "@/components/ui/Icons";

const TABS = [
  "Overview",
  "Trend Analysis",
  "Track Analysis",
  "Keyword Explorer",
  "Paper Explorer",
] as const;

const TAB_SLUGS = [
  "overview",
  "trend-analysis",
  "track-analysis",
  "keyword-explorer",
  "paper-explorer",
] as const;

function FilterPanel({
  allYears,
  selectedYears,
  onYearsChange,
  selectedTracks,
  onTracksChange,
  useMock,
}: {
  allYears: string[];
  selectedYears: string[];
  onYearsChange: (years: string[]) => void;
  selectedTracks: string[];
  onTracksChange: (tracks: string[]) => void;
  useMock: boolean;
}) {
  return (
    <Sidebar
      allYears={allYears}
      selectedYears={selectedYears}
      onYearsChange={onYearsChange}
      selectedTracks={selectedTracks}
      onTracksChange={onTracksChange}
      useMock={useMock}
      title="Analytics filters"
      description="Narrow the years and track categories before reading the dashboard."
    />
  );
}

export default function DashboardClient({
  basePath = "/workspace/dashboard",
}: {
  basePath?: string;
}) {
  const { data, loading, allYears } = useDashboardData();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState(0);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<string[]>([...TRACK_COLS]);
  const [filterOpen, setFilterOpen] = useState(false);

  const linkedPaperId = useMemo(() => {
    const value = Number.parseInt(searchParams.get("paperId") ?? "", 10);
    return Number.isFinite(value) ? value : null;
  }, [searchParams]);

  useEffect(() => {
    const tabSlug = searchParams.get("tab");
    if (!tabSlug) {
      return;
    }

    const tabIndex = TAB_SLUGS.indexOf(tabSlug as (typeof TAB_SLUGS)[number]);
    if (tabIndex >= 0 && tabIndex !== activeTab) {
      setActiveTab(tabIndex);
    }
  }, [activeTab, searchParams]);

  useEffect(() => {
    if (allYears.length > 0 && selectedYears.length === 0) {
      setSelectedYears(allYears);
    }
  }, [allYears, selectedYears.length]);

  const updateRouteForTab = (tabIndex: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", TAB_SLUGS[tabIndex]);
    if (tabIndex !== 4) {
      params.delete("paperId");
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

    return filterDashboardData(data, selectedYears, selectedTracks);
  }, [data, selectedTracks, selectedYears]);

  if (loading || !data) {
    return (
      <div className="app-surface flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-sky-500 border-t-transparent" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Loading dashboard data...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="app-surface px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Dashboard module
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
              Analytics
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
              Trends, tracks, keywords, and paper-level review all live in the same
              product style now instead of appearing as a separate embedded app.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white xl:hidden"
          >
            <FilterIcon className="h-4 w-4" />
            <span>Filters</span>
          </button>
        </div>

        <nav className="mt-5 flex flex-wrap gap-2" aria-label="Tabs">
          {TABS.map((tab, index) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(index);
                updateRouteForTab(index);
              }}
              className={`tab-btn ${
                activeTab === index ? "tab-btn-active" : "tab-btn-inactive"
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="hidden xl:block">
          <FilterPanel
            allYears={allYears}
            selectedYears={selectedYears}
            onYearsChange={setSelectedYears}
            selectedTracks={selectedTracks}
            onTracksChange={setSelectedTracks}
            useMock={data.useMock}
          />
        </div>

        {filterOpen && (
          <div className="fixed inset-0 z-40 bg-slate-950/45 xl:hidden">
            <div className="ml-auto h-full w-full max-w-sm border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Analytics filters
                </p>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4">
                <FilterPanel
                  allYears={allYears}
                  selectedYears={selectedYears}
                  onYearsChange={setSelectedYears}
                  selectedTracks={selectedTracks}
                  onTracksChange={setSelectedTracks}
                  useMock={data.useMock}
                />
              </div>
            </div>
          </div>
        )}

        <section className="min-w-0">
          {activeTab === 0 && (
            <Overview
              trends={filteredData.trends}
              tracksSingle={filteredData.tracksSingle}
              tracksMulti={filteredData.tracksMulti}
              selectedTracks={selectedTracks}
              useMock={data.useMock}
            />
          )}
          {activeTab === 1 && <TrendAnalysis trends={filteredData.trends} />}
          {activeTab === 2 && (
            <TrackAnalysis
              trends={filteredData.trends}
              tracksSingle={filteredData.tracksSingle}
              tracksMulti={filteredData.tracksMulti}
              selectedTracks={selectedTracks}
            />
          )}
          {activeTab === 3 && <KeywordExplorer trends={filteredData.trends} />}
          {activeTab === 4 && (
            <PaperExplorer
              trends={filteredData.trends}
              tracksSingle={filteredData.tracksSingle}
              linkedPaperId={linkedPaperId}
            />
          )}
        </section>
      </div>
    </div>
  );
}
