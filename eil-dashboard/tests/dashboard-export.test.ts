import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { csvCell, csvFileName, seriesTable, toCsv } from "../src/lib/chart-csv";
import { readChatScopeTransfer, runsInTransfer, writeChatScopeTransfer } from "../src/lib/chat-scope-transfer";
import { hasViewInAddress, readDashboardAddress, withDashboardAddress } from "../src/lib/dashboard-address";
import { dashboardPayloadForBrowser } from "../src/lib/dashboard-payload";
import { insightCsv } from "../src/lib/insights/csv";
import type { Insight } from "../src/lib/insights/types";
import { paperIdFromRunId } from "../src/lib/paper-id";
import { semanticMapCsv } from "../src/lib/semantic-map-export";
import { CHAT_SCOPE_TRANSFER_STORAGE_KEY } from "../src/lib/workspace-session";
import type { DashboardData } from "../src/types/database";

/**
 * The dashboard can be linked and exported (docs/32, 4.3). The CSV beside each
 * chart, and the Copy link button, are drawn in
 * boot-security-behaviour-render.test.ts; what the dashboard route sends the
 * browser runs through the route in boot-security-behaviour-routes.test.ts.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const REPO = "948dd4cc-f4b5-4337-81dc-31851ae05507";

/* ------------------------------------------------------------- the address */

test("a view's address names only what differs from the default, and keeps the tab and an open paper", () => {
  const current = new URLSearchParams("tab=trend_analysis&paper=run-1&paperTab=preview");
  const params = withDashboardAddress(current, {
    projectId: REPO,
    years: ["2020", "2019"],
    allYears: ["2018", "2019", "2020"],
    categories: ["lae", "el"],
    allCategories: ["el", "eli", "lae", "other"],
    query: "  peer feedback ",
  });
  assert.equal(params.get("tab"), "trend_analysis");
  assert.equal(params.get("paper"), "run-1");
  assert.equal(params.get("repo"), REPO);
  assert.equal(params.get("years"), "2019,2020");
  assert.equal(params.get("categories"), "el,lae");
  assert.equal(params.get("q"), "peer feedback");

  const everything = withDashboardAddress(params, {
    projectId: REPO,
    years: ["2018", "2019", "2020"],
    allYears: ["2018", "2019", "2020"],
    categories: ["el", "eli", "lae", "other"],
    allCategories: ["other", "lae", "eli", "el"],
    query: "",
  });
  assert.equal(everything.get("years"), null, "every year is the default");
  assert.equal(everything.get("categories"), null, "every category is the default");
  assert.equal(everything.get("q"), null);
  // With classification off there are no categories to name.
  assert.equal(
    withDashboardAddress(new URLSearchParams(), { projectId: REPO, years: [], allYears: [], categories: ["el"], allCategories: [], query: "" }).get("categories"),
    null
  );
});

test("an address is read back to the same view, and anything malformed is left out", () => {
  const address = readDashboardAddress(new URLSearchParams(`repo=${REPO.toUpperCase()}&years=2019,Unknown,19x9,2019&categories=el,lae&q=feedback`));
  assert.deepEqual(address, { projectId: REPO, years: ["2019", "Unknown"], categories: ["el", "lae"], query: "feedback" });
  assert.equal(hasViewInAddress(address), true);
  const bad = readDashboardAddress(new URLSearchParams("repo=not-a-uuid&years=,,&categories=%3Cscript%3E"));
  assert.deepEqual(bad, { projectId: null, years: null, categories: null, query: null });
  assert.equal(hasViewInAddress(bad), false);
  assert.equal(readDashboardAddress(new URLSearchParams(`q=${"x".repeat(500)}`)).query?.length, 200);
});

test("a link's view is applied once its repository's saved filters have loaded, then written back", () => {
  // Kept as text: the view is applied and written back in effects, and typing
  // waits on a timer; a static render runs neither.
  const client = read("src/components/DashboardClient.tsx");
  assert.match(client, /if \(filtersLoadedFor !== selectedProjectId\) return;\s*if \(hasViewInAddress\(linkedView\)\)/);
  assert.match(client, /setSelectedProjectId\(linkedView\.projectId\)/);
  assert.match(client, /window\.history\.replaceState\(window\.history\.state, "",/);
  // Typing filters on a pause, not on every key (DASH-5).
  assert.match(client, /value=\{searchDraft\}\s*onChange=\{\(event\) => setSearchDraft\(event\.target\.value\)\}/);
  assert.match(client, /window\.setTimeout\(\(\) => setSearchQuery\(searchDraft\), 250\)/);
  assert.match(read("src/components/workspace/WorkspaceProvider.tsx"), /filtersLoadedFor: filtersProjectId,/);
});

/* ------------------------------------------------------------------- CSV */

test("CSV cells are quoted, formulas are neutralised, and the file opens as UTF-8", () => {
  assert.equal(csvCell('He said "hi", then left'), '"He said ""hi"", then left"');
  assert.equal(csvCell("line one\nline two"), '"line one\nline two"');
  assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell("+1 trick"), "'+1 trick");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell(-3), "-3", "a negative number is a number");
  assert.equal(csvCell(Number.NaN), "");
  assert.equal(csvCell(null), "");
  const csv = toCsv(["Theme", "Papers"], [["การอ่าน", 7], ["Peer feedback", 3]]);
  assert.ok(csv.startsWith("﻿Theme,Papers\r\n"), "byte-order mark, then the header");
  assert.ok(csv.endsWith("Peer feedback,3\r\n"));
  assert.equal(csvFileName("Papers per category per year"), "papers-per-category-per-year.csv");
  assert.equal(csvFileName("หัวข้อ: การอ่าน"), "หัวข้อ-การอ่าน.csv");
});

test("a stacked chart becomes one row per year and one column per series", () => {
  const table = seriesTable(
    [
      { year: "2019", reading: 2, writing: 1, __ids: ["a"] },
      { year: "2020", writing: 4 },
    ],
    "year",
    [
      { key: "reading", label: "Reading" },
      { key: "writing", label: "Writing" },
    ]
  );
  assert.deepEqual(table, { header: ["Year", "Reading", "Writing"], rows: [["2019", 2, 1], ["2020", 0, 4]] });
});

test("the Adaptive tab and the semantic map offer their data as CSV", () => {
  // The four chart tabs are drawn in boot-security-behaviour-render.test.ts.
  // Kept as text: these two draw only after fetching their data in an effect,
  // which a static render never runs.
  assert.match(read("src/components/dashboard/InsightsTab.tsx"), /<ChartCsvButton csv=\{insightCsv\(insight, title\)\} \/>/);
  assert.match(read("src/components/workspace/RepositorySemanticMap.tsx"), /<ChartCsvButton csv=\{mapCsv\.papers\}/);
});

test("each kind of Adaptive chart has a table", () => {
  const base = { id: "x", family: "change", question: "Q", view: { measure: "papers", rows: "theme" }, facts: [], takeaway: "", score: 1, paperIds: [], basis: "" } as const;
  const make = (chart: Insight["chart"]) => ({ ...base, chart }) as unknown as Insight;
  assert.deepEqual(insightCsv(make({ kind: "bars", valueLabel: "Papers", unit: "papers", rows: [{ label: "A", value: 3, paperIds: [] }] }), "t").rows, [["A", 3, ""]]);
  assert.deepEqual(
    insightCsv(make({ kind: "matrix", rowLabel: "Theme", colLabel: "Year", rows: ["A"], cols: ["2019", "2020"], values: [[1, 2]], marks: [], paperIds: [] }), "t"),
    { name: "t", header: ["Theme / Year", "2019", "2020"], rows: [["A", 1, 2]] }
  );
  assert.deepEqual(
    insightCsv(make({ kind: "lifecycles", years: ["2019", "2020"], rows: [{ label: "A", status: "new", first: "2020", last: "2020", papers: 2, series: [0, 2], paperIds: [] }] }), "t").rows,
    [["A", "new", "2020", "2020", 2, 0, 2]]
  );
  assert.equal(insightCsv(make({ kind: "pairs", rows: [] }), "t").header.length, 6);
  assert.equal(insightCsv(make({ kind: "compare", leftLabel: "Early", rightLabel: "Late", unit: "percent", sequence: "time", rows: [] }), "t").header[2], "Early (%)");
  assert.deepEqual(insightCsv(make({ kind: "list", rows: [{ title: "T", detail: "d", paperIds: ["1", "2"] }] }), "t").rows, [["T", "d", 2]]);
});

test("the semantic map exports its papers and its connections by title", () => {
  const csv = semanticMapCsv({
    points: [
      { paperId: "1", runId: null, folderId: null, x: 0.12345, y: -1, clusterId: 7, title: "One", year: "2019", folderName: null, categories: [], topics: ["a", "b"], keywords: ["k"], track: null },
      { paperId: "2", runId: null, folderId: null, x: 1, y: 2, clusterId: null, title: "Two", year: "2020", folderName: null, categories: [], topics: [], keywords: [], track: null },
    ],
    edges: [{ sourcePaperId: "1", targetPaperId: "2", distance: 0.42, similarity: 0.6, rank: 1, sharedSignals: { categories: [], topics: ["a"], keywords: [], methods: ["survey"] } }],
    clusters: [{ id: 7, label: "Reading", paperCount: 1, terms: [], source: "deterministic" }],
  });
  assert.deepEqual(csv.papers.rows[0], ["One", "2019", "Reading", 0.123, -1, "a; b", "k"]);
  assert.deepEqual(csv.connections.rows[0], ["One", "Two", 0.42, 1, "a", "", "survey"]);
});

/* ------------------------------------------------------ the drilldown's papers */

test("a drilldown's papers reach chat by paper id, matched against the repository's own runs", () => {
  const stored = new Map<string, string>();
  const storage = { setItem: (key: string, value: string) => void stored.set(key, value) };
  const runA = "11111111-2222-4333-8444-555555555555";
  const runB = "66666666-7777-4888-8999-aaaaaaaaaaaa";
  writeChatScopeTransfer(storage, { projectId: REPO, paperIds: [paperIdFromRunId(runA), ""], prompt: " Summarise " }, new Date("2026-10-02T09:00:00Z"));
  const transfer = readChatScopeTransfer(stored.get(CHAT_SCOPE_TRANSFER_STORAGE_KEY) ?? null, Date.parse("2026-10-02T09:05:00Z"));
  assert.ok(transfer);
  assert.deepEqual(transfer.paperIds, [paperIdFromRunId(runA)]);
  assert.equal(transfer.prompt, "Summarise");
  const runs = [{ id: runA }, { id: runB }];
  assert.deepEqual(runsInTransfer(runs, transfer).map((run) => run.id), [runA]);
  // By run id too, as the semantic map sends it.
  assert.deepEqual(runsInTransfer(runs, { runIds: [runB], paperIds: [] }).map((run) => run.id), [runB]);
  // A note older than 15 minutes, malformed, or naming nothing is ignored.
  assert.equal(readChatScopeTransfer(stored.get(CHAT_SCOPE_TRANSFER_STORAGE_KEY) ?? null, Date.parse("2026-10-02T09:16:00Z")), null);
  assert.equal(readChatScopeTransfer("{not json", Date.now()), null);
  assert.equal(readChatScopeTransfer(JSON.stringify({ projectId: REPO, runIds: [], paperIds: [], createdAt: new Date().toISOString() })), null);

  // Kept as text: a drilldown opens on a click, and chat reads the note in an
  // effect; a static render does neither.
  const client = read("src/components/DashboardClient.tsx");
  assert.match(client, /paperIds: drilldownPapers\.map\(\(paper\) => String\(paper\.paperId\)\)/);
  assert.match(client, /Copy list/);
  assert.match(client, /Ask in chat/);
  const chat = read("src/components/chat/ChatClient.tsx");
  assert.match(chat, /setSelectedLibraryRuns\(runsInTransfer\(rows, transfer\)\.filter\(\(run\) => hasUsableAnalysis\(run\)\)\)/);
  // Found on the pilot: with papers chosen, the line above the composer named the whole account.
  assert.match(chat, /activeKnowledgeScope\.kind === "selected_papers"\s*\? scopeDescription\(activeScopeSnapshot\.label, null\)/);
});

test("the browser gets no topic-family evidence snippets, which only the server reads", () => {
  const family = {
    id: "f",
    canonicalTopic: "Reading",
    aliases: [],
    representativeKeywords: [],
    relatedKeywords: [],
    matchedTerms: [],
    evidenceSnippets: ["a long passage"],
    paperIds: ["1"],
    folderIds: [],
    years: ["2019"],
    totalKeywordFrequency: 4,
  };
  const data = { trends: [], tracksSingle: [], tracksMulti: [], topicFamilies: [family], useMock: false } as unknown as DashboardData;
  const sent = dashboardPayloadForBrowser(data);
  assert.deepEqual(sent.topicFamilies?.[0].evidenceSnippets, []);
  assert.equal(sent.topicFamilies?.[0].totalKeywordFrequency, 4, "what Home reads stays");
  assert.deepEqual(family.evidenceSnippets, ["a long passage"], "the server's copy is untouched");
});
