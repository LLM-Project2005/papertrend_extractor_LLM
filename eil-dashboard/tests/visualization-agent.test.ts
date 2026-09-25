import assert from "node:assert/strict";
import test from "node:test";
import { themeShifts } from "../src/lib/dashboard-analytics";
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
  assert.match(source, /const datedYears = availableYears\.filter\(isDatedYear\)/);
  // The timeline is every year from the first dated one to the last, so an
  // undated paper has no slot to be plotted in.
  assert.match(source, /const axisYears = yearAxis\(datedYears\)\.years;/);
  assert.match(source, /const yearlyPaperTrend = axisYears\.map\(/);
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
  // The split now lives in one shared function, used by the planner, the Trend
  // tab and the adaptive tab; it only ever reads dated papers.
  assert.match(planner(), /const shifts = themeShifts\(subject\);/);
  const rows = [
    ...["1", "2", "3"].map((id) => ({ paper_id: id, year: "2018", topic: "Old", keyword: "k", keyword_frequency: 1, evidence: "", title: id })),
    ...["4", "5", "6"].map((id) => ({ paper_id: id, year: "2024", topic: "Other", keyword: "k", keyword_frequency: 1, evidence: "", title: id })),
    ...["7", "8", "9", "10"].map((id) => ({ paper_id: id, year: "Unknown", topic: "Old", keyword: "k", keyword_frequency: 1, evidence: "", title: id })),
  ];
  const result = themeShifts(rows);
  assert.equal(result.emerging.some((shift) => shift.topic === "Old"), false, "undated papers are not recent growth");
  assert.equal(result.periods?.earlyPapers, 3);
  assert.equal(result.periods?.latePapers, 3, "the four undated papers are in neither period");
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

test("a chart the agent planned but the data could not support is named", () => {
  // Only the render layer knows whether the data supports drawing a chart, and
  // the narrative above it was written before that decision. The live section
  // promised "track comparisons" while the comparison chart was being
  // suppressed for having a single topic.
  const tab = readFileSync(
    new URL("../src/components/dashboard/AdaptiveDashboardTab.tsx", import.meta.url),
    "utf8"
  );
  assert.match(tab, /const droppedCharts = planned\.filter\(\(entry\) => !entry\.node\)/);
  assert.match(tab, /planned and not drawn, because this data does not support/);
});

/* ------------------------------ the same bug had two more homes than we knew */

test("the coverage metric is a span between two dates, not a date and a word", () => {
  // Found on the deployed pilot, on the first screen after signing in:
  //
  //   COVERAGE
  //   2016 to Unknown
  //   Publication year span
  //
  // The third and fourth place this bug lived. "Unknown" sorts after "2026" as
  // a string, so it became the end of every year span. Both of these build
  // their own year list, which is exactly how the planner fix failed to reach
  // the dashboard tab, and how both of those failed to reach here.
  for (const relative of [
    "../src/components/workspace/WorkspaceHomeClient.tsx",
    "../src/components/tabs/Overview.tsx",
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /import \{ isDatedYear \} from "@\/lib\/dated-year"/, `${relative} must use the predicate`);
    assert.match(source, /\.filter\(isDatedYear\)/, `${relative} must filter its year list`);
  }
});

test("every component that draws a year axis runs through one predicate", () => {
  // Eight independent implementations of "which years are real" is how this bug
  // survived three separate fixes: the planner, then the adaptive tab, then the
  // coverage metric - and it was still drawing an "Unknown" bar on the default
  // dashboard tab. This list is every surface that puts a year on an axis or a
  // heatmap column.
  for (const relative of [
    "../src/lib/visualization-planner.ts",
    "../src/components/dashboard/AdaptiveDashboardTab.tsx",
    "../src/components/workspace/WorkspaceHomeClient.tsx",
    "../src/components/tabs/Overview.tsx",
    "../src/components/tabs/TrendAnalysis.tsx",
    "../src/components/tabs/TrackAnalysis.tsx",
    "../src/components/tabs/KeywordExplorer.tsx",
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(
      source,
      /isDatedYear|yearAxis\(/,
      `${relative} puts years on an axis and must use the predicate, directly or through yearAxis`
    );
  }
  const shared = readFileSync(new URL("../src/lib/dashboard-analytics.ts", import.meta.url), "utf8");
  const axis = shared.slice(shared.indexOf("export function yearAxis"), shared.indexOf("export function undatedPaperCount"));
  assert.match(axis, /filter\(isDatedYear\)/, "yearAxis itself runs through the predicate");
});

test("an undated paper is still visible where a year is a fact about one paper", () => {
  // The predicate belongs on temporal axes, not everywhere a year appears. A
  // paper whose year could not be read should still say so in the paper list,
  // and a reader filtering for "Unknown" to find those papers is doing
  // something useful - so neither of these may quietly start hiding them.
  for (const relative of [
    "../src/components/DashboardClient.tsx",
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.equal(
      /isDatedYear/.test(source),
      false,
      `${relative} shows a year as a fact, not as a position in time`
    );
  }
});

test("a model plan with no chart the data supports is treated as the fallback", async () => {
  const { planHasViableChart } = await import("../src/lib/visualization-planner");
  const viable = ["adaptive_year_volume", "adaptive_topic_distribution"] as Parameters<typeof planHasViableChart>[1];
  const plan = (keys: string[]) => ({ sections: [{ section_key: "adaptive", charts: keys.map((chart_key) => ({ chart_key })) }] });
  assert.equal(planHasViableChart(plan(["adaptive_keyword_family_heatmap"]), viable), false);
  assert.equal(planHasViableChart(plan([]), viable), false);
  assert.equal(planHasViableChart(null, viable), false);
  assert.equal(planHasViableChart(plan(["adaptive_year_volume"]), viable), true);
});
