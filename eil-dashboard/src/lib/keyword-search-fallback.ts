import { TRACK_COLS, TRACK_NAMES, type TrackKey } from "@/lib/constants";
import { filterDashboardData } from "@/lib/dashboard-filters";
import { isDatedYear } from "@/lib/dated-year";
import { loadDashboardDataServer } from "@/lib/dashboard-data-server";
import type { CategoryAssignmentRow, PaperId, TrackRow } from "@/types/database";
import type { KeywordSearchRequest, KeywordSearchResponse } from "@/types/keyword-search";

function toTrackField(track: TrackKey) {
  return track.toLowerCase() as "el" | "eli" | "lae" | "other";
}

function extractTracks(row: TrackRow | undefined): string[] {
  if (!row) {
    return [];
  }

  return TRACK_COLS.filter((track) => Number(row[toTrackField(track)]) === 1).map(
    (track) => `${track} - ${TRACK_NAMES[track]}`
  );
}

/**
 * A paper's categories in the repository's own taxonomy. The legacy
 * el/eli/lae/other slots carry EIL names even for a custom taxonomy, so they
 * are used only for workspaces that have no category assignments at all.
 */
function paperCategoryLabels(
  assignments: CategoryAssignmentRow[] | undefined,
  paperId: PaperId,
  type: "single" | "multi",
  legacy: TrackRow | undefined
): string[] {
  if (!assignments?.length) return extractTracks(legacy);
  return [
    ...new Set(
      assignments
        .filter((row) => row.paper_id === paperId && row.assignment_type === type && row.category_key !== "other")
        .map((row) => String(row.category_label || row.category_key))
    ),
  ];
}

export async function runKeywordSearchFallback(
  request: KeywordSearchRequest,
  ownerUserId?: string | null
): Promise<KeywordSearchResponse> {
  const data = await loadDashboardDataServer(
    ownerUserId,
    request.folderIds && request.folderIds.length > 0 ? request.folderIds : null,
    request.projectId && request.projectId !== "all" ? request.projectId : null
  );
  const selectedYears =
    request.selectedYears && request.selectedYears.length > 0
      ? request.selectedYears
      : [...new Set(data.trends.map((row) => row.year))].sort();
  const selectedTracks =
    request.selectedTracks && request.selectedTracks.length > 0
      ? request.selectedTracks
      : [...TRACK_COLS];

  const filtered = filterDashboardData(data, selectedYears, selectedTracks, "");
  const query = request.query.trim().toLowerCase();
  const matchedFamily =
    filtered.topicFamilies?.find((family) =>
      [
        family.canonicalTopic,
        ...family.aliases,
        ...family.representativeKeywords,
        ...family.relatedKeywords,
        ...family.evidenceSnippets,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    ) ?? null;
  const matchedRows = filtered.trends.filter((row) =>
    matchedFamily
      ? row.topic === matchedFamily.canonicalTopic
      : [row.keyword, row.topic, row.evidence, row.title].join(" ").toLowerCase().includes(query)
  );

  if (matchedRows.length === 0) {
    const suggestions = [
      ...new Set(
        [
          ...filtered.trends.map((row) => row.keyword),
          ...(filtered.topicFamilies ?? []).flatMap((family) => [
            family.canonicalTopic,
            ...family.aliases,
          ]),
        ].filter((keyword) => keyword.toLowerCase().includes(query.slice(0, 4)))
      ),
    ].slice(0, 6);

    return {
      canonicalConcept: request.query,
      matchedTerms: [],
      firstAppearance: null,
      timeline: [],
      trackSpread: [],
      cooccurringConcepts: [],
      objectiveVerbs: [],
      contributionTypes: [],
      papers: [],
      evidence: [],
      summary: `No grounded concept family was found for "${request.query}" in this repository.`,
      notFound: true,
      suggestedConcepts: suggestions,
      source: "repository",
    };
  }

  const tracksByPaper = new Map(filtered.tracksSingle.map((row) => [row.paper_id, row]));
  const tracksMultiByPaper = new Map(filtered.tracksMulti.map((row) => [row.paper_id, row]));
  const matchedTerms =
    matchedFamily?.aliases.slice(0, 12) ??
    [...new Set(matchedRows.map((row) => row.keyword))].slice(0, 12);
  const canonicalConcept = matchedFamily?.canonicalTopic ?? matchedTerms[0] ?? request.query;

  // Undated papers have no place on a timeline ("Unknown" sorted after the
  // latest year and was drawn as the most recent period).
  const timelineMap = new Map<string, { frequency: number; paperIds: Set<PaperId> }>();
  matchedRows.filter((row) => isDatedYear(row.year)).forEach((row) => {
    const entry = timelineMap.get(row.year) ?? { frequency: 0, paperIds: new Set<PaperId>() };
    entry.frequency += row.keyword_frequency;
    entry.paperIds.add(row.paper_id);
    timelineMap.set(row.year, entry);
  });
  const timeline = [...timelineMap.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([year, value]) => ({
      year,
      frequency: value.frequency,
      papers: value.paperIds.size,
    }));

  const firstRow = [...matchedRows].sort(
    (left, right) =>
      Number(!isDatedYear(left.year)) - Number(!isDatedYear(right.year)) || left.year.localeCompare(right.year)
  )[0];
  const firstAppearance = firstRow
    ? {
        paperId: firstRow.paper_id,
        title: firstRow.title,
        year: firstRow.year,
        tracksSingle: paperCategoryLabels(filtered.categoryAssignments, firstRow.paper_id, "single", tracksByPaper.get(firstRow.paper_id)),
        tracksMulti: paperCategoryLabels(filtered.categoryAssignments, firstRow.paper_id, "multi", tracksMultiByPaper.get(firstRow.paper_id)),
        section: "evidence",
        snippet: firstRow.evidence,
      }
    : null;

  const trackSpread = TRACK_COLS.map((track) => ({
    track,
    papers: [...new Set(matchedRows.map((row) => row.paper_id))].filter((paperId) => {
      const trackRow = tracksByPaper.get(paperId);
      return trackRow ? trackRow[toTrackField(track)] === 1 : false;
    }).length,
  })).filter((entry) => entry.papers > 0);

  const cooccurringConcepts = Object.entries(
    filtered.trends.reduce<Record<string, number>>((accumulator, row) => {
      if (
        !matchedRows.some((match) => match.paper_id === row.paper_id) ||
        row.topic === canonicalConcept
      ) {
        return accumulator;
      }
      accumulator[row.topic] = (accumulator[row.topic] ?? 0) + row.keyword_frequency;
      return accumulator;
    }, {})
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([label, weight]) => ({ label, weight }));

  const paperIds = [...new Set(matchedRows.map((row) => row.paper_id))];
  const papers = paperIds.slice(0, 8).map((paperId) => {
    const paperRows = matchedRows.filter((row) => row.paper_id === paperId);
    const first = paperRows[0];
    return {
      paperId,
      title: first.title,
      year: first.year,
      tracksSingle: paperCategoryLabels(filtered.categoryAssignments, paperId, "single", tracksByPaper.get(paperId)),
      tracksMulti: paperCategoryLabels(filtered.categoryAssignments, paperId, "multi", tracksMultiByPaper.get(paperId)),
      matchedTerms: [...new Set(paperRows.map((row) => row.keyword))],
      evidence: paperRows.map((row) => row.evidence).filter(Boolean).slice(0, 3),
    };
  });

  return {
    canonicalConcept,
    matchedTerms,
    firstAppearance,
    timeline,
    trackSpread,
    cooccurringConcepts,
    objectiveVerbs: [],
    contributionTypes: [],
    papers,
    evidence: matchedRows.slice(0, 10).map((row) => ({
      paperId: row.paper_id,
      year: row.year,
      title: row.title,
      section: "evidence",
      snippet: row.evidence,
    })),
    summary: `${canonicalConcept} appears in ${paperIds.length} paper${paperIds.length === 1 ? "" : "s"} in this repository.`,
    notFound: false,
    suggestedConcepts: [],
    source: "repository",
  };
}
