/*
 * Every place that names a paper opens it in place, over the page the reader
 * is on, rather than sending them to the Library (docs/32): run rather than
 * read. The pages run through stub-uia11y-hooks.ts against the stand-in
 * document and fetch of stub-uia11y-dom.ts, with the workspace's paper window
 * a recorder; sign-in, the workspace, the theme, the dashboard data and Next's
 * router are the tests/support/stub-auditfix-*.ts ones.
 */
import assert from "node:assert/strict";
import test, { before } from "node:test";
import React, { type Context, type ReactNode } from "react";
import { parsePaperHref, type PaperTarget } from "../src/lib/paper-address";
import type { IngestionRunRow, TrendRow } from "../src/types/database";
import { stubModule } from "./support/route-harness";
import { installDom, settle } from "./support/stub-uia11y-dom";
import { elements, mount, only, textOf, type FoundElement } from "./support/stub-uia11y-hooks";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/recharts/lib/index.js", support("stub-auditfix-recharts.ts"));
stubModule("/node_modules/recharts/es6/index.js", support("stub-auditfix-recharts.ts"));
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
stubModule("/src/hooks/useData.ts", support("stub-auditfix-dashboard-data.ts"));
stubModule("/src/lib/use-narrow.ts", support("stub-profiledash-narrow.ts"));
stubModule("/node_modules/@xyflow/react/dist/style.css", support("stub-siteui-stylesheet.ts"));
(globalThis as { React?: typeof React }).React = React;

const SIGNED_IN = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "token" } };
const PROJECT = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment studies" };
const ALL_PROJECTS = [PROJECT];
const dom = installDom("https://papertrend.test/workspace/home");

let PaperLink: unknown;
let viewerContext: Context<unknown>;
const opened: PaperTarget[] = [];
const withViewer = () => new Map<Context<unknown>, unknown>([[viewerContext, { openPaper: (target: PaperTarget) => opened.push(target) }]]);

before(async () => {
  globalThis.__auditfixAuth = SIGNED_IN;
  PaperLink = (await import("../src/components/workspace/PaperLink")).default;
  // The context the workspace offers its paper window through, from the provider itself.
  const { PaperViewerProvider } = await import("../src/components/workspace/PaperViewerProvider");
  const provider = mount(PaperViewerProvider, { children: null as ReactNode });
  viewerContext = elements(provider.tree).find((found) => typeof (found.props.value as { openPaper?: unknown } | undefined)?.openPaper === "function")!.type as Context<unknown>;
  provider.unmount();
});

const click = (found: FoundElement | undefined, ...args: unknown[]) => (found?.props.onClick as (...values: unknown[]) => unknown)(...args);
const button = (tree: ReactNode, text: string) => elements(tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode).trim() === text);

/** The papers a tree links with PaperLink. */
const paperLinks = (tree: ReactNode) => elements(tree).filter((found) => found.type === PaperLink).map((found) => found.props.paper);

/** Anything else in a tree that points at a paper's Library address: a link that would leave the page. */
const linksAway = (tree: ReactNode) =>
  elements(tree).filter((found) => found.type !== PaperLink && typeof found.props.href === "string" && parsePaperHref(found.props.href as string));

/** What a component element draws, through the components that only pass a link along. */
function drawn(found: FoundElement): ReactNode {
  let node: FoundElement = found;
  while (typeof node.type === "function" && node.type !== PaperLink) {
    const tree = mount(node.type as (props: unknown) => ReactNode, node.props).tree;
    const next = elements(tree)[0];
    if (!next) return tree;
    node = next;
  }
  return React.createElement(node.type as string, node.props as Record<string, unknown>);
}

function trend(paper: string, year: string, topic: string, title = `Paper ${paper}`): TrendRow {
  return { paper_id: paper, year, title, topic, keyword: "fluency", keyword_frequency: 1, evidence: "" } as TrendRow;
}

test("a paper in the dashboard's drilldown opens over the list, which stays underneath", async () => {
  globalThis.__auditfixWorkspace = {
    currentProject: PROJECT,
    hasActiveProject: true,
    selectedProjectId: PROJECT.id,
    allProjects: ALL_PROJECTS,
    filtersLoadedFor: PROJECT.id,
    profile: {},
    selectedYears: [],
    selectedTracks: ["EL", "ELI", "LAE", "Other"],
    searchQuery: "",
  };
  globalThis.__auditfixDashboardData = {
    loading: false,
    data: { trends: [trend("1", "2020", "Reading"), trend("2", "2021", "Reading")], tracksSingle: [], tracksMulti: [], categoryAssignments: [], useMock: false, diagnostics: {} },
  };
  globalThis.__auditfixPathname = "/workspace/dashboard";
  globalThis.__auditfixNavigations = [];
  const { default: DashboardClient } = await import("../src/components/DashboardClient");
  const dashboard = mount(DashboardClient, {}, withViewer());
  const tab = elements(dashboard.tree).find((found) => typeof found.props.onDrilldown === "function");
  assert.ok(tab, "the open tab can drill down");
  (tab.props.onDrilldown as (target: unknown) => void)({ topic: "Reading", paperIds: ["1", "2"] });
  const openButtons = () => elements(dashboard.tree).filter((found) => found.type === "button" && textOf(found.props.children as ReactNode).trim() === "Open paper");
  assert.equal(openButtons().length, 2, "the drilldown lists its papers");
  opened.length = 0;
  for (const found of openButtons()) {
    click(found);
    assert.equal(openButtons().length, 2, "the list is still there underneath");
  }
  assert.deepEqual(opened.map((target) => JSON.stringify(target)).sort(), [{ paperId: "1" }, { paperId: "2" }].map((target) => JSON.stringify(target)), "each button opens its paper");
  assert.deepEqual((globalThis.__auditfixNavigations ?? []).filter((href) => !href.startsWith("/workspace/dashboard")), [], "the page stays the dashboard");
  dashboard.unmount();
});

test("the dashboard tabs link their papers in place", async () => {
  const trends = [
    trend("1", "2020", "Reading", "Extensive reading and second language fluency gains"),
    trend("2", "2021", "Reading", "Extensive reading and second language fluency gains revisited"),
    trend("3", "2021", "Writing", "Peer feedback in academic writing"),
  ];
  // The keyword explorer's concept search names the papers it found.
  dom.window.respond = (url) =>
    url === "/api/keyword-search"
      ? {
          body: {
            canonicalConcept: "fluency",
            matchedTerms: ["fluency"],
            firstAppearance: { paperId: 1, title: "Paper 1", year: "2020", tracksSingle: [], tracksMulti: [], section: "abstract", snippet: "fluency" },
            timeline: [],
            trackSpread: [],
            cooccurringConcepts: [],
            objectiveVerbs: [],
            contributionTypes: [],
            papers: [{ paperId: 3, title: "Paper 3", year: "2021", tracksSingle: [], tracksMulti: [], matchedTerms: ["fluency"], evidence: [] }],
            evidence: [],
            summary: "",
            notFound: false,
            suggestedConcepts: [],
          },
        }
      : { status: 404, body: {} };
  const { default: KeywordExplorer } = await import("../src/components/tabs/KeywordExplorer");
  // The dashboard hands it its filters, held from render to render.
  const explorer = mount(KeywordExplorer as never, { trends, selectedYears: [], selectedTracks: [], folderIds: [], projectId: PROJECT.id });
  (only(explorer.tree as ReactNode, { "aria-label": "Search a concept" }).props.onChange as (event: unknown) => void)({ target: { value: "fluency" } });
  dom.window.advance(1000);
  await settle();
  assert.deepEqual(paperLinks(explorer.tree as ReactNode), [{ paperId: "1" }, { paperId: "3" }]);
  assert.deepEqual(linksAway(explorer.tree as ReactNode), []);
  explorer.unmount();
  dom.window.respond = () => ({ status: 404, body: {} });
});

const run = (id: string, status: IngestionRunRow["status"], title: string): IngestionRunRow =>
  ({ id, source_type: "upload", status, source_filename: `${id}.pdf`, display_name: title, input_payload: { project_id: PROJECT.id }, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-02T00:00:00Z" }) as unknown as IngestionRunRow;

test("Home opens an analysed paper in place, and one still processing in the Library, which shows its progress", async () => {
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: ALL_PROJECTS };
  globalThis.__auditfixPathname = "/workspace/home";
  dom.window.respond = (url) =>
    url.startsWith("/api/workspace/library?includeTrashed=false")
      ? { body: { runs: [run("run-ready", "succeeded", "Ready paper"), run("run-busy", "processing", "Busy paper")] } }
      : { status: 404, body: {} };
  const { default: WorkspaceHomeClient } = await import("../src/components/workspace/WorkspaceHomeClient");
  const { AnalysisRunsContext } = await import("../src/components/workspace/AnalysisRunsContext");
  const idle = async () => [];
  const followed = { runs: [], folderJob: null, cancelRuns: idle, cancelAllActiveRuns: idle, retryActiveProcessing: idle, startQueuedProcessing: idle, refresh: idle };
  const home = mount(WorkspaceHomeClient, {}, new Map<Context<unknown>, unknown>([[AnalysisRunsContext as Context<unknown>, followed]]));
  await settle();
  const rows = elements(home.tree).filter((found) => (found.props.run as IngestionRunRow | undefined)?.id && typeof found.type === "function");
  const links = rows.map((row) => paperLinks(drawn(row))).flat();
  assert.deepEqual(links.sort(), [{ runId: "run-ready" }, "/workspace/library?runId=run-busy"].sort());
  assert.deepEqual(linksAway(home.tree), []);
  home.unmount();
  dom.window.respond = () => ({ status: 404, body: {} });
});

test("a chat citation opens its paper in place, and a web source leaves for the page", async () => {
  const { CitationMarker } = await import("../src/components/chat/AnswerBody");
  const marker = mount(CitationMarker, {
    numbers: [1],
    sources: [{ number: 1, paperId: "42", title: "Peer feedback", year: "2021", href: "/workspace/library?paperId=42" }],
  });
  assert.deepEqual(paperLinks(marker.tree), [], "a hover card names the paper without a link");
  click(only(marker.tree, { "aria-label": "Source: Peer feedback (2021)" }));
  const [evidence] = paperLinks(marker.tree);
  assert.deepEqual(parsePaperHref(evidence as string), { runId: null, paperId: "42", tab: "evidence" }, "pinned, it opens the paper's evidence in place");
  marker.unmount();

  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: ALL_PROJECTS, selectedYears: [], selectedTracks: [], searchQuery: "" };
  globalThis.__auditfixPathname = "/workspace/chat";
  dom.window.respond = (url) => {
    if (url.startsWith("/api/chat/threads?limit=")) return { body: { threads: [{ id: "thread-1", mode: "chat", title: "Peer feedback" }] } };
    if (url === "/api/chat/threads/thread-1") {
      return {
        body: {
          thread: { id: "thread-1", mode: "chat", title: "Peer feedback" },
          messages: [
            { id: "m1", thread_id: "thread-1", role: "user", message_kind: "chat", content: "Does peer feedback help?", created_at: "2026-09-01T00:00:00Z" },
            {
              id: "m2",
              thread_id: "thread-1",
              role: "assistant",
              message_kind: "chat",
              content: "It helps revision.",
              created_at: "2026-09-01T00:00:05Z",
              citations: [
                { paperId: 42, title: "Peer feedback in writing", year: "2021", href: "/workspace/library?paperId=42", reason: "" },
                { paperId: "web-1", title: "A teaching blog", year: "Web", href: "https://example.org/feedback", reason: "", sourceType: "web" },
              ],
            },
          ],
          hasEarlierMessages: false,
        },
      };
    }
    return { status: 404, body: {} };
  };
  const { default: ChatClient } = await import("../src/components/chat/ChatClient");
  const chat = mount(ChatClient, {});
  await settle();
  click(elements(chat.tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode).includes("Peer feedback") && !found.props["aria-label"]));
  await settle();
  const citations = elements(chat.tree).filter((found) => (found.props.citation as { href?: string } | undefined)?.href);
  assert.equal(citations.length, 2, "the answer lists its sources");
  const [paper, web] = citations.map(drawn);
  assert.deepEqual(paperLinks(paper), ["/workspace/library?paperId=42"]);
  assert.deepEqual(paperLinks(web), []);
  assert.equal(elements(web)[0]?.props.href, "https://example.org/feedback");
  assert.deepEqual(linksAway(chat.tree), []);
  chat.unmount();
  dom.window.respond = () => ({ status: 404, body: {} });
});

test("search opens an analysed paper in place, and one still processing in the Library", async () => {
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: ALL_PROJECTS };
  globalThis.__auditfixNavigations = [];
  dom.window.respond = (url) =>
    url.startsWith("/api/workspace/library?projectId=")
      ? { body: { runs: [run("run-ready", "succeeded", "Ready paper"), run("run-busy", "processing", "Busy paper")] } }
      : { status: 404, body: {} };
  const { default: WorkspaceGlobalSearch } = await import("../src/components/workspace/WorkspaceGlobalSearch");
  const search = mount(WorkspaceGlobalSearch, { pageItems: [] }, withViewer());
  click(only(search.tree, { "aria-label": "Search repository" }));
  await settle();
  const typeQuery = (value: string) => (only(search.tree, { role: "combobox" }).props.onChange as (event: unknown) => void)({ target: { value } });
  const option = (label: string) => elements(search.tree).find((found) => found.props.role === "option" && textOf(found.props.children as ReactNode).startsWith(label));

  opened.length = 0;
  typeQuery("Ready paper");
  click(option("Ready paper"));
  assert.deepEqual(opened, [{ runId: "run-ready" }]);
  assert.deepEqual(globalThis.__auditfixNavigations, []);
  click(only(search.tree, { "aria-label": "Search repository" }));
  typeQuery("Busy paper");
  click(option("Busy paper"));
  assert.equal(opened.length, 1);
  assert.deepEqual(globalThis.__auditfixNavigations, ["/workspace/library?runId=run-busy"]);
  search.unmount();
  dom.window.respond = () => ({ status: 404, body: {} });
});

test("the semantic map opens the chosen paper in place", async () => {
  const point = (paperId: string, runId: string) => ({
    paperId,
    runId,
    folderId: null,
    x: Number(paperId) * 100,
    y: 100,
    clusterId: 0,
    title: `Paper ${paperId}`,
    year: "2021",
    folderName: null,
    categories: [],
    topics: [],
    keywords: [],
    track: null,
  });
  dom.window.respond = (url) =>
    url.startsWith("/api/workspace/semantic-map?projectId=")
      ? {
          body: {
            map: {
              mapId: "map-1",
              projectId: PROJECT.id,
              status: "succeeded",
              stale: false,
              sourceHash: "h",
              progress: { stage: "done", current: 2, total: 2 },
              projection: { algorithm: "pca", version: "1", parameters: {} },
              quality: {},
              points: [point("1", "run-1"), point("2", "run-2")],
              edges: [],
              clusters: [{ id: 0, label: "Reading", paperCount: 2, terms: [], source: "deterministic" }],
              error: null,
              createdAt: "2026-09-01T00:00:00Z",
              completedAt: "2026-09-01T00:00:00Z",
            },
            eligiblePapers: 2,
          },
        }
      : { status: 404, body: {} };
  globalThis.__auditfixNavigations = [];
  const { default: SemanticMap } = await import("../src/components/workspace/RepositorySemanticMap");
  const map = mount(SemanticMap, { projectId: PROJECT.id, projectName: PROJECT.name, requestHeaders: { Authorization: "Bearer token" } }, withViewer());
  await settle();
  // The map opens as the free graph (2026-10-09 review); the fixed projection is the layout drawn with nodes.
  click(button(map.tree, "Fixed projection"));
  await settle();
  const flow = elements(map.tree).find((found) => typeof found.props.onNodeClick === "function");
  assert.ok(flow, "the map is drawn");
  (flow.props.onNodeClick as (event: unknown, node: unknown) => void)({}, { id: "2" });
  opened.length = 0;
  click(button(map.tree, "Open analysis"));
  assert.deepEqual(opened, [{ runId: "run-2" }]);
  assert.deepEqual(globalThis.__auditfixNavigations, []);
  map.unmount();
  dom.window.respond = () => ({ status: 404, body: {} });
});
