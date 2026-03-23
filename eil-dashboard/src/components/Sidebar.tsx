"use client";

import { TRACK_COLS, TRACK_NAMES, type TrackKey } from "@/lib/constants";

interface Props {
  allYears: string[];
  selectedYears: string[];
  onYearsChange: (y: string[]) => void;
  selectedTracks: string[];
  onTracksChange: (t: string[]) => void;
  useMock: boolean;
  title?: string;
  description?: string;
  showHeader?: boolean;
}

export default function Sidebar({
  allYears,
  selectedYears,
  onYearsChange,
  selectedTracks,
  onTracksChange,
  useMock,
  title = "Filters",
  description = "Narrow the dataset before exploring the analytics.",
  showHeader = true,
}: Props) {
  const toggleYear = (year: string) => {
    onYearsChange(
      selectedYears.includes(year)
        ? selectedYears.filter((value) => value !== year)
        : [...selectedYears, year].sort()
    );
  };

  const toggleTrack = (track: string) => {
    onTracksChange(
      selectedTracks.includes(track)
        ? selectedTracks.filter((value) => value !== track)
        : [...selectedTracks, track]
    );
  };

  return (
    <aside className="overflow-hidden rounded-[28px] border border-slate-200 bg-white dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
      {showHeader && (
        <div className="border-b border-slate-200 px-5 py-4 dark:border-[#2c2c2c]">
          <h2 className="text-base font-semibold text-slate-900 dark:text-[#ececec]">
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
            {description}
          </p>
        </div>
      )}

      <div className="space-y-6 px-5 py-5">
        {useMock && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-[#6a3416] dark:bg-[#3a2618] dark:text-[#f4c97c]">
            Showing preview data until Supabase is connected and populated.
          </div>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
              Years
            </h3>
            <button
              type="button"
              className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:text-[#ececec]"
              onClick={() =>
                onYearsChange(
                  selectedYears.length === allYears.length ? [] : [...allYears]
                )
              }
            >
              {selectedYears.length === allYears.length
                ? "Clear all"
                : "Select all"}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {allYears.map((year) => {
              const active = selectedYears.includes(year);
              return (
                <button
                  key={year}
                  type="button"
                  onClick={() => toggleYear(year)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white dark:border-[#f3f3f3] dark:bg-[#f3f3f3] dark:text-[#171717]"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-[#353535] dark:bg-[#232323] dark:text-[#c7c7c7] dark:hover:border-[#444444] dark:hover:text-[#ececec]"
                  }`}
                >
                  {year}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
            Tracks
          </h3>
          <div className="space-y-2">
            {TRACK_COLS.map((track) => {
              const active = selectedTracks.includes(track);
              return (
                <button
                  key={track}
                  type="button"
                  onClick={() => toggleTrack(track)}
                  className={`flex w-full items-start justify-between rounded-xl border px-3 py-3 text-left transition-colors ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white dark:border-[#f3f3f3] dark:bg-[#f3f3f3] dark:text-[#171717]"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-[#353535] dark:bg-[#232323] dark:text-[#c7c7c7] dark:hover:border-[#444444]"
                  }`}
                >
                  <span>
                    <span className="block text-sm font-medium">{track}</span>
                    <span
                      className={`mt-1 block text-xs ${
                        active
                          ? "text-slate-200 dark:text-[#4f4f4f]"
                          : "text-slate-500 dark:text-[#8f8f8f]"
                      }`}
                    >
                      {TRACK_NAMES[track as TrackKey]}
                    </span>
                  </span>
                  <span
                    className={`mt-0.5 h-2.5 w-2.5 rounded-full ${
                      active
                        ? "bg-white dark:bg-[#171717]"
                        : "bg-slate-200 dark:bg-[#404040]"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </section>

        <p className="text-xs leading-6 text-slate-400 dark:text-[#7d7d7d]">
          Data source: Supabase-backed views and imported research outputs inside
          the workspace.
        </p>
      </div>
    </aside>
  );
}
