"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDashboardData } from "@/hooks/useData";
import { TRACK_COLS } from "@/lib/constants";
import { filterDashboardData } from "@/lib/dashboard-filters";
import Sidebar from "@/components/Sidebar";
import PaperExplorer from "@/components/tabs/PaperExplorer";
import { CloseIcon, FilterIcon } from "@/components/ui/Icons";

export default function WorkspacePapersClient() {
  const { data, loading, allYears } = useDashboardData();
  const searchParams = useSearchParams();

  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<string[]>([...TRACK_COLS]);
  const [filterOpen, setFilterOpen] = useState(false);

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
            Loading paper library...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <section className="app-surface px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Papers module
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Paper library
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Search the corpus and review evidence in the same calm workspace layout as the rest of the product.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white xl:hidden"
          >
            <FilterIcon className="h-4 w-4" />
            <span>Filters</span>
          </button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[296px_minmax(0,1fr)]">
        <div className="hidden xl:block">
          <Sidebar
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

        {filterOpen && (
          <div className="fixed inset-0 z-40 bg-slate-950/45 xl:hidden">
            <div className="ml-auto h-full w-full max-w-sm border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-slate-800 sm:px-5">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Paper filters
                </p>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="h-[calc(100%-65px)] overflow-y-auto p-3 sm:p-4">
                <Sidebar
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
