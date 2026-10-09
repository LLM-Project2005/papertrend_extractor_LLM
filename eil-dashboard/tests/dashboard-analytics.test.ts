/*
 * The dashboard's numbers and what its tabs draw (docs/32, long-term health).
 * The server reads run against PGlite under the app's role
 * (tests/support/route-harness.ts); the tabs are rendered as the server sends
 * them, with recharts given a fixed size and the phone-width hook and sign-in
 * swapped (tests/support/stub-profiledash-*.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React, { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
import { buildCategoryOptions } from "../src/lib/category-options";
import { chartTheme } from "../src/lib/chart-theme";
import { contrastRatio } from "../src/lib/contrast";
import { buildInsightCorpus } from "../src/lib/insights/corpus";
import { methodsByTheme } from "../src/lib/insights/analyses";
import { paperIdFromRunId } from "../src/lib/paper-id";
import { createEilAnalysisProfile, createGeneralAnalysisProfile } from "../src/lib/project-analysis-profile";
import type { CategoryAssignmentRow, DashboardData, TrendRow } from "../src/types/database";
import type { ProjectAnalysisProfile } from "../src/types/workspace";
import { routeHarness, stubModule } from "./support/route-harness";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/recharts/lib/index.js", support("stub-profiledash-recharts.ts"));
stubModule("/node_modules/recharts/es6/index.js", support("stub-profiledash-recharts.ts"));
stubModule("/src/lib/use-narrow.ts", support("stub-profiledash-narrow.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-profiledash-auth.ts"));
stubModule("/src/lib/supabase-admin.ts", support("stub-profiledash-supabase.ts"));
(globalThis as { React?: typeof React }).React = React;

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

/* ------------------------------------------------------- stored repositories */

const OWNER = "00000000-0000-4000-8000-00000000000a";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const runOf = (n: number) => `${n.toString(16).padStart(8, "0")}-e5f6-4a7b-8c9d-0e1f2a3b4c5d`;

async function repository(profile: ProjectAnalysisProfile) {
  const harness = await routeHarness();
  await harness.signIn(OWNER);
  await harness.db.query(`INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', $1, 'Org')`, [OWNER]);
  await harness.db.query(
    `INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
     VALUES ($1, '00000000-0000-4000-8000-0000000000c1', $2, 'Mine', $3::jsonb, $4, $5, now())`,
    [PROJECT, OWNER, JSON.stringify(profile), profile.version, profile.profileHash]
  );
  await harness.db.query(`INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ($1, $2, 'A', $3)`, [FOLDER, OWNER, PROJECT]);
  /** A paper as analysis stores it, with its topics as [topic, keyword] pairs. */
  const paper = async (n: number, topics: Array<[string, string]>, { trashed = false, category }: { trashed?: boolean; category?: [string, string] } = {}) => {
    const run = runOf(n);
    const id = paperIdFromRunId(run);
    const { db } = harness;
    await db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, trashed_at) VALUES ($1, $2, $3, 'upload', 'succeeded', CASE WHEN $4 THEN now() END)`,
      [run, OWNER, FOLDER, trashed]
    );
    await db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2021', $4)`, [id, OWNER, FOLDER, `Paper ${n}`]);
    await db.query(`INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id) VALUES ($1, $2, $3, $4)`, [id, OWNER, FOLDER, run]);
    for (const [topic, keyword] of topics) {
      await db.query(`INSERT INTO paper_keywords (paper_id, owner_user_id, folder_id, topic, keyword) VALUES ($1, $2, $3, $4, $5)`, [id, OWNER, FOLDER, topic, keyword]);
    }
    if (category) {
      await db.query(
        `INSERT INTO paper_category_assignments (paper_id, owner_user_id, folder_id, project_id, category_key, category_label, assignment_type, profile_hash)
         VALUES ($1, $2, $3, $4, $5, $6, 'single', $7)`,
        [id, OWNER, FOLDER, PROJECT, category[0], category[1], profile.profileHash]
      );
    }
    return id;
  };
  return { ...harness, paper };
}

async function dashboard() {
  const { loadDashboardDataServer } = await import("../src/lib/dashboard-data-server");
  return loadDashboardDataServer(OWNER, [], PROJECT, "live", { fresh: true });
}

const paperIds = (data: DashboardData) => [...new Set(data.trends.map((entry) => entry.paper_id))].sort();

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

test("the server does not serve category rows for a repository that does not classify", async () => {
  const general = createGeneralAnalysisProfile();
  const { paper } = await repository(general);
  await paper(1, [["Reading", "reading"]], { category: ["other", "Other / Unclassified"] });
  await paper(2, [["Writing", "writing"]], { category: ["other", "Other / Unclassified"] });
  const off = await dashboard();
  assert.equal(off.classificationEnabled, false);
  assert.equal(off.trends.length, 2);
  assert.deepEqual(off.categoryAssignments, [], "the default rows are not served");

  const eil = createEilAnalysisProfile();
  const classified = await repository(eil);
  await classified.paper(1, [["Reading", "reading"]], { category: ["eli", "English Language Instruction"] });
  const on = await dashboard();
  assert.equal(on.classificationEnabled, true);
  assert.deepEqual(on.categoryAssignments?.map((entry) => entry.category_key), ["eli"], "a classifying repository's are");

  // Nor do the Adaptive insights read categories then.
  const corpus = (classificationEnabled: boolean) => buildInsightCorpus({ ...on, classificationEnabled });
  assert.deepEqual(corpus(true).papers.map((entry) => entry.category ?? null), ["English Language Instruction"]);
  assert.deepEqual(corpus(false).papers.map((entry) => entry.category ?? null), [null]);
});

test("a paper moved to Trash leaves the dashboard and Home's counts", async () => {
  // Chat, the semantic map, reclassification and re-analysis skipped trashed
  // papers, but the dashboard selected every run in the repository's folder,
  // so a paper put in Trash went on being counted in every chart.
  const { paper } = await repository(createEilAnalysisProfile());
  const kept = [await paper(1, [["Reading", "reading"]]), await paper(2, [["Reading", "reading"]])];
  const trashed = await paper(3, [["Reading", "reading"]], { trashed: true });
  assert.deepEqual(paperIds(await dashboard()), [...kept].sort(), "Cloud SQL");

  // The Supabase deployment's reads, against an in-memory PostgREST.
  const runs = [1, 2, 3].map(runOf);
  const ids = [...kept, trashed];
  globalThis.__profiledashSupabase = {
    ingestion_runs: runs.map((id, index) => ({ id, owner_user_id: OWNER, folder_id: FOLDER, trashed_at: index === 2 ? "2026-10-01T00:00:00Z" : null })),
    papers_full: runs.map((run, index) => ({ paper_id: ids[index], owner_user_id: OWNER, folder_id: FOLDER, year: "2021", title: `Paper ${index + 1}`, ingestion_run_id: run })),
    trends_flat: ids.map((id, index) => ({ paper_id: id, owner_user_id: OWNER, folder_id: FOLDER, year: "2021", title: `Paper ${index + 1}`, topic: "Reading", keyword: "reading", keyword_frequency: 1 })),
    tracks_single_flat: [],
    tracks_multi_flat: [],
    paper_keywords: [],
    paper_tracks_single: [],
    paper_tracks_multi: [],
  };
  process.env.DATABASE_PROVIDER = "supabase";
  try {
    const { loadDashboardDataServer } = await import("../src/lib/dashboard-data-server");
    const legacy = await loadDashboardDataServer(OWNER, [FOLDER], null, "live", { fresh: true });
    assert.deepEqual(paperIds(legacy), [...kept].sort(), "Supabase");
  } finally {
    process.env.DATABASE_PROVIDER = "cloud-sql";
    globalThis.__profiledashSupabase = undefined;
  }
});

/* ---------------------------------------------------------- the interface */

const LONG = "Teacher Cognition and Beliefs"; // 29 characters

/**
 * Fourteen papers: two a year from 2016 to 2021 and two undated. Reading leads
 * early, Teacher Cognition late; Writing runs through; mixed methods is a
 * method; Archival Policy appears only in the undated papers.
 */
function tabData() {
  const trends: TrendRow[] = [];
  const categoryAssignments: CategoryAssignmentRow[] = [];
  for (let paper = 1; paper <= 12; paper += 1) {
    const year = String(2015 + Math.ceil(paper / 2));
    const id = String(paper);
    trends.push(row(id, year, paper <= 6 ? "Reading" : LONG, paper <= 6 ? "reading" : "teacher cognition beliefs"));
    if (paper % 3 === 0) trends.push(row(id, year, "Writing", "writing"));
    if (paper > 6) trends.push(row(id, year, "Mixed methods", "mixed methods", { topic_kind: "method" }));
    const assessment = paper % 4 === 0;
    categoryAssignments.push({
      paper_id: id,
      year,
      title: `Paper ${id}`,
      category_key: assessment ? "lae" : "eli",
      category_label: assessment ? "Assessment" : "Instruction",
      assignment_type: "single",
    });
  }
  trends.push(row("13", "Unknown", "Archival Policy", "policy"), row("14", "Unknown", "Archival Policy", "policy"));
  return { trends, categoryAssignments, categoryOptions: buildCategoryOptions({ categoryAssignments }) };
}

async function tabs() {
  const { ThemeProvider } = await import("../src/components/theme/ThemeProvider");
  const { default: TrendAnalysis } = await import("../src/components/tabs/TrendAnalysis");
  const { default: TrackAnalysis } = await import("../src/components/tabs/TrackAnalysis");
  const { default: KeywordExplorer } = await import("../src/components/tabs/KeywordExplorer");
  const data = tabData();
  const draw = (element: ReactElement) => renderToStaticMarkup(createElement(ThemeProvider, null, element));
  const common = { trends: data.trends, tracksSingle: [], tracksMulti: [], selectedTracks: [] };
  return {
    data,
    trend: () => draw(createElement(TrendAnalysis, { trends: data.trends })),
    track: (classificationEnabled = true) =>
      draw(createElement(TrackAnalysis, { ...common, categoryAssignments: data.categoryAssignments, categoryOptions: data.categoryOptions, classificationEnabled })),
    keywords: () => draw(createElement(KeywordExplorer, { trends: data.trends })),
  };
}

const text = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const takeaway = (html: string) => text(html.match(/<p[^>]*data-takeaway="true"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");

test("the Adaptive tab carries its own header, and no data pill remains (U2)", () => {
  // DashboardClient needs the router, sign-in, workspace, paper viewer and data
  // providers and loads its tabs lazily; too large to render here, so its
  // wording is checked.
  const client = read("src/components/DashboardClient.tsx");
  // Kept mounted once opened (docs/32, 3.3).
  assert.match(client, /<TabPanel active=\{currentTabKey === "adaptive"\} visited=\{visitedTabs\.has\("adaptive"\)\}>\s*<InsightsTab/);
  assert.doesNotMatch(client, /Visualization planner/, "no planner panel above the tabs");
  assert.equal(/"Live data"|Preview data/.test(client.replace(/\/\*[\s\S]*?\*\//g, "")), false);
});

test("the category chip tells the truth about classification (U3)", async () => {
  const { track } = await tabs();
  const off = track(false);
  assert.match(off, /Research areas are off for this repository/);
  assert.equal(takeaway(off), "Nothing to show: this repository does not sort papers into research areas.");
  assert.doesNotMatch(off, /recharts-surface/, "and no category chart is drawn");
  const on = track(true);
  assert.doesNotMatch(on, /Research areas are off/);
  assert.match(on, /recharts-surface/);
  // The chip sits in DashboardClient's header (see U2 for why it is read).
  assert.match(read("src/components/DashboardClient.tsx"), /: "Research areas off"\}/);
});

test("each fixed tab opens with a takeaway computed from its own numbers (U4)", async () => {
  // Drawn in the server render, before any effect could fetch anything: the
  // sentence is worked out from the tab's own rows.
  const { trend, track, keywords } = await tabs();
  assert.match(takeaway(trend()), /^Comparing 2016–2018 \(6 papers\) with 2019–2021 \(6\): /);
  assert.equal(takeaway(track()), "Instruction holds the most papers: 9 papers, 75% of the 12 with a dated research area. Next is Assessment with 3.");
  assert.match(takeaway(keywords()), /^The keywords used by the most papers are reading \(6\), teacher cognition beliefs \(6\) and writing \(4\)\./);
});

test("no heatmap draws a row of zeros (C4)", async () => {
  const { keywords } = await tabs();
  const html = keywords();
  const heatmap = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";
  const names = [...heatmap.matchAll(/<td title="([^"]+)" class="sticky/g)].map((match) => match[1]);
  assert.deepEqual(names.sort(), ["Reading", LONG, "Writing"], "not Archival Policy, whose papers have no year");
  for (const name of names) {
    const cells = [...heatmap.matchAll(new RegExp(`title="${name} × \\d+: (\\d+)"`, "g"))].map((match) => Number(match[1]));
    assert.ok(cells.some((value) => value > 0), `${name} has a paper in some year`);
  }
  assert.match(text(html), /1 theme among the largest appears only in papers without a readable year, so it is not shown\./);

  // The Adaptive methods grid keeps only themes that meet one of its methods.
  const rows: TrendRow[] = [];
  for (let paper = 1; paper <= 12; paper += 1) {
    const id = String(paper);
    rows.push(row(id, "2020", paper <= 6 ? "Reading" : "Writing"));
    rows.push(row(id, "2020", paper % 2 ? "Survey" : "Interview", "k", { topic_kind: "method" }));
  }
  rows.push(...["13", "14", "15", "16"].map((id) => row(id, "2021", "Policy")));
  const grid = methodsByTheme(buildInsightCorpus({ trends: rows }));
  assert.ok(grid && grid.chart.kind === "matrix");
  if (grid.chart.kind === "matrix") {
    assert.deepEqual([...grid.chart.rows].sort(), ["Reading", "Writing"], "Policy meets no method");
    for (const values of grid.chart.values) assert.ok(values.some((value) => value > 0));
  }
});

test("the Adaptive insights use the themes the server grouped, never re-filing a row (C5)", async () => {
  // The old planner re-filed rows through an alias map, so a "Dynamic
  // Assessment" row could land under any theme listing that keyword.
  const corpus = buildInsightCorpus({ trends: [row("1", "2020", "Reading", "writing"), row("2", "2020", "Writing", "writing")] });
  assert.deepEqual(corpus.papers.map((paper) => [...paper.themes]), [["Reading"], ["Writing"]]);

  // On the server, the topics are grouped by the stored themes once, and the
  // insights read the very rows every tab reads.
  const { db, paper } = await repository(createGeneralAnalysisProfile());
  const first = await paper(1, [["Dynamic Assessment", "dynamic assessment"], ["Mixed-Methods Design", "mixed methods"]]);
  const second = await paper(2, [["Portfolio Assessment", "portfolio"]]);
  const third = await paper(3, [["Reading Comprehension", "dynamic assessment"]]);
  const { THEME_STORE_VERSION } = await import("../src/lib/topic-themes");
  await db.query(
    `INSERT INTO workspace_analytics_cache (owner_user_id, scope_type, scope_key, version_hash, payload) VALUES ($1, 'custom', $2, 'themes', $3::jsonb)`,
    [
      OWNER,
      `topic-themes:v${THEME_STORE_VERSION}:${PROJECT}`,
      JSON.stringify({
        version: THEME_STORE_VERSION,
        themes: [{ name: "Assessment", kind: "topic" }, { name: "Mixed methods", kind: "method" }, { name: "Reading", kind: "topic" }],
        assignments: { "dynamic assessment": 0, "portfolio assessment": 0, "mixed-methods design": 1, "reading comprehension": 2 },
        groupedAt: "2026-10-01T00:00:00Z",
        fullGroupingTopics: 4,
      }),
    ]
  );
  const data = await dashboard();
  const { buildInsightsForRequest } = await import("../src/lib/insights/server");
  const built = await buildInsightsForRequest({ ownerUserId: OWNER, projectId: PROJECT, selectedYears: [], selectedTracks: [], searchQuery: "", fresh: true });
  const filed = (id: string, kind: "topic" | "method") =>
    [...new Set(data.trends.filter((entry) => entry.paper_id === id && (entry.topic_kind === "method") === (kind === "method")).map((entry) => entry.topic))].sort();
  assert.deepEqual(
    built.corpus.papers.map((entry) => [[...entry.themes].sort(), [...entry.methods].sort()]),
    built.corpus.papers.map((entry) => [filed(entry.id, "topic"), filed(entry.id, "method")]),
    "the same themes as the dashboard's rows"
  );
  const themesOf = (id: string) => [...(built.corpus.papers.find((entry) => entry.id === id)?.themes ?? [])];
  assert.deepEqual([themesOf(first), themesOf(second), themesOf(third)], [["Assessment"], ["Assessment"], ["Reading"]], "the stored themes");
  assert.deepEqual([...(built.corpus.papers.find((entry) => entry.id === first)?.methods ?? [])], ["Mixed methods"]);
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

test("legend text is drawn in the readable label colour, not the series colour (U5)", async () => {
  // Measured on the pilot: palette colours on white put legend labels at
  // 2.0-3.9:1, under the 4.5:1 that 11px text needs.
  const label = chartTheme(false).label;
  assert.ok(contrastRatio(label, "#ffffff") >= 4.5, `${label} on white`);
  const { trend, track, keywords } = await tabs();
  for (const [name, html] of [["Trend analysis", trend()], ["Category analysis", track()], ["Keyword explorer", keywords()]]) {
    const items = [...html.matchAll(/<span class="recharts-legend-item-text"[^>]*>([\s\S]*?)<\/span><\/li>/g)].map((match) => match[1]);
    assert.ok(items.length > 0, `${name} has no legend to check`);
    for (const item of items) assert.match(item, new RegExp(`^<span style="color:${label}">[^<]+</span>$`), `${name}: ${item.slice(0, 80)}`);
  }
});

test("chart controls are at least 24px tall, and the treemap root draws nothing (U5)", async () => {
  // The height is Tailwind's h-6 (24px) on the rendered control; measuring it needs a browser.
  const { trend, keywords, data } = await tabs();
  for (const [name, html] of [["Trend analysis", trend()], ["Keyword explorer", keywords()]]) {
    const sliders = html.match(/<input type="range"[^>]*>/g) ?? [];
    assert.ok(sliders.length > 0, `${name} has no slider`);
    for (const slider of sliders) assert.match(slider, /class="h-6 /, `${name}: ${slider}`);
  }
  const html = keywords();
  const treemap = html.slice(html.indexOf("Theme sizes"));
  const cells = [...treemap.matchAll(/<title>([^<]*)<\/title>/g)].map((match) => match[1]).filter(Boolean).sort();
  const themes = themePaperCounts(subjectRows(data.trends)).map((entry) => `${entry.topic}: ${entry.papers} papers`).sort();
  assert.deepEqual(cells, themes, "one cell per theme, and none for their sum");
});

test("horizontal bar charts give their bars room on a phone (U5)", async () => {
  // At 390px a 210-300px name column left the bars about sixty pixels.
  const { labelColumn } = await import("../src/lib/use-narrow");
  assert.deepEqual(labelColumn(true, { width: 300, chars: 46 }), { width: 118, chars: 17 });
  assert.deepEqual(labelColumn(false, { width: 300, chars: 46 }), { width: 300, chars: 46 });
  const { trend, keywords } = await tabs();
  const ticks = (html: string) => [...html.matchAll(/class="recharts-text recharts-cartesian-axis-tick-value"[^>]*><tspan[^>]*>([^<]*)<\/tspan>/g)].map((match) => text(match[1]));
  for (const [name, draw] of [["Trend analysis", trend], ["Keyword explorer", keywords]] as const) {
    const label = name === "Keyword explorer" ? "teacher cognition beliefs" : LONG;
    globalThis.__profiledashNarrow = false;
    assert.ok(ticks(draw()).includes(label), `${name}: the whole name on a desktop`);
    globalThis.__profiledashNarrow = true;
    try {
      const narrow = ticks(draw());
      assert.ok(narrow.includes(`${label.slice(0, 16)}…`), `${name}: shortened on a phone, ${JSON.stringify(narrow)}`);
      assert.ok(narrow.every((tick) => tick.length <= 17), `${name}: ${JSON.stringify(narrow)}`);
    } finally {
      globalThis.__profiledashNarrow = undefined;
    }
  }

  const { default: Heatmap } = await import("../src/components/Heatmap");
  const heatmap = renderToStaticMarkup(createElement(Heatmap, { rows: [LONG], cols: ["2020", "2021"], values: [[1, 0]] }));
  // Sticky and truncated, so the years scroll under the names (the scrolling itself needs a browser).
  assert.match(heatmap, new RegExp(`<td title="${LONG}" class="sticky left-0 z-10 max-w-\\[9rem\\] truncate[^"]*">${LONG}</td>`));
});
