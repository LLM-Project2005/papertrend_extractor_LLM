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
    <aside className="app-surface overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {description}
        </p>
      </div>

      <div className="space-y-6 px-5 py-5">
        {useMock && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            Showing preview data until Supabase is connected and populated.
          </div>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              Years
            </h3>
            <button
              type="button"
              className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
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
                      ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
                  }`}
                >
                  {year}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
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
                      ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600"
                  }`}
                >
                  <span>
                    <span className="block text-sm font-medium">{track}</span>
                    <span
                      className={`mt-1 block text-xs ${
                        active
                          ? "text-slate-200 dark:text-slate-600"
                          : "text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      {TRACK_NAMES[track as TrackKey]}
                    </span>
                  </span>
                  <span
                    className={`mt-0.5 h-2.5 w-2.5 rounded-full ${
                      active
                        ? "bg-white dark:bg-slate-900"
                        : "bg-slate-200 dark:bg-slate-700"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </section>

        <p className="text-xs leading-6 text-slate-400 dark:text-slate-500">
          Data source: Supabase-backed views and imported research outputs inside
          the workspace.
        </p>
      </div>
    </aside>
  );
}
