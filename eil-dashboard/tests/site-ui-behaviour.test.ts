/*
 * The site UI fixes (tests/site-ui.test.ts, tests/site-ui-visual.test.ts),
 * drawn rather than read: the public pages, the docs, sign-in, the workspace
 * shell, settings, the Library, the dashboard and its charts are rendered as
 * the server sends them, and their markup is checked. Sign-in, the workspace
 * state, the theme, the dashboard data, the dialog layer and Next's router
 * are swapped for what each test sets (tests/support/stub-auditfix-*.ts and
 * stub-siteui-*.ts), and recharts is given a fixed size; the components run
 * as written.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import React, { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chartTheme } from "../src/lib/chart-theme";
import type { Insight } from "../src/lib/insights/types";
import type { IngestionRunRow, TrackRow, TrendRow } from "../src/types/database";
import { stubModule } from "./support/route-harness";
import { SiteUiRedirect } from "./support/stub-siteui-navigation";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/recharts/lib/index.js", support("stub-auditfix-recharts.ts"));
stubModule("/node_modules/recharts/es6/index.js", support("stub-auditfix-recharts.ts"));
stubModule("/node_modules/next/navigation.js", support("stub-siteui-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
stubModule("/src/components/workspace/WorkspaceGlobalSearch.tsx", support("stub-auditfix-search.ts"));
stubModule("/src/hooks/useData.ts", support("stub-siteui-dashboard-data.ts"));
stubModule("/src/components/ui/Modal.tsx", support("stub-siteui-modal.ts"));
process.env.NEXT_PUBLIC_PROJECT_ANALYSIS_PROFILES_ENABLED = "true";
(globalThis as { React?: typeof React }).React = React;

const SIGNED_IN = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "token" } };
const PROJECT = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment studies", description: null };
const OTHER_PROJECT = { id: "00000000-0000-4000-8000-0000000000a2", name: "Phonology corpus", description: null };
const TRACKS = ["EL", "ELI", "LAE", "Other"];

const exists = (relative: string) => existsSync(new URL(`../${relative}`, import.meta.url));
const decode = (value: string) =>
  value.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
/** Every class name drawn on the page, one entry per use. */
const classNames = (html: string) => [...html.matchAll(/class="([^"]*)"/g)].flatMap((match) => decode(match[1]).split(/\s+/).filter(Boolean));
/** The opening tag and text of each element `tag` whose text includes `label`. */
function elementsLabelled(html: string, tag: string, label: string) {
  return [...html.matchAll(new RegExp(`(<${tag}\\b[^>]*>)([\\s\\S]*?)</${tag}>`, "g"))]
    .filter((match) => text(match[2]).includes(label))
    .map((match) => ({ open: match[1], inner: match[2] }));
}
const attribute = (open: string, name: string) => decode(new RegExp(`\\s${name}="([^"]*)"`).exec(open)?.[1] ?? "");
const classesOf = (open: string) => attribute(open, "class").split(/\s+/).filter(Boolean);

function row(paper: string, year: string, topic: string, keyword = "shared keyword"): TrendRow {
  return { paper_id: paper, year, title: `Paper ${paper}`, topic, keyword, keyword_frequency: 1, evidence: "" } as TrendRow;
}

const TRENDS = [
  ...["1", "2", "3"].map((id) => row(id, "2018", "Reading", "reading fluency")),
  ...["4", "5"].map((id) => row(id, "2020", "Writing", "peer feedback")),
  ...["6", "7", "8"].map((id) => row(id, "2023", "Reading", "reading fluency")),
  row("8", "2023", "Writing", "peer feedback"),
];

function tracksOf(rows: TrendRow[]): TrackRow[] {
  const ids = [...new Set(rows.map((entry) => entry.paper_id))];
  return ids.map((id, index) => {
    const source = rows.find((entry) => entry.paper_id === id)!;
    return { paper_id: id, year: source.year, title: source.title, el: index % 2, eli: (index + 1) % 2, lae: 0, other: 0 } as TrackRow;
  });
}

function run(id: string, status: IngestionRunRow["status"], title: string): IngestionRunRow {
  const at = new Date(Date.now() - 60_000).toISOString();
  return { id, source_type: "upload", status, source_filename: `${id}.pdf`, display_name: title, created_at: at, updated_at: at };
}

function draw<P extends object>(component: ComponentType<P>, props: P) {
  return renderToStaticMarkup(createElement(component, props));
}

/* ---------------------------------------------------------- pages to draw */

async function homePage(theme: "light" | "dark" = "light") {
  globalThis.__auditfixTheme = theme;
  globalThis.__auditfixAuth = undefined;
  const { default: LandingPage } = await import("../src/app/page");
  return renderToStaticMarkup(createElement(LandingPage));
}

const FEATURE_SLUGS = ["paper-analysis", "research-dashboard", "ai-research-chat"];

async function featurePage(slug: string, theme: "light" | "dark" = "light") {
  globalThis.__auditfixTheme = theme;
  globalThis.__auditfixAuth = undefined;
  const { default: FeaturePage } = await import("../src/app/features/[slug]/page");
  return renderToStaticMarkup(await FeaturePage({ params: Promise.resolve({ slug }) }));
}

async function publicPages() {
  return [await homePage(), ...(await Promise.all(FEATURE_SLUGS.map((slug) => featurePage(slug))))];
}

async function shellAt(pathname: string, workspace: Record<string, unknown> = {}) {
  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixTheme = "light";
  globalThis.__siteuiPathname = pathname;
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: [PROJECT], ...workspace };
  const { default: WorkspaceShell } = await import("../src/components/workspace/WorkspaceShell");
  return renderToStaticMarkup(createElement(WorkspaceShell, null, createElement("p", null, "The page itself")));
}

/** The pages the shell last handed its search. */
function searchPages(): Array<{ label: string; href: string }> {
  return globalThis.__auditfixSearchPages ?? [];
}

const DASHBOARD_WORKSPACE = {
  currentProject: PROJECT,
  hasActiveProject: true,
  selectedProjectId: PROJECT.id,
  allProjects: [PROJECT],
  filtersLoadedFor: PROJECT.id,
  profile: {},
  selectedYears: [],
  selectedTracks: TRACKS,
  searchQuery: "",
  setSelectedYears: () => undefined,
  setSelectedTracks: () => undefined,
  setSearchQuery: () => undefined,
};

/** The dashboard as drawn once `data` has loaded, at the address `search`. */
async function dashboard(data: Record<string, unknown>, options: { search?: string; workspace?: Record<string, unknown> } = {}) {
  globalThis.__auditfixTheme = "light";
  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixWorkspace = { ...DASHBOARD_WORKSPACE, ...options.workspace };
  globalThis.__siteuiDashboardData = {
    loading: false,
    data: { trends: [], tracksSingle: [], tracksMulti: [], categoryAssignments: [], useMock: false, diagnostics: {}, ...data },
  };
  globalThis.__siteuiDashboardRequests = [];
  // These cases read the chart tabs' header, search and filters; the dashboard
  // opens on the semantic map, which has none of them, so Area Analysis is opened.
  globalThis.__siteuiSearch = options.search ?? "tab=area_analysis";
  try {
    const { default: DashboardClient } = await import("../src/components/DashboardClient");
    const { AnalysisRunsContext } = await import("../src/components/workspace/AnalysisRunsContext");
    return renderToStaticMarkup(
      createElement(AnalysisRunsContext.Provider, { value: { runs: [], folderJob: null } as never }, createElement(DashboardClient))
    );
  } finally {
    globalThis.__siteuiSearch = undefined;
  }
}

const ANALYSED = { trends: TRENDS, tracksSingle: tracksOf(TRENDS), tracksMulti: tracksOf(TRENDS) };

async function library(search = "", workspace: Record<string, unknown> = {}) {
  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: [PROJECT, OTHER_PROJECT], ...workspace };
  globalThis.__siteuiSearch = search;
  try {
    const { default: Library } = await import("../src/components/admin/AdminImportClient");
    return renderToStaticMarkup(createElement(Library));
  } finally {
    globalThis.__siteuiSearch = undefined;
  }
}

async function settingsAt(section: string, auth: Record<string, unknown> = SIGNED_IN) {
  globalThis.__auditfixAuth = auth;
  globalThis.__auditfixWorkspace = { currentProject: { ...PROJECT, analysis_profile: null }, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: [PROJECT] };
  globalThis.__siteuiSearch = `section=${section}`;
  try {
    const { default: WorkspaceSettingsClient } = await import("../src/components/workspace/WorkspaceSettingsClient");
    return renderToStaticMarkup(createElement(WorkspaceSettingsClient));
  } finally {
    globalThis.__siteuiSearch = undefined;
  }
}

async function docsPagesDrawn() {
  const { DocsArticle } = await import("../src/components/docs/DocsFrame");
  const { docsPages } = await import("../src/lib/docs-content");
  return docsPages.map((page) => renderToStaticMarkup(createElement(DocsArticle, { page })));
}

async function signInPage() {
  globalThis.__auditfixAuth = undefined;
  const { default: AuthPanel } = await import("../src/components/auth/AuthPanel");
  return renderToStaticMarkup(createElement(AuthPanel));
}

/* ------------------------------------------------- chart legibility and colour */

test("every chart tab draws its tick labels, axes and gridlines in the theme's colours", async () => {
  // Four of five chart components once hardcoded stroke="#94a3b8" (2.6:1) and
  // never read the theme; three gridlines drew bright dashes on the dark page.
  const tabs: Array<[string, ComponentType<never>, Record<string, unknown>]> = [
    ["TrendAnalysis", (await import("../src/components/tabs/TrendAnalysis")).default as ComponentType<never>, { trends: TRENDS }],
    ["KeywordExplorer", (await import("../src/components/tabs/KeywordExplorer")).default as ComponentType<never>, { trends: TRENDS }],
    [
      "TrackAnalysis",
      (await import("../src/components/tabs/TrackAnalysis")).default as ComponentType<never>,
      { trends: TRENDS, tracksSingle: tracksOf(TRENDS), tracksMulti: tracksOf(TRENDS), selectedTracks: TRACKS },
    ],
  ];
  for (const theme of ["light", "dark"] as const) {
    const ct = chartTheme(theme === "dark");
    globalThis.__auditfixTheme = theme;
    for (const [name, Tab, props] of tabs) {
      const html = renderToStaticMarkup(createElement(Tab, props as never));
      assert.doesNotMatch(html, /#94a3b8/i, `${name} (${theme}) draws the old axis grey`);
      const ticks = [...html.matchAll(/<text\b[^>]*class="recharts-text recharts-cartesian-axis-tick-value"[^>]*>/g)].map((match) => attribute(match[0], "fill"));
      assert.ok(ticks.length > 0, `${name} (${theme}) draws tick labels`);
      assert.deepEqual([...new Set(ticks)], [ct.label], `${name} (${theme}) tick label fill`);
      const grid = [...html.matchAll(/<g class="recharts-cartesian-grid-(?:horizontal|vertical)">([\s\S]*?)<\/g>/g)].flatMap((match) =>
        [...match[1].matchAll(/<line\b[^>]*>/g)].map((line) => attribute(line[0], "stroke"))
      );
      assert.ok(grid.length > 0, `${name} (${theme}) draws gridlines`);
      assert.deepEqual([...new Set(grid)], [ct.grid], `${name} (${theme}) gridline stroke`);
      const axes = [...html.matchAll(/<line\b[^>]*class="recharts-cartesian-axis-line"[^>]*>/g)].map((match) => attribute(match[0], "stroke"));
      assert.deepEqual([...new Set(axes)], [ct.axisLine], `${name} (${theme}) axis stroke`);
    }
  }
});

function insight(chart: Insight["chart"]): Insight {
  return {
    id: `test_${chart.kind}`,
    family: "composition",
    question: "What do the papers study?",
    view: { measure: "papers", rows: "themes" },
    chart,
    facts: [],
    takeaway: "",
    score: 1,
    paperIds: ["1", "2"],
    basis: "Based on 2 papers.",
  };
}

const ALL_INSIGHT_CHARTS: Insight[] = [
  insight({ kind: "bars", valueLabel: "Papers", unit: "papers", rows: [{ label: "Reading", value: 3, paperIds: ["1", "2", "3"] }, { label: "Writing", value: 2, paperIds: ["4", "5"] }] }),
  insight({ kind: "pairs", rows: [{ a: "Reading", b: "Writing", together: 2, lift: 1.6, aPapers: 3, bPapers: 2, paperIds: ["4", "5"] }] }),
  insight({
    kind: "matrix",
    rowLabel: "Themes",
    colLabel: "Methods",
    rows: ["Reading", "Writing"],
    cols: ["Survey", "Interview"],
    values: [[2, 0], [1, 3]],
    marks: [[1, 1, "strong"], [0, 1, "absent"]],
    paperIds: [[["1", "2"], []], [["3"], ["4", "5", "6"]]],
  }),
  insight({ kind: "compare", leftLabel: "2018–2020", rightLabel: "2021–2023", unit: "percent", sequence: "time", rows: [{ label: "Reading", left: 40, right: 60, tag: "gaining", paperIds: ["1"] }] }),
  insight({ kind: "lifecycles", years: ["2018", "2019", "2020"], rows: [{ label: "Reading", status: "enduring", first: "2018", last: "2020", papers: 3, series: [1, 1, 1], paperIds: ["1", "2", "3"] }] }),
  insight({ kind: "list", rows: [{ title: "A lone study", detail: "Shares no theme with another paper.", paperIds: ["9"] }] }),
];

async function insightCharts(theme: "light" | "dark") {
  globalThis.__auditfixTheme = theme;
  const { default: InsightChart } = await import("../src/components/dashboard/InsightChart");
  return ALL_INSIGHT_CHARTS.map((entry) => renderToStaticMarkup(createElement(InsightChart, { insight: entry, onOpen: () => undefined })));
}

test("an Adaptive chart draws one quantity in one fill, and writes no colour of its own into the markup", async () => {
  // The same "Papers" series was cyan, purple and hot pink in three adjacent charts.
  for (const theme of ["light", "dark"] as const) {
    const [bars, pairs, ...rest] = await insightCharts(theme);
    const fills = (html: string) =>
      [...html.matchAll(/<span class="block h-full rounded-full ([^"]*)" style="width:/g)].map((match) => match[1]);
    assert.equal(fills(bars).length, 2, "one bar per row");
    assert.deepEqual([...new Set([...fills(bars), ...fills(pairs)])], ["bg-accent"], "bars and pairs share one fill, the accent");
    for (const html of [bars, pairs, ...rest]) {
      assert.doesNotMatch(html, /\s(?:fill|stroke)="#[0-9a-f]{3,8}"/i, "no chart colour is written in");
    }
  }
});

/* ----------------------------------------------------- the stock palette is gone */

test("the public pages and the Adaptive charts use none of the borrowed template palette", async () => {
  // The stock gradient of a well-known deployment template, which had leaked
  // off the marketing pages into real dashboard charts.
  const stock = ["#007cf0", "#00dfd8", "#ff0080", "#7928ca", "#f9cb28", "#50e3c2", "#ff4d4d", "#eb367f"];
  const content = await import("../src/components/marketing/marketing-content");
  const styles = await import("../src/components/marketing/styles");
  const drawn = [...(await publicPages()), ...(await insightCharts("light")), ...(await insightCharts("dark")), JSON.stringify(content), JSON.stringify(styles)];
  for (const html of drawn) {
    for (const hex of stock) assert.equal(html.toLowerCase().includes(hex), false, `${hex} in ${text(html).slice(0, 60)}`);
  }
});

test("the public pages show screenshots of the real product, each with its size reserved, in both themes", async () => {
  // The front page used to carry div-built imitations of the product.
  const { SHOT_SIZES } = await import("../src/components/marketing/shot-manifest");
  const { marketingFeatures } = await import("../src/components/marketing/marketing-content");
  const pages = await publicPages();
  const images = pages.flatMap((html) => [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]));
  const shots = new Map<string, Set<string>>();
  for (const image of images) {
    const shot = /^\/marketing\/([a-z-]+)-(light|dark)\.webp$/.exec(attribute(image, "src"));
    assert.ok(shot, `a picture that is not a product screenshot: ${attribute(image, "src")}`);
    const [, name, theme] = shot;
    if (!shots.has(name)) shots.set(name, new Set());
    shots.get(name)!.add(theme);
    assert.ok(SHOT_SIZES[name], `${name} has no recorded size`);
    assert.equal(attribute(image, "width"), String(SHOT_SIZES[name].width), `${name} reserves its width`);
    assert.equal(attribute(image, "height"), String(SHOT_SIZES[name].height), `${name} reserves its height`);
    assert.ok(attribute(image, "alt").length > 20, `${name} says what it shows`);
  }
  assert.ok(shots.size >= 4, `expected several screenshots, found ${[...shots.keys()].join(", ")}`);
  for (const feature of marketingFeatures) {
    assert.ok(shots.has(feature.shot), `${feature.slug}'s ${feature.shot} screenshot is shown`);
  }
  for (const [name, themes] of shots) {
    assert.deepEqual([...themes].sort(), ["dark", "light"], `${name} is drawn for both themes`);
    for (const theme of themes) assert.ok(exists(`public/marketing/${name}-${theme}.webp`), `${name}-${theme}.webp is missing`);
  }
});

test("the product clips are muted inline loops in the page's own theme, with a control beside each", async () => {
  for (const theme of ["light", "dark"] as const) {
    const html = await homePage(theme);
    const videos = [...html.matchAll(/<video\b[^>]*>/g)].map((match) => match[0]);
    assert.ok(videos.length >= 3, "the front page has clips");
    for (const video of videos) {
      const clip = /^\/marketing\/video\/([a-z-]+)-(light|dark)\.mp4$/.exec(attribute(video, "src"));
      assert.ok(clip, attribute(video, "src"));
      assert.equal(clip[2], theme, "the clip matches the page's theme");
      for (const other of ["light", "dark"]) assert.ok(exists(`public/marketing/video/${clip[1]}-${other}.mp4`), `${clip[1]}-${other}.mp4 is missing`);
      assert.match(video, /\smuted=""/, "a clip never plays sound");
      assert.match(video, /\splaysInline=""/i, "nor takes over a phone's screen");
      assert.ok(attribute(video, "aria-label").length > 20, "it is named");
    }
    const controls = [...html.matchAll(/<button\b[^>]*aria-label="(Play|Pause) the product video"[^>]*>/g)];
    assert.equal(controls.length, videos.length, "every clip can be stopped and started");
  }
});

test("the recording's mock API answers what it knows from the invented collection, and refuses the rest", async () => {
  // Recorded against this mock, so a real account's papers cannot reach a public video.
  // The address is held in a variable so tsc leaves the script, which types
  // itself against Playwright (not installed for the app), out of the project.
  const harnessModule = "../scripts/marketing-mock/harness";
  type Handler = (route: unknown) => Promise<unknown>;
  type Context = { route: (match: (url: URL) => boolean, handler: Handler) => Promise<void> };
  const { installMockApi, loadFixtures } = (await import(harnessModule)) as {
    loadFixtures: () => Record<string, unknown>;
    installMockApi: (context: Context, fixtures: Record<string, unknown>, options: { onUnknown: (method: string, path: string) => void }) => Promise<void>;
  };
  const fixtures = loadFixtures();
  const routes: Array<[(url: URL) => boolean, Handler]> = [];
  const context: Context = { route: async (match, handler) => void routes.push([match, handler]) };
  const unknown: string[] = [];
  await installMockApi(context, fixtures, { onUnknown: (method, path) => unknown.push(`${method} ${path}`) });
  async function call(method: string, href: string) {
    const url = new URL(href);
    const handler = routes.find(([match]) => match(url))?.[1];
    assert.ok(handler, `nothing answers ${href}`);
    let answer: { status: number; body: string | Buffer } | undefined;
    await handler({ request: () => ({ url: () => href, method: () => method }), fulfill: async (response: { status: number; body: string | Buffer }) => void (answer = response) });
    assert.ok(answer, `${href} was neither answered nor refused`);
    return answer;
  }
  const projects = await call("GET", "https://papertrend.test/api/workspace/projects");
  assert.equal(projects.status, 200);
  assert.deepEqual(JSON.parse(String(projects.body)), fixtures.projects);
  for (const [method, path] of [["GET", "/api/workspace/insights"], ["DELETE", "/api/workspace/projects"], ["POST", "/api/account/export"]]) {
    const refused = await call(method, `https://papertrend.test${path}`);
    assert.equal(refused.status, 404, `${method} ${path}`);
    assert.deepEqual(JSON.parse(String(refused.body)), { error: "Not available in the demo recording." });
  }
  assert.deepEqual(unknown, ["GET /api/workspace/insights", "DELETE /api/workspace/projects", "POST /api/account/export"], "each refusal is reported");
});

/* --------------------------------------------------------- published figures */

test("each figure on the feature pages is one the product can be counted to have", async () => {
  // "9 analysis passes" matched nothing; "Live library updates" claimed a
  // refresh the dashboard does not do, and "4 category views" were six.
  const analysis = text(await featurePage("paper-analysis"));
  assert.match(analysis, /Thirteen steps\. Four at a time\./);
  assert.match(analysis, /13 per paper/);
  assert.equal(/analysis passes|12 analysis stages/.test(analysis), false);
  // The timeline draws the thirteen steps, each a control that opens its note.
  const timeline = analysis.match(/Read the PDF[\s\S]*?Save/)?.[0] ?? "";
  for (const step of ["Read the PDF", "Clean", "Translate", "Find the sections", "Title and year", "Grounded keywords", "own keywords", "Aims and contributions", "Group into topics", "Name the topics", "Research area", "Kind of study"]) {
    assert.ok(timeline.includes(step), step);
  }
  const dashboardPage = text(await featurePage("research-dashboard"));
  assert.match(dashboardPage, /Four views, four questions\./);
  assert.equal(/^Live |4 category views/.test(dashboardPage), false);

  // Four views: the dashboard draws four tabs, the semantic map first (2026-10-09 review).
  const html = await dashboard(ANALYSED);
  const tabs = /<nav\b[^>]*aria-label="Tabs"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
  assert.deepEqual(
    [...tabs.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]),
    ["Semantic Map", "Area Analysis", "Keyword Explorer", "Adaptive"]
  );
  // Not live: the dashboard asks for its data once, with no polling and no refetch on focus.
  const requests = globalThis.__siteuiDashboardRequests ?? [];
  assert.ok(requests.length > 0);
  for (const options of requests) {
    assert.equal(options.pollIntervalMs, undefined, "no polling interval");
    assert.equal(options.refetchOnWindowFocus, false);
  }
});

/* ------------------------------------------------------- the public pages */

test("the footer's links are drawn as a list of links, each with a padded target", async () => {
  // Six links were bordered, filled boxes - the site's control treatment.
  const { MarketingFooter } = await import("../src/components/marketing/MarketingLayout");
  const html = renderToStaticMarkup(createElement(MarketingFooter));
  const nav = /<nav\b[^>]*aria-label="Footer"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
  assert.ok(nav, "the footer's links are a named navigation landmark");
  const links = [...nav.matchAll(/<a\b[^>]*>/g)].map((match) => classesOf(match[0]));
  assert.ok(links.length >= 6);
  for (const link of links) {
    for (const padded of ["-mx-2", "inline-block", "rounded", "px-2", "py-2", "text-sm"]) assert.ok(link.includes(padded), `${padded} in ${link.join(" ")}`);
    assert.equal(link.some((name) => /^(?:border|bg-)/.test(name)), false, `a link wearing the control treatment: ${link.join(" ")}`);
  }
});

test("no product frame carries the rainbow sweep", async () => {
  for (const html of await publicPages()) assert.equal(classNames(html).some((name) => name.includes("marketing-scanline")), false);
});

test("no hover or other variant colour on the public pages is fixed to a single theme", async () => {
  // The light-mode retrofit rewrites base classes by name, so `hover:bg-[#0a0a0a]`
  // was never converted and kept its dark value on the light page.
  const banned = /^(?:hover|focus|focus-visible|active|first|last|odd|even|group-hover):(?:bg|border|text)-\[#[0-9a-fA-F]{6}\]$/;
  for (const html of await publicPages()) {
    assert.deepEqual(classNames(html).filter((name) => banned.test(name)), []);
  }
});

test("a text link on the public pages is padded to a target taller than its text", async () => {
  // The link under each feature was a 20px target for a 14px line.
  // One under each of the front page's three parts.
  const links = elementsLabelled(await homePage(), "a", "More on ");
  assert.ok(links.length >= 3);
  for (const link of links) {
    const classes = classesOf(link.open);
    for (const padded of ["-my-2", "py-2", "inline-flex"]) assert.ok(classes.includes(padded), `${padded} on ${text(link.inner)}`);
  }
});

/* --------------------------------------------------------- the workspace shell */

test("the rail marks the page you are on with a tone that shows in both themes", async () => {
  // The active chip was #111111 on the rail's #050505 (1.08:1); the drawer's
  // was darker than its own surface.
  const html = await shellAt("/workspace/dashboard");
  const current = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)].map((match) => match[0]);
  assert.equal(current.length, 1, "one page is current");
  assert.equal(attribute(current[0], "href"), "/workspace/dashboard");
  for (const name of ["bg-slate-900", "text-white", "dark:bg-[#1f1f1f]"]) assert.ok(classesOf(current[0]).includes(name), name);
  const home = [...html.matchAll(/<a\b[^>]*href="\/workspace\/home"[^>]*>/g)].map((match) => classesOf(match[0]));
  assert.ok(home.length > 0);
  for (const classes of home) assert.equal(classes.includes("bg-slate-900"), false, "a page you are not on is not marked");
  assert.equal(classNames(html).some((name) => name === "dark:bg-[#111111]" || name === "dark:bg-[#030303]"), false);
});

test("the breadcrumb's separator is hidden from screen readers", async () => {
  const html = await shellAt("/workspace/home");
  const separators = [...html.matchAll(/<span\b([^>]*)>&gt;<\/span>/g)].map((match) => match[1]);
  assert.equal(separators.length, 1);
  assert.match(separators[0], /aria-hidden="true"/);
});

test("on a phone the header keeps a named way back to the repository picker, and the repository's name", async () => {
  // Both halves truncated at 390px ("Rep... > T..."); the link back to
  // /workspaces is the only route to the picker, so it changes shape instead of vanishing.
  const html = await shellAt("/workspace/home");
  const back = [...html.matchAll(/(<a\b[^>]*aria-label="All repositories"[^>]*>)([\s\S]*?)<\/a>/g)];
  assert.equal(back.length, 1);
  const [, open, inner] = back[0];
  assert.equal(attribute(open, "href"), "/workspaces");
  assert.equal(classesOf(open).includes("hidden"), false, "the link itself is never hidden");
  assert.match(inner, /<svg\b[^>]*class="[^"]*\brotate-180 sm:hidden\b/, "below sm it is a back arrow");
  assert.match(inner, /<span class="hidden sm:inline">Repositories<\/span>/, "from sm it reads Repositories");
  const name = elementsLabelled(html, "span", PROJECT.name).find((span) => text(span.inner).trim() === PROJECT.name);
  assert.ok(name);
  assert.ok(classesOf(name.open).includes("truncate") && classesOf(name.open).includes("min-w-0"), "the repository's name is the part that truncates");
});

test("the History page is gone from the navigation and search, and its old address opens the Library", async () => {
  globalThis.__auditfixSearchPages = undefined;
  const html = await shellAt("/workspace/home");
  assert.doesNotMatch(html, /\/workspace\/logs/);
  assert.doesNotMatch(text(html), /\bHistory\b/);
  const pages = searchPages();
  assert.ok(pages.length > 0);
  assert.equal(pages.some((page) => page.href.includes("/workspace/logs") || page.label === "History"), false);

  const { default: WorkspaceLogsPage } = await import("../src/app/workspace/logs/page");
  assert.throws(() => WorkspaceLogsPage(), (error: unknown) => error instanceof SiteUiRedirect && error.href === "/workspace/library");
});

test("search lists every page under its own name", async () => {
  // "Repositories" named both /workspaces and /workspace/library.
  globalThis.__auditfixSearchPages = undefined;
  await shellAt("/workspace/home");
  const labels = searchPages().map((page) => page.label);
  assert.ok(labels.length >= 7, labels.join(", "));
  assert.equal(new Set(labels).size, labels.length, `a label used twice: ${labels.join(", ")}`);
});

test("the analysis card's library button opens the Library, by that name", async () => {
  // "Open imports" pointed at /workspace/imports, a redirect to a page titled otherwise.
  const { default: AnalysisStatusCard } = await import("../src/components/workspace/AnalysisStatusCard");
  const html = renderToStaticMarkup(createElement(AnalysisStatusCard, { runs: [run("r1", "processing", "Peer feedback")] }));
  const links = elementsLabelled(html, "a", "Open library");
  assert.equal(links.length, 1);
  assert.equal(attribute(links[0].open, "href"), "/workspace/library");
  assert.doesNotMatch(html, /\/workspace\/imports/);
});

/* --------------------------------------------------------------- choices */

function radios(html: string) {
  return [...html.matchAll(/<button\b[^>]*role="radio"[^>]*>[\s\S]*?<\/button>/g)].map((match) => {
    const open = /^<button\b[^>]*>/.exec(match[0])![0];
    return { checked: attribute(open, "aria-checked"), classes: attribute(open, "class"), label: text(match[0]).trim() };
  });
}

const RING = "border-ink shadow-[0_0_0_1px_rgb(var(--ink))]";
const HAIRLINE = "border-hairline hover:border-hairline-strong hover:bg-subtle";

function assertOneChosen(html: string, group: string, chosen: string, count: number) {
  assert.match(html, new RegExp(`role="radiogroup" aria-label="${group}"`), `${group} is a radio group`);
  const options = radios(html);
  assert.equal(options.length, count, group);
  for (const option of options) {
    const isChosen = option.label.startsWith(chosen);
    assert.equal(option.checked, String(isChosen), `${option.label}: aria-checked`);
    assert.equal(option.classes.includes(RING), isChosen, `${option.label}: the ink ring`);
    assert.equal(option.classes.includes(HAIRLINE), !isChosen, `${option.label}: the hairline`);
  }
}

test("a chosen analysis profile or theme is a checked radio with an ink ring; the others are unchecked hairlines", async () => {
  // Chosen and unchosen once rendered byte-identical dark classes.
  const { default: AnalysisProfileEditor } = await import("../src/components/workspace/AnalysisProfileEditor");
  const { createEilAnalysisProfile, createGeneralAnalysisProfile } = await import("../src/lib/project-analysis-profile");
  assertOneChosen(draw(AnalysisProfileEditor, { value: createEilAnalysisProfile(), onChange: () => undefined }), "Analysis profile", "EIL Tracks", 3);
  assertOneChosen(draw(AnalysisProfileEditor, { value: createGeneralAnalysisProfile(), onChange: () => undefined }), "Analysis profile", "General Research", 3);

  globalThis.__auditfixTheme = "dark";
  assertOneChosen(await settingsAt("appearance"), "Theme", "Dark", 3);
  globalThis.__auditfixTheme = "light";
  assertOneChosen(await settingsAt("appearance"), "Theme", "Light", 3);
});

test("settings show none of the retired goal, intake and output groups", async () => {
  // They wrote to nothing, and one still promised a Supabase sync.
  const admin = { ...SIGNED_IN, isAdmin: true, profile: { role: "admin" } };
  for (const section of ["profile", "security", "appearance", "repository", "analysis", "invites", "requests"]) {
    const page = text(await settingsAt(section, admin));
    assert.match(page, /Settings/, section);
    for (const retired of ["Repository focus", "Intake defaults", "Output defaults", "Research Signal Lab", "Supabase"]) {
      assert.equal(page.includes(retired), false, `${section} shows "${retired}"`);
    }
  }
});

/* ----------------------------------------------------------- page structure */

test("the dashboard names itself with a page heading", async () => {
  // It opened onto a search field: the one workspace page with no h1.
  const html = await dashboard(ANALYSED);
  assert.deepEqual([...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => text(match[1]).trim()), ["Dashboard"]);
});

test("icon-only controls carry a name", async () => {
  const html = await dashboard(ANALYSED);
  const close = [...html.matchAll(/<button\b[^>]*aria-label="Close analytics filters"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.equal(close.length, 1, "the filter panel's close button");
  assert.equal(text(close[0][1]).trim(), "", "it is an icon, so the name is all a screen reader has");

  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixWorkspace = DASHBOARD_WORKSPACE;
  const { default: ChatClient } = await import("../src/components/chat/ChatClient");
  const chat = renderToStaticMarkup(createElement(ChatClient));
  const newChat = [...chat.matchAll(/<button\b[^>]*aria-label="Start a new chat"[^>]*>/g)];
  assert.equal(newChat.length, 1);
});

/* ------------------------------------------------------- citations and links */

test("a chat citation, a paper link and an old papers address all lead to the paper", async () => {
  // /workspace/papers was a redirect that dropped ?paperId=, so every citation opened nothing.
  const { wordCountResult } = await import("../src/lib/repository-chat");
  const { buildRepositoryTermCounts } = await import("../src/lib/repository-text");
  const { parsePaperHref } = await import("../src/lib/paper-address");
  const content = "Peer feedback improves revision in second language writing.";
  const counts = buildRepositoryTermCounts(content);
  const paper = {
    paperId: "paper 7/8",
    runId: "run-7",
    folderId: "folder-1",
    title: "Peer feedback in writing",
    year: "2021",
    abstract: "",
    methods: "",
    results: "",
    conclusion: "",
    content,
    contentHash: "hash-7",
    contentSource: "full_text" as const,
    totalWords: counts.totalWords,
    termCounts: counts.termCounts,
    topics: new Map(),
    keywords: new Map(),
  };
  const result = wordCountResult(
    { scopeLabel: "Repository", papers: [paper], runStats: { total: 1, succeeded: 1, queued: 0, processing: 0, failed: 0, canceled: 0, other: 0 } } as never,
    { intent: "word_count", refinedQuestion: "how many words", terms: [], retrievalQueries: [], evidenceNeeds: [], answerLanguage: "English", retrievalMode: "exhaustive", needsChart: false, chartType: "bar", reason: "test", confidence: "high", source: "fallback" } as never
  );
  assert.deepEqual(result.citations.map((citation) => citation.href), ["/workspace/library?paperId=paper%207%2F8"]);
  assert.deepEqual(parsePaperHref(result.citations[0].href), { runId: null, paperId: "paper 7/8", tab: undefined }, "the Library reads the paper back out of it");

  const { default: PaperLink } = await import("../src/components/workspace/PaperLink");
  const link = renderToStaticMarkup(createElement(PaperLink, { paper: { paperId: "42" }, children: "Open paper" }));
  assert.match(link, /^<a href="\/workspace\/library\?paperId=42">Open paper<\/a>$/);

  const { default: WorkspacePapersPage } = await import("../src/app/workspace/papers/page");
  const redirected = async (searchParams: Record<string, string | string[] | undefined>) => {
    try {
      await WorkspacePapersPage({ searchParams: Promise.resolve(searchParams) });
    } catch (error) {
      if (error instanceof SiteUiRedirect) return error.href;
      throw error;
    }
    assert.fail("the old address must redirect");
  };
  assert.equal(await redirected({ paperId: "42", tab: "evidence" }), "/workspace/library?paperId=42&tab=evidence", "an old bookmark keeps its parameters");
  assert.equal(await redirected({ paperId: ["42", "43"] }), "/workspace/library?paperId=42");
  assert.equal(await redirected({}), "/workspace/library");
});

/* -------------------------------------------------------- state and feedback */

test("browsing another repository in the Library says so, and switching is its own button", async () => {
  // Opening a repository's card also switched the app to it, so the Dashboard
  // and Chat opened next were about it, with nothing on screen saying so.
  const browsing = text(await library(`repo=${OTHER_PROJECT.id}`));
  assert.match(browsing, new RegExp(`You are browsing ${OTHER_PROJECT.name} \\. Dashboard and Chat still use ${PROJECT.name} \\.`));
  assert.match(browsing, /Switch to this repository/);
  for (const own of [await library(`repo=${PROJECT.id}`), await library()]) {
    assert.doesNotMatch(text(own), /You are browsing|Switch to this repository/, "no notice when the two agree");
  }
});

test("the paper explorer's tabs share one base class, and only the chosen one is marked active", async () => {
  // The border sat only on inactive tabs, so clicking one reflowed the row.
  const { default: PaperAnalysisExplorerModal } = await import("../src/components/workspace/PaperAnalysisExplorerModal");
  const idle = async () => undefined;
  const html = renderToStaticMarkup(
    createElement(PaperAnalysisExplorerModal, {
      run: run("r1", "succeeded", "Peer feedback"),
      detail: null,
      loading: true,
      error: null,
      onClose: () => undefined,
      onResolvePreviewUrl: async () => null,
      onOpenInNewTab: idle,
      onDownload: idle,
      onDownloadReport: idle,
      onToggleFavorite: idle,
      onRename: idle,
      onOpenDashboard: () => undefined,
      initialTab: "evidence",
    })
  );
  const nav = /<nav\b[^>]*aria-label="Paper explorer tabs"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
  const tabs = [...nav.matchAll(/(<button\b[^>]*>)([^<]*)<\/button>/g)].map((match) => ({ label: match[2], classes: classesOf(match[1]), current: attribute(match[1], "aria-current") }));
  assert.deepEqual(tabs.map((tab) => tab.label), ["Overview", "Keywords", "Evidence", "Topics", "Preview"]);
  for (const tab of tabs) {
    const active = tab.label === "Evidence";
    assert.deepEqual(tab.classes, ["tab-btn", active ? "tab-btn-active" : "tab-btn-inactive"], tab.label);
    assert.equal(tab.current, active ? "page" : "", tab.label);
  }
});

test("the dashboard's loading fallback is the workspace's own, and no dashboard surface uses the gray scale", async () => {
  // The route's fallback was a beige-bordered white card with a blue spinner and
  // no dark variant; the heatmap had no dark variant at all.
  const { default: WorkspaceDashboardPage } = await import("../src/app/workspace/dashboard/page");
  const { default: WorkspaceLoadingState } = await import("../src/components/workspace/WorkspaceLoadingState");
  const page = WorkspaceDashboardPage() as ReactElement<{ fallback: ReactElement }>;
  assert.equal(page.props.fallback.type, WorkspaceLoadingState, "one loading treatment, not two");
  const fallback = renderToStaticMarkup(page.props.fallback);
  assert.match(fallback, /role="status"/);

  const { default: Heatmap } = await import("../src/components/Heatmap");
  const heatmap = draw(Heatmap, { rows: ["Reading", "Writing"], cols: ["2020", "2021"], values: [[1, 0], [2, 3]], title: "Themes by year" });
  const darkText = (open: string) => classesOf(open).some((name) => name.startsWith("dark:text-"));
  assert.ok(darkText(/<h4\b[^>]*>/.exec(heatmap)?.[0] ?? ""), "the title has a dark colour");
  assert.ok(darkText(/<th\b[^>]*>2020<\/th>/.exec(heatmap)?.[0] ?? ""), "the column headers have a dark colour");
  assert.ok(darkText(/<td\b[^>]*title="Reading"[^>]*>/.exec(heatmap)?.[0] ?? ""), "the row labels have a dark colour");

  const { default: AreaAnalysis } = await import("../src/components/tabs/AreaAnalysis");
  const area = draw(AreaAnalysis, { ...ANALYSED, selectedTracks: TRACKS });
  for (const [name, html] of [["fallback", fallback], ["Heatmap", heatmap], ["Area Analysis", area], ["Dashboard", await dashboard(ANALYSED)]]) {
    assert.deepEqual(classNames(html).filter((cls) => /(?:^|:)(?:text|bg|border)-gray-[0-9]/.test(cls)), [], `${name} uses the gray scale, not slate`);
    assert.doesNotMatch(html, /border-blue-500|#dfd5c6/i, name);
  }
});

test("the dashboard reads no data mode from the address and offers no preview data", async () => {
  // ?data=mock and a "Preview" option served invented topics as though they were the reader's library.
  const html = await dashboard(ANALYSED, { search: "data=mock&mode=mock" });
  assert.doesNotMatch(html, /<option value="mock"/);
  assert.doesNotMatch(text(html), /Preview data|Live data/);
  const requests = globalThis.__siteuiDashboardRequests ?? [];
  assert.ok(requests.length > 0);
  for (const options of requests) assert.equal(options.mode, "auto");
});

test("the repositories page shows its chrome and blocked-out cards while it loads", async () => {
  // /workspaces, where login lands, was a bare coloured <main> for the whole round trip.
  const { default: ProjectIndexClient } = await import("../src/components/workspace/workspaces/ProjectIndexClient");
  for (const [auth, workspace] of [
    [{ ...SIGNED_IN, hydrated: false }, {}],
    [SIGNED_IN, { workspaceLoading: true }],
  ] as const) {
    globalThis.__auditfixAuth = auth;
    globalThis.__auditfixWorkspace = workspace;
    const html = renderToStaticMarkup(createElement(ProjectIndexClient));
    assert.match(html, /<a\b[^>]*aria-label="Papertrend front page"/, "the real header is there");
    const busy = /<section\b[^>]*aria-busy="true"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1];
    assert.ok(busy, "the loading region says it is busy");
    assert.match(text(busy), /Loading your repositories/);
    assert.equal((busy.match(/class="skeleton /g) ?? []).length, 3, "the cards are blocked out so the page does not jump");
  }
});

/* ------------------------------------------------------- muted text legibility */

test("muted text is never light-mode slate-400 on the docs, workspace, dashboard, Library or sign-in pages", async () => {
  // slate-400 on white measures 2.56:1; dark:text-slate-400 (7.8:1 on black) is fine.
  const { default: DocsOnThisPage } = await import("../src/components/docs/DocsOnThisPage");
  const pages: Array<[string, string]> = [
    ...(await docsPagesDrawn()).map((html, index) => [`docs ${index}`, html] as [string, string]),
    ["docs contents", draw(DocsOnThisPage, { sections: [{ id: "a", title: "A" }, { id: "b", title: "B" }] })],
    ["shell", await shellAt("/workspace/dashboard")],
    ["shell without a repository", await shellAt("/workspace/home", { currentProject: null, hasActiveProject: false })],
    ["dashboard", await dashboard(ANALYSED)],
    ["library", await library()],
    ["library repository", await library(`repo=${OTHER_PROJECT.id}`)],
    ["sign-in", await signInPage()],
  ];
  for (const [name, html] of pages) {
    assert.deepEqual(classNames(html).filter((cls) => cls === "text-slate-400"), [], name);
  }
});

test("the faintest dark-mode greys appear nowhere on the docs, the workspace shell or the error page", async () => {
  // #666666 (3.55:1) and #6f6f6f (4.06:1) on the #050505 panel.
  const { default: AppError } = await import("../src/app/error");
  const pages = [
    ...(await docsPagesDrawn()),
    await shellAt("/workspace/home"),
    renderToStaticMarkup(createElement(AppError, { error: Object.assign(new Error("failed"), { digest: "abc123" }), reset: () => undefined })),
  ];
  for (const html of pages) {
    assert.deepEqual(classNames(html).filter((cls) => /(?:^|:)text-\[#(?:666666|6f6f6f)\]$/i.test(cls)), []);
  }
});

/* --------------------------------------------------------- custom categories */

test("a repository with its own categories counts all of them until the reader chooses", async () => {
  // The saved selection starts as the legacy EL/ELI/LAE/Other slots; in a custom
  // taxonomy only "Other" matched, so Category Analysis showed nothing.
  const assignments = [
    ["1", "phonology", "Phonology"],
    ["4", "pragmatics", "Pragmatics"],
    ["6", "syntax", "Syntax"],
  ].map(([paper, key, label]) => ({ paper_id: paper, year: "2020", title: `Paper ${paper}`, category_key: key, category_label: label, assignment_type: "single" }));
  const chip = (html: string) => /(\d+) research areas?</.exec(html)?.[1];
  const custom = { ...ANALYSED, categoryAssignments: assignments, classificationEnabled: true };
  assert.equal(chip(await dashboard(custom)), "4", "Phonology, Pragmatics, Syntax and Other, untouched");
  assert.equal(chip(await dashboard(custom, { workspace: { selectedTracks: ["pragmatics"] } })), "1", "once the reader chooses, their choice");
  assert.equal(chip(await dashboard(custom, { workspace: { selectedTracks: ["EL"] } })), "4", "a choice of no category of this repository is no choice");
});

/* ------------------------------------------------------------- sign-in, docs */

test("the login page's two recovery buttons are padded to a taller target", async () => {
  // Measured 136x16 and 84x16 on the controls a person reaches for when they cannot get in.
  const html = await signInPage();
  for (const label of ["Reset password", "Create password account"]) {
    const [button] = elementsLabelled(html, "button", label);
    assert.ok(button, label);
    const classes = classesOf(button.open);
    assert.ok(classes.includes("py-2"), `${label}: vertical padding makes the target`);
    assert.ok(classes.includes("-my-2"), `${label}: a negative margin keeps the row height`);
  }
});

test("documentation contents links are padded, and the list's gap shrinks to match", async () => {
  const { default: DocsOnThisPage } = await import("../src/components/docs/DocsOnThisPage");
  const html = draw(DocsOnThisPage, { sections: [{ id: "a", title: "First" }, { id: "b", title: "Second" }, { id: "c", title: "Third" }] });
  const nav = /<nav\b[^>]*aria-label="On this page"[^>]*>/.exec(html)?.[0] ?? "";
  assert.ok(classesOf(nav).includes("space-y-1"));
  const links = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => classesOf(match[0]));
  assert.equal(links.length, 3);
  for (const link of links) for (const name of ["block", "py-1", "text-sm", "leading-5"]) assert.ok(link.includes(name), name);
});

test("the Google and Facebook marks are drawn as filled logos in their own colours", async () => {
  // The stroke-based icon base drew the Google mark as four stroke fragments.
  const { GoogleIcon, FacebookIcon } = await import("../src/components/ui/Icons");
  const google = draw(GoogleIcon, { className: "h-4 w-4" });
  const facebook = draw(FacebookIcon, { className: "h-4 w-4" });
  const fills = (html: string) => [...html.matchAll(/<path\b[^>]*fill="([^"]+)"/g)].map((match) => match[1].toUpperCase());
  assert.deepEqual(fills(google).sort(), ["#34A853", "#4285F4", "#EA4335", "#FBBC05"]);
  assert.deepEqual(fills(facebook), ["#1877F2"]);
  for (const html of [google, facebook]) {
    assert.doesNotMatch(html, /stroke="currentColor"|fill="none"/, "not drawn through the stroke base");
  }
});

test("each documentation tag links to a search for it", async () => {
  // They were spans styled like filter chips: they invited a click and did nothing.
  const { DocsArticle } = await import("../src/components/docs/DocsFrame");
  const { docsPages } = await import("../src/lib/docs-content");
  const tagged = docsPages.filter((page) => page.tags.length > 0);
  assert.ok(tagged.length > 0);
  for (const page of tagged) {
    const html = renderToStaticMarkup(createElement(DocsArticle, { page }));
    for (const tag of page.tags.slice(0, 5)) {
      const href = `/docs/search?q=${encodeURIComponent(tag)}`.replace(/&/g, "&amp;");
      assert.ok(html.includes(`href="${href}"`), `${page.slug}: ${tag}`);
    }
  }
});

test("documentation search draws without the search-params hook", async () => {
  // The route is statically rendered; the hook would force a Suspense boundary.
  globalThis.__siteuiSearchParamsReads = 0;
  const { default: DocsSearchClient } = await import("../src/components/docs/DocsSearchClient");
  const html = renderToStaticMarkup(createElement(DocsSearchClient));
  assert.match(html, /<input\b/);
  assert.equal(globalThis.__siteuiSearchParamsReads, 0);
  await settingsAt("profile");
  assert.ok((globalThis.__siteuiSearchParamsReads ?? 0) > 0, "the count does see a page that reads the hook");
});
