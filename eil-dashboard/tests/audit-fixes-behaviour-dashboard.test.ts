/*
 * The site audit's dashboard fixes (docs/32, 2.11, DASH-6 and DASH-7), drawn
 * rather than read: the dashboard and its tabs are rendered as the server
 * sends them, with recharts given a fixed size and sign-in, the workspace,
 * the theme, the dashboard data and Next's router swapped for what each test
 * sets (tests/support/stub-auditfix-*.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardData, IngestionRunRow, TrackRow, TrendRow } from "../src/types/database";
import { stubModule } from "./support/route-harness";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/recharts/lib/index.js", support("stub-auditfix-recharts.ts"));
stubModule("/node_modules/recharts/es6/index.js", support("stub-auditfix-recharts.ts"));
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/hooks/useData.ts", support("stub-auditfix-dashboard-data.ts"));
(globalThis as { React?: typeof React }).React = React;

const TRACKS = ["EL", "ELI", "LAE", "Other"];
const PROJECT = "00000000-0000-4000-8000-0000000000a1";

function row(paper: string, year: string, topic: string, keyword = "shared keyword"): TrendRow {
  return { paper_id: paper, year, title: `Paper ${paper}`, topic, keyword, keyword_frequency: 1, evidence: "" } as TrendRow;
}

function papers(from: number, count: number, year: string, topic: string): TrendRow[] {
  return Array.from({ length: count }, (_, index) => row(String(from + index), year, topic));
}

/** Ten earlier papers, fifteen later, five of them in a theme that is gaining ground. */
const SHIFTING = [...papers(1, 10, "2018", "Filler"), ...papers(20, 10, "2024", "Filler"), ...papers(20, 5, "2024", "Rising")];

function tracksOf(rows: TrendRow[]): TrackRow[] {
  const ids = [...new Set(rows.map((entry) => entry.paper_id))];
  return ids.map((id) => {
    const source = rows.find((entry) => entry.paper_id === id)!;
    return { paper_id: id, year: source.year, title: source.title, el: 1, eli: 0, lae: 0, other: 0 } as TrackRow;
  });
}

async function tabs() {
  return {
    TrendAnalysis: (await import("../src/components/tabs/TrendAnalysis")).default,
    KeywordExplorer: (await import("../src/components/tabs/KeywordExplorer")).default,
    TrackAnalysis: (await import("../src/components/tabs/TrackAnalysis")).default,
  };
}

function draw<P extends object>(component: ComponentType<P>, props: P, theme: "light" | "dark" = "light") {
  globalThis.__auditfixTheme = theme;
  return renderToStaticMarkup(createElement(component, props));
}

/** The background of each chart tooltip in the page, in order. */
function tooltipBackgrounds(html: string) {
  return [...html.matchAll(/class="recharts-default-tooltip" style="([^"]*)"/g)].map((match) => /background-color:([^;]+)/.exec(match[1])?.[1]);
}

// DASH-6: tooltips readable in dark mode; stacked trends capped.
test("the trend, keyword and category charts' tooltips follow the theme", async () => {
  const { TrendAnalysis, KeywordExplorer, TrackAnalysis } = await tabs();
  const pages = [
    ["TrendAnalysis", (theme: "light" | "dark") => draw(TrendAnalysis, { trends: SHIFTING }, theme)],
    ["KeywordExplorer", (theme: "light" | "dark") => draw(KeywordExplorer, { trends: SHIFTING }, theme)],
    ["TrackAnalysis", (theme: "light" | "dark") => draw(TrackAnalysis, { trends: SHIFTING, tracksSingle: tracksOf(SHIFTING), tracksMulti: tracksOf(SHIFTING), selectedTracks: TRACKS }, theme)],
  ] as const;
  for (const [tab, page] of pages) {
    assert.ok(tooltipBackgrounds(page("dark")).includes("#1f1f1f"), `${tab}: a dark tooltip on a dark page`);
    assert.ok(tooltipBackgrounds(page("light")).includes("#ffffff"), `${tab}: a light tooltip on a light page`);
  }
  const categories = tooltipBackgrounds(pages[2][1]("dark"));
  assert.ok(categories.length >= 1);
  assert.deepEqual(categories, categories.map(() => "#1f1f1f"), "every category chart");
});

test(
  "every chart tooltip on the trend and keyword tabs follows the theme",
  async () => {
    const { TrendAnalysis, KeywordExplorer } = await tabs();
    for (const [tab, html] of [
      ["TrendAnalysis", draw(TrendAnalysis, { trends: SHIFTING }, "dark")],
      ["KeywordExplorer", draw(KeywordExplorer, { trends: SHIFTING }, "dark")],
    ] as const) {
      const backgrounds = tooltipBackgrounds(html);
      assert.ok(backgrounds.length >= 2, tab);
      assert.deepEqual(backgrounds, backgrounds.map(() => "#1f1f1f"), tab);
    }
  }
);

test("the themes-by-year chart stacks at most eight themes, even when its plan asks for more", async () => {
  const { TrendAnalysis } = await tabs();
  const twelve = Array.from({ length: 12 }, (_, index) => [row(`${index}a`, "2020", `Theme ${index}`), row(`${index}b`, "2022", `Theme ${index}`)]).flat();
  const legendItems = (html: string) => (html.match(/class="recharts-legend-item /g) ?? []).length;

  const planned = draw(TrendAnalysis, { trends: twelve, planCharts: [{ chart_key: "topic_area", title: "Themes by year", reason: "test", config: { top_n: 12 } }] });
  assert.equal(legendItems(planned), 8);
  const chosen = draw(TrendAnalysis, { trends: twelve });
  assert.equal(legendItems(chosen), 8);
  assert.match(chosen, /<input type="range" min="3" max="8"/, "the reader's control stops at eight");
});

// DASH-7: the tabs' empty messages only ever mean the filters.
test("a tab with nothing to show says the filters match no papers", async () => {
  const { TrendAnalysis, KeywordExplorer, TrackAnalysis } = await tabs();
  const empty = { trends: [], tracksSingle: [], tracksMulti: [], selectedTracks: TRACKS };
  for (const [tab, html] of [
    ["TrendAnalysis", draw(TrendAnalysis, empty)],
    ["KeywordExplorer", draw(KeywordExplorer, empty)],
  ] as const) {
    assert.match(html, /No papers match the current filters\./, tab);
    assert.doesNotMatch(html, /No data for the selected filters/, tab);
  }
  assert.doesNotMatch(draw(TrackAnalysis, empty), />No data</);
});

/** The dashboard of a repository whose data has loaded as `data`, inside the shell following `runs`. */
async function dashboard(data: Partial<DashboardData> | null, options: { loading?: boolean; runs?: IngestionRunRow[]; search?: string } = {}) {
  globalThis.__auditfixTheme = "light";
  globalThis.__auditfixAuth = { user: { id: "00000000-0000-4000-8000-00000000000a" }, session: { access_token: "token" } };
  globalThis.__auditfixWorkspace = {
    currentProject: { id: PROJECT, name: "Assessment studies" },
    hasActiveProject: true,
    selectedProjectId: PROJECT,
    filtersLoadedFor: PROJECT,
    profile: {},
    selectedYears: [],
    selectedTracks: [],
    searchQuery: "",
    setSelectedYears: () => undefined,
    setSelectedTracks: () => undefined,
    setSearchQuery: () => undefined,
  };
  globalThis.__auditfixDashboardData = {
    loading: options.loading ?? false,
    data: data && { trends: [], tracksSingle: [], tracksMulti: [], categoryAssignments: [], useMock: false, diagnostics: {}, ...data },
  };
  // These cases are about the chart tabs; the dashboard opens on the semantic
  // map, which has its own empty state, so Area Analysis is opened here.
  globalThis.__auditfixSearch = options.search ?? "tab=area_analysis";
  try {
    const { default: DashboardClient } = await import("../src/components/DashboardClient");
    const { AnalysisRunsContext } = await import("../src/components/workspace/AnalysisRunsContext");
    return renderToStaticMarkup(
      createElement(AnalysisRunsContext.Provider, { value: { runs: options.runs ?? [], folderJob: null } as never }, createElement(DashboardClient))
    );
  } finally {
    globalThis.__auditfixSearch = undefined;
  }
}

const ONE_PAPER = { trends: [row("1", "2021", "Peer feedback")], tracksSingle: tracksOf([row("1", "2021", "Peer feedback")]) };

function following(status: IngestionRunRow["status"], projectId: string): IngestionRunRow {
  return { id: `${status}-${projectId}`, source_type: "upload", status, input_payload: { project_id: projectId } };
}

// DASH-7: an empty repository says so; the tabs' empty messages only ever mean the filters.
test("a repository with no analysed paper says so, instead of every tab blaming the filters", async () => {
  const empty = await dashboard({});
  assert.match(empty, /<h2[^>]*>No analysed papers yet<\/h2>/);
  assert.match(empty, /Add papers from the Library to begin\./);
  assert.doesNotMatch(empty, /No papers match the current filters/, "the tabs are not drawn");

  assert.doesNotMatch(await dashboard(null, { loading: true }), /No analysed papers yet/, "not before it loads");
  assert.doesNotMatch(await dashboard({}, { loading: true }), /No analysed papers yet/, "nor while it loads again");
  const failed = await dashboard({ diagnostics: { errorMessage: "the database did not answer" } });
  assert.match(failed, /Dashboard data could not be loaded for this repository\. the database did not answer/);
  assert.doesNotMatch(failed, /No analysed papers yet/, "a failed load is not an empty repository");
  assert.doesNotMatch(await dashboard({}, { search: "tab=semantic_map" }), /No analysed papers yet/, "the map has its own empty state");
  const withPaper = await dashboard(ONE_PAPER);
  assert.doesNotMatch(withPaper, /No analysed papers yet/);
  assert.match(withPaper, /<h2[^>]*>\s*Trend analysis\s*<\/h2>/);
});

test("the dashboard counts the papers the shell is following for this repository only", async () => {
  const runs = [following("queued", PROJECT), following("processing", PROJECT), following("processing", "another-repository"), following("succeeded", PROJECT)];
  assert.match(await dashboard({}, { runs }), /2 papers are being analysed\. Each appears here as soon as it finishes\./);
  assert.match(await dashboard(ONE_PAPER, { runs }), /role="status"[^>]*>2 papers are being analysed\. The charts update as each one finishes\./);
  assert.doesNotMatch(await dashboard(ONE_PAPER, { runs: [following("succeeded", PROJECT)] }), /being analysed/);
});
