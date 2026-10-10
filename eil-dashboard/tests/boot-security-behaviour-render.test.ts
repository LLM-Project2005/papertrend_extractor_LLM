/*
 * The chat page, the dashboard and its tabs, drawn rather than read (docs/32,
 * long-term health). They replace text assertions in workspace-boot,
 * dashboard-export and chat-chart. Sign-in, the workspace, the theme and
 * Next's router are the stub-auditfix-* stubs, used as they are; the
 * dashboard's data hook counts its callers (stub-bootsec-dashboard-data.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildInsightCorpus } from "../src/lib/insights/corpus";
import { runAskQuery } from "../src/lib/insights/ask";
import type { CategoryAssignmentRow, TrackRow, TrendRow } from "../src/types/database";
import { stubModule } from "./support/route-harness";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/recharts/lib/index.js", support("stub-auditfix-recharts.ts"));
stubModule("/node_modules/recharts/es6/index.js", support("stub-auditfix-recharts.ts"));
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/hooks/useData.ts", support("stub-bootsec-dashboard-data.ts"));
(globalThis as { React?: typeof React }).React = React;

const PROJECT = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment studies" };
const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

function row(paper: string, year: string, topic: string, keyword: string): TrendRow {
  return { paper_id: paper, year, title: `Paper ${paper}`, topic, keyword, keyword_frequency: 1, evidence: "" } as TrendRow;
}
/** Twelve papers, 2018-2023: Writing in six, Reading and Speaking in three each. */
const TRENDS = [
  ...Array.from({ length: 6 }, (_, i) => row(String(i + 1), String(2018 + (i % 3)), i % 2 ? "Reading" : "Writing", i % 2 ? "fluency" : "feedback")),
  ...Array.from({ length: 6 }, (_, i) => row(String(i + 10), String(2021 + (i % 3)), i % 2 ? "Speaking" : "Writing", i % 3 ? "peer review" : "feedback")),
];
const TRACKS = [...new Set(TRENDS.map((entry) => entry.paper_id))].map(
  (id, i) => ({ paper_id: id, year: TRENDS.find((entry) => entry.paper_id === id)!.year, title: `Paper ${id}`, el: i % 2, eli: 1 - (i % 2), lae: 0, other: 0 }) as TrackRow
);

function signedIn(currentProject: typeof PROJECT | null) {
  globalThis.__auditfixAuth = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "reader-token" } };
  globalThis.__auditfixWorkspace = {
    currentProject,
    hasActiveProject: Boolean(currentProject),
    selectedProjectId: currentProject?.id ?? null,
    allProjects: [PROJECT],
    filtersLoadedFor: currentProject?.id ?? null,
    profile: {},
    selectedYears: [],
    selectedTracks: [],
    searchQuery: "",
  };
  globalThis.__bootsecDashboardDataCalls = 0;
}

async function dashboard(tab: string) {
  signedIn(PROJECT);
  globalThis.__bootsecDashboardData = { loading: false, data: { trends: TRENDS, tracksSingle: TRACKS, tracksMulti: TRACKS, categoryAssignments: [], useMock: false, diagnostics: {} } };
  globalThis.__auditfixSearch = `tab=${tab}`;
  try {
    const { default: DashboardClient } = await import("../src/components/DashboardClient");
    const { AnalysisRunsContext } = await import("../src/components/workspace/AnalysisRunsContext");
    return renderToStaticMarkup(createElement(AnalysisRunsContext.Provider, { value: { runs: [], folderJob: null } as never }, createElement(DashboardClient)));
  } finally {
    globalThis.__auditfixSearch = undefined;
  }
}

/* ------------------------------------------------------------- the chat page */

test("the chat page does not load the dashboard's data, and starts on the open repository", async () => {
  const { default: ChatClient } = await import("../src/components/chat/ChatClient");
  signedIn(PROJECT);
  const inRepository = visible(renderToStaticMarkup(createElement(ChatClient)));
  assert.equal(globalThis.__bootsecDashboardDataCalls, 0, "the chat page never asks for the dashboard");
  assert.match(inRepository, /Searching Assessment studies repository/);

  signedIn(null);
  const noRepository = visible(renderToStaticMarkup(createElement(ChatClient)));
  assert.doesNotMatch(noRepository, /Searching Assessment studies/, "with none open, it does not pick one");

  // The count works: the dashboard asks.
  await dashboard("area_analysis");
  assert.ok((globalThis.__bootsecDashboardDataCalls ?? 0) > 0);
});

/* ------------------------------------------------------------ the dashboard */

test("only the tab the dashboard opens on is drawn; the others wait until they are visited", async () => {
  // Every tab's code loads when it is opened, so a first static render may show
  // its placeholder: draw once, let the code arrive, then draw what is checked.
  await dashboard("area_analysis");
  await import("../src/components/tabs/AreaAnalysis");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const area = await dashboard("area_analysis");
  assert.match(visible(area), /Gaining and losing ground/);
  assert.doesNotMatch(area, /<div hidden="">/, "the open tab is shown");
  assert.match(visible(area), /Copy link/);
  const keywords = await dashboard("keyword_explorer");
  assert.doesNotMatch(visible(keywords), /Gaining and losing ground/, "Area Analysis was never visited, so it is not drawn");
});

/** Each chart's CSV, by the name its file is given. */
function csvNames(html: string) {
  return [...html.matchAll(/Download CSV<span class="sr-only">: ([^<]*)</g)].map((match) => match[1]);
}

/** Whether every "Show the values" list has a CSV beside it. */
function valueListsWithoutCsv(html: string) {
  const missing: number[] = [];
  let at = html.indexOf(">Show the values<");
  while (at >= 0) {
    const end = html.indexOf("</details>", at) + "</details>".length;
    const next = html.slice(end, end + 1_500);
    if (!(next.startsWith("<button") && next.slice(0, next.indexOf("</button>")).includes("Download CSV"))) missing.push(at);
    at = html.indexOf(">Show the values<", end);
  }
  return missing;
}

test("every chart on the dashboard's tabs offers its data as CSV, and every list of values has its CSV", async () => {
  const tabs = {
    TrendAnalysis: (await import("../src/components/tabs/TrendAnalysis")).default,
    TrackAnalysis: (await import("../src/components/tabs/TrackAnalysis")).default,
    KeywordExplorer: (await import("../src/components/tabs/KeywordExplorer")).default,
  };
  const props = { trends: TRENDS, tracksSingle: TRACKS, tracksMulti: TRACKS, selectedTracks: ["EL", "ELI", "LAE", "Other"], categoryAssignments: [] };
  const drawn = Object.fromEntries(
    Object.entries(tabs).map(([name, Tab]) => [name, renderToStaticMarkup(createElement(Tab as React.ComponentType<typeof props>, props))])
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(drawn).map(([name, html]) => [name, csvNames(html)])),
    {
      TrendAnalysis: ["Themes by year", "Gaining ground 2018–2020 to 2021–2023", "Losing ground 2018–2020 to 2021–2023"],
      TrackAnalysis: ["Papers per research area per year", "Research area co-occurrence", "Topics in EL", "Topics in ELI"],
      KeywordExplorer: ["Keywords used by the most papers", "Themes across years", "Theme sizes", "Themes and what they gather", "Compare themes over time"],
    }
  );
  for (const [name, html] of Object.entries(drawn)) {
    assert.ok(html.includes(">Show the values<"), `${name} lists its values`);
    assert.deepEqual(valueListsWithoutCsv(html), [], `${name}: a list of values without its CSV`);
  }
});

/* ---------------------------------------------------------- a chart in chat */

test("a computed chart in chat is the Adaptive tab's chart, with its basis and its papers", async () => {
  const trends: TrendRow[] = [];
  const categories: CategoryAssignmentRow[] = [];
  for (let paper = 1; paper <= 12; paper += 1) {
    trends.push({ ...row(String(paper), String(2015 + (paper % 6)), paper % 3 ? "Reading" : "Writing", "k"), topic_kind: "topic" } as TrendRow);
    categories.push({ paper_id: String(paper), year: String(2015 + (paper % 6)), title: `Paper ${paper}`, category_key: "eli", category_label: "Instruction", assignment_type: "single" });
  }
  const corpus = buildInsightCorpus({ trends, categoryAssignments: categories, classificationEnabled: true });
  const answer = runAskQuery(corpus, { answerable: true, title: "", measure: "papers", rows: "year", columns: null, focus: null, about: [] });
  assert.ok("insight" in answer);
  if (!("insight" in answer)) return;
  const { default: ChatInsightCard } = await import("../src/components/chat/ChatInsightCard");
  const { default: InsightChart } = await import("../src/components/dashboard/InsightChart");
  const card = renderToStaticMarkup(createElement(ChatInsightCard, { chart: { title: answer.insight.question, scopeLabel: "Assessment studies", insight: answer.insight } }));
  const adaptive = renderToStaticMarkup(createElement(InsightChart, { insight: answer.insight, onOpen: () => undefined }));
  assert.ok(adaptive.length > 200);
  assert.ok(card.includes(adaptive), "the same chart the Adaptive tab draws");
  assert.match(visible(card), /Chart · Assessment studies Papers per year/);
  assert.ok(visible(card).includes(visible(renderToStaticMarkup(createElement("p", null, answer.insight.basis))).trim()), "its basis");
  assert.match(visible(card), new RegExp(`The ${answer.insight.paperIds.length} papers behind this`));
});
