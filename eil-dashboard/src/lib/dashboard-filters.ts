import { TRACK_COLS } from "@/lib/constants";
import type { DashboardData, PaperId, TrackRow } from "@/types/database";

function matchesTrackSelection(row: TrackRow, selectedTracks: string[]): boolean {
  return TRACK_COLS.some((track) => {
    const field = track.toLowerCase() as keyof TrackRow;
    return selectedTracks.includes(track) && row[field] === 1;
  });
}

function collectFallbackPaperIds(data: DashboardData, selectedYears: string[]): Set<PaperId> {
  return new Set<PaperId>([
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
): Pick<DashboardData, "trends" | "tracksSingle" | "tracksMulti" | "topicFamilies"> {
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
      : new Set<PaperId>([
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

  const filteredTrends = data.trends.filter(
    (row) =>
      years.includes(row.year) &&
      allowedPaperIds.has(row.paper_id) &&
      (!searchMatchedPaperIds || searchMatchedPaperIds.has(row.paper_id))
  );
  const filteredTracksSingle = data.tracksSingle.filter(
    (row) =>
      years.includes(row.year) &&
      allowedPaperIds.has(row.paper_id) &&
      (!searchMatchedPaperIds || searchMatchedPaperIds.has(row.paper_id))
  );
  const filteredTracksMulti = data.tracksMulti.filter(
    (row) =>
      years.includes(row.year) &&
      allowedPaperIds.has(row.paper_id) &&
      (!searchMatchedPaperIds || searchMatchedPaperIds.has(row.paper_id))
  );
  const trendRowsByTopic = filteredTrends.reduce<Record<string, typeof filteredTrends>>(
    (accumulator, row) => {
      (accumulator[row.topic] ??= []).push(row);
      return accumulator;
    },
    {}
  );

  return {
    trends: filteredTrends,
    tracksSingle: filteredTracksSingle,
    tracksMulti: filteredTracksMulti,
    topicFamilies: (data.topicFamilies ?? [])
      .map((family) => {
        const scopedTrendRows = trendRowsByTopic[family.canonicalTopic] ?? [];
        const scopedPaperIds = [...new Set(scopedTrendRows.map((row) => row.paper_id))];
        if (scopedPaperIds.length === 0) {
          return null;
        }

        return {
          ...family,
          paperIds: scopedPaperIds,
          folderIds: [
            ...new Set(
              scopedTrendRows
                .map((row) => row.folder_id)
                .filter((value): value is string => Boolean(value))
            ),
          ],
          years: [...new Set(scopedTrendRows.map((row) => row.year))].sort(),
          totalKeywordFrequency: scopedTrendRows.reduce(
            (sum, row) => sum + row.keyword_frequency,
            0
          ),
          representativeKeywords: Object.entries(
            scopedTrendRows.reduce<Record<string, number>>((accumulator, row) => {
              accumulator[row.keyword] =
                (accumulator[row.keyword] ?? 0) + row.keyword_frequency;
              return accumulator;
            }, {})
          )
            .sort((left, right) => right[1] - left[1])
            .slice(0, 8)
            .map(([keyword]) => keyword),
        };
      })
      .filter((family): family is NonNullable<typeof family> => Boolean(family)),
  };
}
