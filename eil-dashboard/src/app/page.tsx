"use client";

import { useState, useEffect, useMemo } from "react";
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

export default function Dashboard() {
  const { data, loading, allYears } = useDashboardData();

  const [activeTab, setActiveTab] = useState(0);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<string[]>([...TRACK_COLS]);

  // Default all years selected once data arrives
  useEffect(() => {
    if (allYears.length > 0 && selectedYears.length === 0) {
      setSelectedYears(allYears);
    }
  }, [allYears, selectedYears.length]);

  // ── Filtered data ──────────────────────────────────────
  const filteredTrends = useMemo(
    () => data?.trends.filter((r) => selectedYears.includes(r.year)) ?? [],
    [data, selectedYears]
  );
  const filteredSingle = useMemo(
    () =>
      data?.tracksSingle.filter((r) => selectedYears.includes(r.year)) ?? [],
    [data, selectedYears]
  );
  const filteredMulti = useMemo(
    () =>
      data?.tracksMulti.filter((r) => selectedYears.includes(r.year)) ?? [],
    [data, selectedYears]
  );

  // ── Loading state ──────────────────────────────────────
  if (loading || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading dashboard data…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar ──────────────────────────────────────── */}
      <Sidebar
        allYears={allYears}
        selectedYears={selectedYears}
        onYearsChange={setSelectedYears}
        selectedTracks={selectedTracks}
        onTracksChange={setSelectedTracks}
        useMock={data.useMock}
      />

      {/* ── Main area ────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {/* Tab bar */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6">
          <nav className="flex gap-0" aria-label="Tabs">
            {TABS.map((tab, i) => (
              <button
                key={tab}
                onClick={() => setActiveTab(i)}
                className={`tab-btn ${
                  activeTab === i ? "tab-btn-active" : "tab-btn-inactive"
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
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
            />
          )}
        </div>

        {/* Footer */}
        <footer className="border-t border-gray-200 px-6 py-4">
          <p className="text-xs text-gray-400">
            EIL Research Trend Dashboard &nbsp;|&nbsp; English as an
            International Language Program &nbsp;|&nbsp; Chulalongkorn
            University &nbsp;|&nbsp; Powered by Next.js + Supabase + Recharts
          </p>
        </footer>
      </main>
    </div>
  );
}
