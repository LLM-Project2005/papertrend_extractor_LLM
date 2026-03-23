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
      return {
        trends: [],
        tracksSingle: [],
        tracksMulti: [],
      };
    }

    return filterDashboardData(data, selectedYears, selectedTracks);
  }, [data, selectedTracks, selectedYears]);

  if (loading || !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center rounded-[32px] border border-[#dfd5c6] bg-white">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading dashboard data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Sidebar
        allYears={allYears}
        selectedYears={selectedYears}
        onYearsChange={setSelectedYears}
        selectedTracks={selectedTracks}
        onTracksChange={setSelectedTracks}
        useMock={data.useMock}
        title="Analytics filters"
        description="Keep the dashboard focused on the years and tracks that matter for the current workspace question."
      />

      <main className="min-w-0 overflow-hidden rounded-[32px] border border-[#dfd5c6] bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 pt-6">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
              Dashboard module
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">
              Analytics workspace
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
              The dashboard stays intact as part of the workspace. Use the filters
              on the left to narrow the corpus before moving through the analytics tabs.
            </p>
          </div>

          <nav className="flex gap-0" aria-label="Tabs">
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
        </div>

        <div className="p-6">
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
        </div>

        <footer className="border-t border-gray-200 px-6 py-4">
          <p className="text-xs text-gray-400">
            Workspace analytics powered by Next.js, Supabase, and Recharts.
          </p>
        </footer>
      </main>
    </div>
  );
}
