import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  keywordPaperCounts,
  likelyDuplicatePapers,
  methodRows,
  subjectRows,
  themePaperCounts,
  themeShifts,
  undatedPaperCount,
  yearAxis,
} from "../src/lib/dashboard-analytics";
import { filterDashboardData } from "../src/lib/dashboard-filters";
import type { DashboardData, TrendRow } from "../src/types/database";

function read(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

function row(paper: string, year: string, topic: string, keyword = "k", extra: Partial<TrendRow> = {}): TrendRow {
  return { paper_id: paper, year, title: `Paper ${paper}`, topic, keyword, keyword_frequency: 1, evidence: "", ...extra };
}

/** `count` papers in `year` for `topic`, with ids from `from`. */
function papers(from: number, count: number, year: string, topic: string): TrendRow[] {
  return Array.from({ length: count }, (_, i) => row(String(from + i), year, topic));
}

/* ------------------------------------------------------------------- time */

test("a year axis spaces years as time, and names the empty ones (C2)", () => {
  // Test 2 has papers in 2016, 2017, 2025 and 2026. Drawn at equal spacing,
  // 2017 and 2025 were neighbours and a smooth area ran through eight empty years.
  const axis = yearAxis(["2016", "2017", "2025", "2026", "Unknown"]);
  assert.equal(axis.years.length, 11);
  assert.equal(axis.years[0], "2016");
  assert.equal(axis.years[10], "2026");
  assert.deepEqual(axis.empty, ["2018", "2019", "2020", "2021", "2022", "2023", "2024"]);
  assert.equal(axis.years.includes("Unknown"), false, "a missing year is not a period (C1)");
});

test("papers without a year are counted, not dropped", () => {
  assert.equal(undatedPaperCount([row("1", "2020", "A"), row("2", "Unknown", "A"), row("2", "Unknown", "B")]), 1);
});

/* ----------------------------------------------------------------- counts */

test("keywords rank by the papers that use them, not by one paper's repetition (D9)", () => {
  const rows = [
    row("1", "2020", "A", "tone groups", { keyword_frequency: 15 }),
    ...["2", "3", "4", "5", "6"].map((id) => row(id, "2020", "A", "learner autonomy")),
    row("7", "2020", "A", "Learner Autonomy"),
  ];
  const ranked = keywordPaperCounts(rows);
  assert.equal(ranked[0].papers, 6, "spelling variants are one keyword");
  assert.equal(ranked[0].keyword, "learner autonomy");
  assert.equal(ranked[1].keyword, "tone groups");
  assert.equal(ranked[1].occurrences, 15, "occurrences are kept, for the tooltip");
});

test("themes rank by papers", () => {
  const ranked = themePaperCounts([...papers(1, 3, "2020", "B"), row("1", "2020", "A"), row("1", "2021", "A")]);
  assert.deepEqual(ranked.map((entry) => [entry.topic, entry.papers]), [["B", 3], ["A", 1]]);
});

test("method themes are kept out of topic charts and shown on their own", () => {
  const rows = [row("1", "2020", "Dynamic Assessment"), row("1", "2020", "Mixed-Methods Design", "k", { topic_kind: "method" })];
  assert.deepEqual(subjectRows(rows).map((r) => r.topic), ["Dynamic Assessment"]);
  assert.deepEqual(methodRows(rows).map((r) => r.topic), ["Mixed-Methods Design"]);
});

/* ----------------------------------------------------------------- shifts */

test("the collection is halved by papers, not by distinct years", () => {
  // One paper a year for 2017-2024, then eight papers in 2025. Halving the nine
  // distinct years set 2017-2020 (4 papers) against 2021-2025 (12); halving the
  // papers gives 8 against 8.
  const rows = [
    ...["2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024"].map((year, i) => row(`y${i}`, year, "X")),
    ...papers(100, 8, "2025", "X"),
  ];
  const { periods } = themeShifts(rows);
  assert.ok(periods);
  assert.equal(periods!.earlyPapers, 8);
  assert.equal(periods!.latePapers, 8);
  assert.equal(periods!.lateLabel, "2025");
});

test("no emerging or declining claim rests on a single paper (C3)", () => {
  // Every declining bar on the test repository was -1: one paper early, none late.
  const onePaper = [...papers(1, 10, "2018", "Filler"), ...papers(20, 10, "2024", "Filler"), row("99", "2018", "Lonely")];
  const shifts = themeShifts(onePaper);
  assert.equal(shifts.declining.some((s) => s.topic === "Lonely"), false);

  // Five of the ten later papers and none of the ten earlier: a lean that
  // survives removing any one of them is a shift.
  const rows = [
    ...papers(1, 10, "2018", "Filler"),
    ...papers(20, 10, "2024", "Filler"),
    ...["20", "21", "22", "23", "24"].map((id) => row(id, "2024", "Rising")),
  ];
  const rising = themeShifts(rows);
  assert.equal(rising.emerging.map((s) => s.topic).includes("Rising"), true, "five later papers against none earlier is a shift");
});

test("a theme that keeps pace with a growing collection is not emerging", () => {
  // 13 papers before, 24 after; 2 then 4 is the same share.
  const rows = [
    ...papers(1, 11, "2019", "Filler"),
    ...papers(100, 2, "2019", "Steady"),
    ...papers(200, 20, "2024", "Filler"),
    ...papers(300, 4, "2024", "Steady"),
  ];
  const shifts = themeShifts(rows);
  assert.equal(shifts.emerging.some((s) => s.topic === "Steady"), false);
  assert.equal(shifts.declining.some((s) => s.topic === "Steady"), false);
});

/* --------------------------------------------------------- categories */

test("with classification off, categories neither chart nor filter anything (D8)", () => {
  // Thirty default "Other / Unclassified" rows covered 15 of 21 papers; filtering
  // by them dropped every real paper.
  const data: DashboardData = {
    trends: [row("1", "2024", "A"), row("2", "2024", "B")],
    tracksSingle: [],
    tracksMulti: [],
    categoryAssignments: [
      { paper_id: "1", year: "2024", title: "Paper 1", category_key: "other", category_label: "Other / Unclassified", assignment_type: "single" },
    ],
    useMock: false,
    classificationEnabled: false,
  };
  const filtered = filterDashboardData(data, [], ["other"], "", ["other"]);
  assert.equal(filtered.categoryAssignments?.length ?? 0, 0);
  assert.equal(new Set(filtered.trends.map((r) => r.paper_id)).size, 2, "no paper is dropped for lacking a category");
});

test("the server does not serve category rows for a repository that does not classify", () => {
  const server = read("src/lib/dashboard-data-server.ts");
  assert.match(server, /classificationEnabled \? loaded : \{ \.\.\.loaded, categoryAssignments: \[\] \}/);
  const planner = read("src/lib/visualization-planner.ts");
  assert.match(planner, /\(classificationEnabled \? TRACK_COLS : \[\]\)/, "no track chart can be planned");
});

/* ---------------------------------------------------------- the interface */

test("the planner panel belongs to the Adaptive tab, and no data pill remains (U2)", () => {
  const client = read("src/components/DashboardClient.tsx");
  assert.match(client, /\{isAdaptiveTab \? <section className="app-surface px-4 py-4 sm:px-5">/);
  assert.equal(/"Live data"|Preview data/.test(client.replace(/\/\*[\s\S]*?\*\//g, "")), false);
});

test("the category chip tells the truth about classification (U3)", () => {
  const client = read("src/components/DashboardClient.tsx");
  assert.match(client, /: "Categories off"\}/);
  const track = read("src/components/tabs/TrackAnalysis.tsx");
  assert.match(track, /if \(!classificationEnabled\) \{/);
  assert.match(track, /<CategoriesOffNotice \/>/);
});

test("each fixed tab opens with a takeaway computed from its own numbers (U4)", () => {
  for (const file of [
    "src/components/tabs/Overview.tsx",
    "src/components/tabs/TrendAnalysis.tsx",
    "src/components/tabs/TrackAnalysis.tsx",
    "src/components/tabs/KeywordExplorer.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /<Takeaway>/, `${file} has no takeaway`);
    assert.equal(/createChatCompletion|fetch\("\/api\/chat/.test(source), false, `${file} must not ask a model for it`);
  }
});

test("no heatmap draws a row of zeros (C4)", () => {
  const explorer = read("src/components/tabs/KeywordExplorer.tsx");
  assert.match(explorer, /\.filter\(\(row\) => row\.values\.some\(\(value\) => value > 0\)\)/);
  const adaptive = read("src/components/dashboard/AdaptiveDashboardTab.tsx");
  assert.match(adaptive, /\.filter\(\(row\) => row\.values\.some\(\(value\) => value > 0\)\)/);
  const planner = read("src/lib/visualization-planner.ts");
  assert.match(planner, /\.filter\(\(row\) => row\.totals_by_year\.some\(\(value\) => value > 0\)\)/);
});

test("the planner does not re-file rows the server already grouped (C5)", () => {
  // Its alias map includes every theme's keywords, and later themes overwrite
  // earlier ones - a "Dynamic Assessment" row could be re-filed under any theme
  // listing "dynamic assessment" as a keyword.
  const planner = read("src/lib/visualization-planner.ts");
  const canonicalize = planner.slice(planner.indexOf("function canonicalizeTrendTopics"), planner.indexOf("export async function buildNormalizedAnalyticsPayload"));
  assert.match(canonicalize, /if \(data\.trends\.some\(\(row\) => row\.raw_topic !== undefined\)\) \{\s*return data\.trends;/);
});

test("a study uploaded twice is reported, not silently counted twice", () => {
  const titled = (paper: string, title: string) => row(paper, "2020", "T", "k", { title });
  const found = likelyDuplicatePapers([
    titled("1", "Portfolio Assessment Among Thai EFL First-Year University Students"),
    titled("2", "Portfolio Assessment Among Thai EFL First-Year University Students: Perceptions and Progress"),
    titled("3", "Effects of a Combination of Genre Analysis and Genre-Based Writing Teaching"),
    titled("4", "The Effects of a Combination of Genre Analysis and Genre-Based Writing Teaching"),
    titled("5", "Effects of Dynamic Assessment on Improvement of Academic Vocabulary Knowledge"),
    titled("6", "Computerized Dynamic Reading Assessment Program to Measure English Reading Comprehension"),
  ]);
  assert.deepEqual(found.map((d) => [d.paperId, d.originalId]), [["2", "1"], ["4", "3"]]);
});

test("legend text is drawn in the readable label colour, not the series colour (U5)", () => {
  // Measured on the pilot: palette colours on white put legend labels at
  // 2.0-3.9:1, under the 4.5:1 that 11px text needs.
  for (const file of [
    "src/components/tabs/TrendAnalysis.tsx",
    "src/components/tabs/KeywordExplorer.tsx",
    "src/components/tabs/TrackAnalysis.tsx",
    "src/components/dashboard/AdaptiveDashboardTab.tsx",
  ]) {
    const source = read(file);
    const legends = source.match(/<Legend[\s\S]*?\/>/g) ?? [];
    assert.ok(legends.length > 0, `${file} has no legend to check`);
    for (const legend of legends) assert.match(legend, /formatter=\{legendLabel\(ct/, `${file}: ${legend.slice(0, 60)}`);
  }
});

test("chart controls are at least 24px tall, and the treemap root draws nothing (U5)", () => {
  for (const file of ["src/components/tabs/TrendAnalysis.tsx", "src/components/tabs/KeywordExplorer.tsx"]) {
    const source = read(file);
    for (const input of source.match(/<input\s+type="range"[\s\S]*?\/>/g) ?? []) assert.match(input, /className="h-6 /, `${file} slider`);
  }
  assert.match(read("src/components/tabs/KeywordExplorer.tsx"), /if \(depth === 0\) return null;/);
});
