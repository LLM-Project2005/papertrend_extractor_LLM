import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getViableAdaptiveCharts } from "../src/lib/visualization-planner";
import { isDatedYear } from "../src/lib/dated-year";
import type { NormalizedAnalyticsPayload } from "../src/types/visualization";

function planner(): string {
  return readFileSync(new URL("../src/lib/visualization-planner.ts", import.meta.url), "utf8");
}

/** A payload with only the fields a given gate reads. */
function analytics(overrides: Partial<NormalizedAnalyticsPayload> = {}): NormalizedAnalyticsPayload {
  return {
    mode: "live",
    approved_chart_types: [],
    filters: {
      selected_years: [],
      selected_tracks: [],
      search_query: "",
      folder_ids: [],
      all_folders_selected: true,
    },
    overview: {
      paper_count: 0,
      topic_count: 0,
      keyword_count: 0,
      year_range: "No data",
      available_years: [],
      papers_without_year: 0,
      folder_count: 0,
    },
    canonical_topic_families: [],
    yearly_paper_trend: [],
    track_totals: { single: [], multi: [] },
    top_topics_over_time: [],
    folder_topic_totals: [],
    yearly_topic_totals: [],
    keyword_heatmap: { years: [], rows: [] },
    topic_shifts: { emerging: [], declining: [] },
    topic_by_track_totals: [],
    ...overrides,
  } as NormalizedAnalyticsPayload;
}

/* --------------------------------------------- "Unknown" is not a point in time */

test("a four-digit year is a date and anything else is not", () => {
  assert.equal(isDatedYear("2016"), true);
  assert.equal(isDatedYear(" 2026 "), true);
  assert.equal(isDatedYear("Unknown"), false);
  assert.equal(isDatedYear(""), false);
  assert.equal(isDatedYear("n/a"), false);
  assert.equal(isDatedYear("20255"), false, "a five-digit value is not a year");
  assert.equal(isDatedYear("16"), false);
});

test("the timeline excludes undated papers instead of plotting them last", () => {
  // Sorted as a string, "Unknown" lands after "2026". The live chart was titled
  // "Publication Volume Trends from 2016 to Unknown" and drew it as the most
  // recent period.
  const source = planner();
  assert.match(source, /\.filter\(\(row\) => isDatedYear\(row\.year\)\)/);
  assert.match(source, /const datedYears = availableYears\.filter\(isDatedYear\)/);
});

test("the year range is read from dated years only", () => {
  const source = planner();
  const range = source.slice(source.indexOf("const yearRange ="), source.indexOf("const yearlyPaperTrend"));
  assert.match(range, /datedYears\[0\]/);
  assert.equal(/availableYears\[0\]/.test(range), false, "the range must not start from an undated value");
});

test("an undated paper is not counted as recent when deciding what is emerging", () => {
  // This is the damaging one. availableYears ends with "Unknown", the split
  // takes the back half as "late", so every paper with no recorded year counted
  // as evidence of recent growth in every emerging-topic ranking.
  const source = planner();
  const split = source.slice(source.indexOf("const midpoint ="), source.indexOf("const topicShifts"));
  assert.match(split, /datedYears/);
  assert.equal(
    /availableYears/.test(split),
    false,
    "the early/late split must not use undated years"
  );
});

test("undated papers are counted and reported rather than silently dropped", () => {
  // Excluding them from the timeline is right; hiding that they exist is not.
  const source = planner();
  assert.match(source, /const papersWithoutYear = new Set\(/);
  assert.match(source, /papers_without_year: papersWithoutYear/);
});

/* --------------------------------------------------- the comparison chart gate */

test("a track comparison needs at least two topics to compare", () => {
  // The live chart had one topic on the axis and a legend of four tracks, two
  // of which drew nothing.
  const oneTopic = analytics({
    topic_by_track_totals: [
      { track: "EL", topics: [{ topic: "Feedback", papers: 1 }] },
      { track: "ELI", topics: [{ topic: "Feedback", papers: 6 }] },
    ],
  } as Partial<NormalizedAnalyticsPayload>);
  assert.equal(
    getViableAdaptiveCharts(oneTopic).includes("adaptive_track_topic_comparison"),
    false,
    "one topic across two tracks is not a comparison"
  );
});

test("a track comparison with two topics across two tracks is offered", () => {
  const twoTopics = analytics({
    topic_by_track_totals: [
      { track: "EL", topics: [{ topic: "Feedback", papers: 3 }, { topic: "Autonomy", papers: 2 }] },
      { track: "ELI", topics: [{ topic: "Feedback", papers: 6 }] },
    ],
  } as Partial<NormalizedAnalyticsPayload>);
  assert.ok(getViableAdaptiveCharts(twoTopics).includes("adaptive_track_topic_comparison"));
});

test("a single track is never offered a comparison, however many topics it has", () => {
  const oneTrack = analytics({
    topic_by_track_totals: [
      { track: "EL", topics: [{ topic: "A", papers: 3 }, { topic: "B", papers: 2 }, { topic: "C", papers: 1 }] },
    ],
  } as Partial<NormalizedAnalyticsPayload>);
  assert.equal(
    getViableAdaptiveCharts(oneTrack).includes("adaptive_track_topic_comparison"),
    false
  );
});

/* ------------------------------------------------------- the other gates still hold */

test("a timeline needs two dated years", () => {
  assert.equal(
    getViableAdaptiveCharts(analytics({ yearly_paper_trend: [{ year: "2016", papers: 3 }] })).includes(
      "adaptive_year_volume"
    ),
    false
  );
  assert.ok(
    getViableAdaptiveCharts(
      analytics({ yearly_paper_trend: [{ year: "2016", papers: 3 }, { year: "2017", papers: 4 }] })
    ).includes("adaptive_year_volume")
  );
});

test("an empty repository is offered no charts at all", () => {
  // Better an empty state than four charts of nothing.
  assert.deepEqual(getViableAdaptiveCharts(analytics()), []);
});

test("the chart says how many papers it leaves out", () => {
  // Excluding undated papers from the timeline is right; hiding that they exist
  // turns a correct chart into a misleading one, because the bars no longer add
  // up to the paper count on the card above them.
  const tab = readFileSync(
    new URL("../src/components/dashboard/AdaptiveDashboardTab.tsx", import.meta.url),
    "utf8"
  );
  assert.match(tab, /analytics\.overview\.papers_without_year > 0 \?/);
  assert.match(tab, /no publication year could be read/);
  assert.match(tab, /A missing year is not a\s*\n?\s*period/);
});

/* ------------------------------------ the same bug lived in two places */

test("the dashboard component also refuses to treat Unknown as a year", () => {
  // The planner and this component each do their own early/late split, so
  // fixing the planner did not reach the chart a reader actually sees. Every
  // use of this year list is a temporal axis: the heatmap columns, the momentum
  // series, and the split that decides what counts as emerging.
  const tab = readFileSync(
    new URL("../src/components/dashboard/AdaptiveDashboardTab.tsx", import.meta.url),
    "utf8"
  );
  const yearsDecl = tab.slice(tab.indexOf("const years ="), tab.indexOf("const singleTrackByPaper"));
  assert.match(yearsDecl, /\.filter\(isDatedYear\)/);
});

test("a comparison chart with one topic is not rendered", () => {
  const tab = readFileSync(
    new URL("../src/components/dashboard/AdaptiveDashboardTab.tsx", import.meta.url),
    "utf8"
  );
  assert.match(tab, /if \(filteredChartData\.length < 2\) \{/);
});

test("the legend lists only tracks that actually draw a bar", () => {
  // Four colours in the legend, two of which drew nothing, read as a broken
  // chart rather than as a finding.
  const tab = readFileSync(
    new URL("../src/components/dashboard/AdaptiveDashboardTab.tsx", import.meta.url),
    "utf8"
  );
  assert.match(tab, /const drawnTracks = supportedTracks\.filter/);
  assert.match(tab, /\{drawnTracks\.map\(\(track\) => \(/);
});

test("the year predicate stays out of the browser bundle's way", () => {
  // The planner reaches the database. Importing the predicate from there pulled
  // `pg` into the client bundle and broke the build, which is the only reason
  // that mistake was caught rather than shipped.
  const tab = readFileSync(
    new URL("../src/components/dashboard/AdaptiveDashboardTab.tsx", import.meta.url),
    "utf8"
  );
  assert.match(tab, /import \{ isDatedYear \} from "@\/lib\/dated-year"/);
  assert.equal(
    /from "@\/lib\/visualization-planner"/.test(tab),
    false,
    "a client component must not import the planner"
  );
});
