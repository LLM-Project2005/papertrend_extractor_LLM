import { TRACK_COLS } from "@/lib/constants";
import type { DashboardData, TrackRow } from "@/types/database";

function matchesTrackSelection(row: TrackRow, selectedTracks: string[]): boolean {
  return TRACK_COLS.some((track) => {
    const field = track.toLowerCase() as keyof TrackRow;
    return selectedTracks.includes(track) && row[field] === 1;
  });
}

function collectFallbackPaperIds(data: DashboardData, selectedYears: string[]): Set<number> {
  return new Set<number>([
    ...data.trends
      .filter((row) => selectedYears.includes(row.year))
      .map((row) => row.paper_id),
    ...data.tracksSingle
      .filter((row) => selectedYears.includes(row.year))
      .map((row) => row.paper_id),
    ...data.tracksMulti
      .filter((row) => selectedYears.includes(row.year))
      .map((row) => row.paper_id),
  ]);
}

export function filterDashboardData(
  data: DashboardData,
  selectedYears: string[],
  selectedTracks: string[],
  searchQuery = ""
): Pick<DashboardData, "trends" | "tracksSingle" | "tracksMulti"> {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const searchMatchedPaperIds =
    normalizedQuery.length === 0
      ? null
      : new Set<number>([
          ...data.trends
            .filter((row) =>
              [
                row.title,
                row.year,
                row.topic,
                row.keyword,
                row.evidence,
              ]
                .join(" ")
                .toLowerCase()
                .includes(normalizedQuery)
            )
            .map((row) => row.paper_id),
          ...data.tracksSingle
            .filter((row) =>
              [row.title, row.year].join(" ").toLowerCase().includes(normalizedQuery)
            )
            .map((row) => row.paper_id),
          ...data.tracksMulti
            .filter((row) =>
              [row.title, row.year].join(" ").toLowerCase().includes(normalizedQuery)
            )
            .map((row) => row.paper_id),
        ]);

  const singleTrackRows = data.tracksSingle.filter(
    (row) =>
      selectedYears.includes(row.year) &&
      matchesTrackSelection(row, selectedTracks) &&
      (!searchMatchedPaperIds || searchMatchedPaperIds.has(row.paper_id))
  );

  const multiTrackRows = data.tracksMulti.filter(
    (row) =>
      selectedYears.includes(row.year) &&
      matchesTrackSelection(row, selectedTracks) &&
      (!searchMatchedPaperIds || searchMatchedPaperIds.has(row.paper_id))
  );

  const fallbackPaperIds = collectFallbackPaperIds(data, selectedYears);
  const allowedPaperIds =
    singleTrackRows.length > 0
      ? new Set(singleTrackRows.map((row) => row.paper_id))
      : multiTrackRows.length > 0
        ? new Set(multiTrackRows.map((row) => row.paper_id))
        : fallbackPaperIds;

  return {
    trends: data.trends.filter(
      (row) =>
        selectedYears.includes(row.year) &&
        allowedPaperIds.has(row.paper_id) &&
        (!searchMatchedPaperIds || searchMatchedPaperIds.has(row.paper_id))
    ),
    tracksSingle: data.tracksSingle.filter(
      (row) =>
        selectedYears.includes(row.year) &&
        allowedPaperIds.has(row.paper_id) &&
        (!searchMatchedPaperIds || searchMatchedPaperIds.has(row.paper_id))
    ),
    tracksMulti: data.tracksMulti.filter(
      (row) =>
        selectedYears.includes(row.year) &&
        allowedPaperIds.has(row.paper_id) &&
        (!searchMatchedPaperIds || searchMatchedPaperIds.has(row.paper_id))
    ),
  };
}
