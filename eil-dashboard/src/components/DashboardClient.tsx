"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDashboardData } from "@/hooks/useData";
import { TRACK_COLS } from "@/lib/constants";
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

export default function DashboardClient() {
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
    if (!tabSlug) return;
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
    router.replace(nextQuery ? `/?${nextQuery}` : "/", { scroll: false });
  };

  const filteredTrends = useMemo(
    () => data?.trends.filter((row) => selectedYears.includes(row.year)) ?? [],
    [data, selectedYears]
  );
  const filteredSingle = useMemo(
    () =>
      data?.tracksSingle.filter((row) => selectedYears.includes(row.year)) ?? [],
    [data, selectedYears]
  );
  const filteredMulti = useMemo(
    () =>
      data?.tracksMulti.filter((row) => selectedYears.includes(row.year)) ?? [],
    [data, selectedYears]
  );

  if (loading || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading dashboard data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        allYears={allYears}
        selectedYears={selectedYears}
        onYearsChange={setSelectedYears}
        selectedTracks={selectedTracks}
        onTracksChange={setSelectedTracks}
        useMock={data.useMock}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-6">
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
              trends={filteredTrends}
              tracksSingle={filteredSingle}
              tracksMulti={filteredMulti}
              selectedTracks={selectedTracks}
              useMock={data.useMock}
            />
          )}
          {activeTab === 1 && <TrendAnalysis trends={filteredTrends} />}
          {activeTab === 2 && (
            <TrackAnalysis
              trends={filteredTrends}
              tracksSingle={filteredSingle}
              tracksMulti={filteredMulti}
              selectedTracks={selectedTracks}
            />
          )}
          {activeTab === 3 && <KeywordExplorer trends={filteredTrends} />}
          {activeTab === 4 && (
            <PaperExplorer
              trends={filteredTrends}
              tracksSingle={filteredSingle}
              linkedPaperId={linkedPaperId}
            />
          )}
        </div>

        <footer className="border-t border-gray-200 px-6 py-4">
          <p className="text-xs text-gray-400">
            EIL Research Trend Dashboard | English as an International Language
            Program | Chulalongkorn University | Powered by Next.js + Supabase +
            Recharts
          </p>
        </footer>
      </main>
    </div>
  );
}
