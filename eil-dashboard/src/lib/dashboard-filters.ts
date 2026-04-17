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

function isTrackKey(value: string): value is (typeof TRACK_COLS)[number] {
  return TRACK_COLS.includes(value as (typeof TRACK_COLS)[number]);
}

export function filterDashboardData(
  data: DashboardData,
  selectedYears: string[],
  selectedTracks: string[],
  searchQuery = ""
): Pick<DashboardData, "trends" | "tracksSingle" | "tracksMulti"> {
  const availableYears = [
    ...new Set([
      ...data.trends.map((row) => row.year),
      ...data.tracksSingle.map((row) => row.year),
      ...data.tracksMulti.map((row) => row.year),
    ]),
  ].sort();
  const years =
    selectedYears.length === 0
      ? availableYears
      : selectedYears.some((year) => availableYears.includes(year))
        ? selectedYears
        : availableYears;
  const tracks =
    selectedTracks.length > 0 && selectedTracks.some((track) => isTrackKey(track))
      ? selectedTracks.filter((track): track is (typeof TRACK_COLS)[number] =>
          isTrackKey(track)
        )
      : [...TRACK_COLS];
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
      years.includes(row.year) &&
      matchesTrackSelection(row, tracks) &&
      (!searchMatchedPaperIds || searchMatchedPaperIds.has(row.paper_id))
  );

  const multiTrackRows = data.tracksMulti.filter(
    (row) =>
      years.includes(row.year) &&
      matchesTrackSelection(row, tracks) &&
      (!searchMatchedPaperIds || searchMatchedPaperIds.has(row.paper_id))
  );

  const fallbackPaperIds = collectFallbackPaperIds(data, years);
  const allowedPaperIds =
    singleTrackRows.length > 0
      ? new Set(singleTrackRows.map((row) => row.paper_id))
      : multiTrackRows.length > 0
        ? new Set(multiTrackRows.map((row) => row.paper_id))
        : fallbackPaperIds;

  return {
    trends: data.trends.filter(
      (row) =>
        years.includes(row.year) &&
        allowedPaperIds.has(row.paper_id) &&
        (!searchMatchedPaperIds || searchMatchedPaperIds.has(row.paper_id))
    ),
    tracksSingle: data.tracksSingle.filter(
      (row) =>
        years.includes(row.year) &&
        allowedPaperIds.has(row.paper_id) &&
        (!searchMatchedPaperIds || searchMatchedPaperIds.has(row.paper_id))
    ),
    tracksMulti: data.tracksMulti.filter(
      (row) =>
        years.includes(row.year) &&
        allowedPaperIds.has(row.paper_id) &&
        (!searchMatchedPaperIds || searchMatchedPaperIds.has(row.paper_id))
    ),
  };
}
