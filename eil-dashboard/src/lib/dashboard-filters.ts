import { TRACK_COLS } from "@/lib/constants";
import type { DashboardData, TrackRow } from "@/types/database";

function matchesTrackSelection(
  row: TrackRow,
  selectedTracks: string[]
): boolean {
  return TRACK_COLS.some((track) => {
    const field = track.toLowerCase() as keyof TrackRow;
    return selectedTracks.includes(track) && row[field] === 1;
  });
}

export function filterDashboardData(
  data: DashboardData,
  selectedYears: string[],
  selectedTracks: string[]
): Pick<DashboardData, "trends" | "tracksSingle" | "tracksMulti"> {
  const filteredTrackRows = data.tracksSingle.filter(
    (row) =>
      selectedYears.includes(row.year) && matchesTrackSelection(row, selectedTracks)
  );

  const allowedPaperIds = new Set(filteredTrackRows.map((row) => row.paper_id));

  return {
    trends: data.trends.filter(
      (row) => selectedYears.includes(row.year) && allowedPaperIds.has(row.paper_id)
    ),
    tracksSingle: filteredTrackRows,
    tracksMulti: data.tracksMulti.filter(
      (row) => selectedYears.includes(row.year) && allowedPaperIds.has(row.paper_id)
    ),
  };
}
