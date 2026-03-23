"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDashboardData } from "@/hooks/useData";
import { TRACK_COLS } from "@/lib/constants";
import { filterDashboardData } from "@/lib/dashboard-filters";
import Sidebar from "@/components/Sidebar";
import PaperExplorer from "@/components/tabs/PaperExplorer";

export default function WorkspacePapersClient() {
  const { data, loading, allYears } = useDashboardData();
  const searchParams = useSearchParams();

  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<string[]>([...TRACK_COLS]);

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
          <p className="text-sm text-gray-500">Loading paper library...</p>
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
        title="Paper filters"
        description="Filter the paper library before reviewing individual titles, keywords, evidence, and track assignments."
      />

      <section className="min-w-0 rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
            Papers module
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">
            Paper library
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
            Stay at the paper level when you need to validate evidence behind a
            chart or answer from chat.
          </p>
        </div>

        <PaperExplorer
          trends={filteredData.trends}
          tracksSingle={filteredData.tracksSingle}
          linkedPaperId={linkedPaperId}
        />
      </section>
    </div>
  );
}
