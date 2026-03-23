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
  title = "Dashboard filters",
  description = "Narrow the active workspace dataset by year and track before exploring the analytics modules.",
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
    <aside className="rounded-[28px] bg-sidebar-bg text-sidebar-text shadow-sm">
      <div className="flex h-full flex-col p-5">
        <h2 className="text-xl font-bold text-sidebar-heading">{title}</h2>
        <p className="mt-2 text-xs leading-relaxed text-sidebar-muted">
          {description}
        </p>

        <hr className="mb-4 mt-5 border-sidebar-divider" />

        {useMock && (
          <div className="mb-4 rounded-md border border-sidebar-alert-border bg-sidebar-alert px-3 py-2 text-xs text-sidebar-muted">
            Showing mock preview data. Connect Supabase or run the extraction
            pipeline to load real results.
          </div>
        )}

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sidebar-muted">
          Filter by Year
        </h3>
        <div className="mb-4 max-h-52 overflow-y-auto space-y-1 pr-1">
          <button
            className="mb-1 text-[11px] text-blue-300 hover:underline"
            onClick={() =>
              onYearsChange(
                selectedYears.length === allYears.length ? [] : [...allYears]
              )
            }
          >
            {selectedYears.length === allYears.length
              ? "Deselect all"
              : "Select all"}
          </button>

          {allYears.map((year) => (
            <label
              key={year}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={selectedYears.includes(year)}
                onChange={() => toggleYear(year)}
                className="rounded border-sidebar-divider text-blue-500 focus:ring-blue-500/30"
              />
              {year}
            </label>
          ))}
        </div>

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sidebar-muted">
          Filter by Track
        </h3>
        <div className="mb-4 space-y-1">
          {TRACK_COLS.map((track) => (
            <label
              key={track}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={selectedTracks.includes(track)}
                onChange={() => toggleTrack(track)}
                className="rounded border-sidebar-divider text-blue-500 focus:ring-blue-500/30"
              />
              <span>
                {track}{" "}
                <span className="text-xs text-sidebar-muted">
                  - {TRACK_NAMES[track as TrackKey]}
                </span>
              </span>
            </label>
          ))}
        </div>

        <hr className="my-3 border-sidebar-divider" />

        <p className="mt-auto text-[11px] leading-relaxed text-sidebar-muted">
          <strong>Data source:</strong> Supabase-backed views and imported research
          outputs inside the workspace.
        </p>
      </div>
    </aside>
  );
}
