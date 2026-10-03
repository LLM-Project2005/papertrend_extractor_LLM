/*
 * A dashboard drilldown lists exactly the papers counted in what was clicked
 * (docs/32, 2.8), run: every chart's marks are pressed as Recharts presses
 * them, and the dashboard opens a list from what a chart hands it. The tabs
 * and the dashboard run through stub-uia11y-hooks.ts, with the stub-auditfix-*
 * sign-in, workspace, theme, router and dashboard data.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { isValidElement, type ReactNode } from "react";
import type { TrackRow, TrendRow } from "../src/types/database";
import { stubModule } from "./support/route-harness";
import { installDom } from "./support/stub-uia11y-dom";
import { elements, mount, textOf } from "./support/stub-uia11y-hooks";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/hooks/useData.ts", support("stub-auditfix-dashboard-data.ts"));
(globalThis as { React?: typeof React }).React = React;

const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const row = (paper: string, year: string, topic: string, keyword: string): TrendRow =>
  ({ paper_id: paper, year, title: `Paper ${paper}`, topic, keyword, keyword_frequency: 1, evidence: "" }) as TrendRow;
// A paper spelling a keyword two ways, a theme across years, papers in two tracks.
const TRENDS = [
  row("1", "2020", "Feedback", "Peer feedback"),
  row("1", "2020", "Feedback", "peer  feedback"),
  row("2", "2021", "Feedback", "Peer feedback"),
  row("3", "2021", "Writing", "accuracy"),
  row("3", "2021", "Feedback", "teacher feedback"),
  row("4", "2022", "Writing", "accuracy"),
];
const TRACKS = ["1", "2", "3", "4"].map((paper, index) => ({ paper_id: paper, year: TRENDS.find((entry) => entry.paper_id === paper)!.year, title: `Paper ${paper}`, el: index % 2, eli: 1 - (index % 2), lae: 0, other: 0 }) as TrackRow);
// Ten papers before, fifteen after, five of them in a theme gaining ground: a shift to chart.
const SHIFTING = [
  ...Array.from({ length: 10 }, (_, index) => row(String(10 + index), "2015", "Filler", "filler")),
  ...Array.from({ length: 15 }, (_, index) => row(String(20 + index), "2024", "Filler", "filler")),
  ...Array.from({ length: 5 }, (_, index) => row(String(20 + index), "2024", "Rising", "rising")),
];

type Target = { paperIds?: unknown; [key: string]: unknown };

/**
 * Presses every mark and control in a tab, as a reader would: a button is
 * clicked, and a chart mark is clicked once for each row of its chart, with
 * the row as Recharts hands it (its fields, and the row as `payload`).
 */
function pressEverything(node: ReactNode, chartRows: Array<Record<string, unknown>> | null, press: (kind: string, run: () => void) => void) {
  if (Array.isArray(node)) {
    for (const child of node) pressEverything(child as ReactNode, chartRows, press);
    return;
  }
  if (!isValidElement(node)) return;
  const props = node.props as Record<string, unknown> & { children?: ReactNode };
  const kind = typeof node.type === "string" ? node.type : ((node.type as { displayName?: string; name?: string }).displayName ?? (node.type as { name?: string }).name ?? "?");
  // A mark's own data, else its chart's (Recharts gives a mark an empty one by default).
  const rows = Array.isArray(props.data) && props.data.length > 0 ? (props.data as Array<Record<string, unknown>>) : chartRows;
  if (typeof props.onClick === "function") {
    const onClick = props.onClick as (...args: unknown[]) => void;
    if (typeof node.type === "string") press(kind, () => onClick({ preventDefault() {}, stopPropagation() {} }));
    else {
      // A mark of no size is not drawn, so it cannot be pressed.
      for (const [index, entry] of (rows ?? []).entries()) {
        if (typeof props.dataKey === "string" && !(Number(entry[props.dataKey]) > 0)) continue;
        press(kind, () => onClick({ ...entry, payload: entry }, index));
      }
    }
  }
  // A list of chart values hands each value its own press.
  if (Array.isArray(props.values)) {
    for (const value of props.values as Array<{ onSelect?: () => void }>) if (typeof value?.onSelect === "function") press(`${kind} value`, value.onSelect);
  }
  // A treemap draws each cell with the element it is given as `content`.
  if (isValidElement(props.content) && rows) {
    const cell = props.content as React.ReactElement<Record<string, unknown>>;
    for (const entry of rows) {
      const drawn = mount(cell.type as (props: unknown) => ReactNode, { ...cell.props, ...entry, x: 0, y: 0, width: 120, height: 60, depth: 1 });
      pressEverything(drawn.tree, null, press);
    }
  }
  pressEverything(props.children, rows, press);
}

test("every chart hands over the papers behind the mark", async () => {
  const dom = installDom();
  try {
    const shapes = new Set<string>();
    for (const name of ["Overview", "TrendAnalysis", "TrackAnalysis", "KeywordExplorer"]) {
      const Tab = (await import(`../src/components/tabs/${name}.tsx`)).default as (props: unknown) => ReactNode;
      const handed: Target[] = [];
      const trends = name === "TrendAnalysis" ? [...TRENDS, ...SHIFTING] : TRENDS;
      const ALL = new Set(trends.map((entry) => entry.paper_id));
      const tab = mount(Tab, { trends, tracksSingle: TRACKS, tracksMulti: TRACKS, selectedTracks: ["EL", "ELI", "LAE", "Other"], onDrilldown: (target: Target) => void handed.push(target) });
      pressEverything(tab.tree, null, (kind, run) => {
        const before = handed.length;
        run();
        for (const target of handed.slice(before)) {
          shapes.add(`${name} ${kind} ${Object.keys(target).filter((key) => key !== "paperIds").sort().join("+")}`);
          const ids = target.paperIds as string[] | undefined;
          assert.ok(Array.isArray(ids), `${name} ${kind} ${JSON.stringify(target)} carries no papers`);
          // Only a track no paper is in (its row still listed, at 0) hands an empty list.
          const emptyTrack = typeof target.track === "string" && TRACKS.every((track) => !Number(track[String(target.track).toLowerCase() as keyof TrackRow]));
          assert.ok(ids.length > 0 || emptyTrack, `${name} ${kind} ${JSON.stringify(target)} carries no papers`);
          assert.ok(ids.every((id) => ALL.has(String(id))), `${name} ${kind}: ${ids.join(",")}`);
        }
      });
      tab.unmount();
    }
    assert.ok(shapes.size >= 19, `found ${shapes.size} kinds of drilldown:\n${[...shapes].join("\n")}`);
  } finally {
    dom.restore();
  }
});

test("a theme's bar hands over exactly its papers, a keyword's chip every spelling's papers", async () => {
  const dom = installDom();
  try {
    const handed: Target[] = [];
    const { default: Overview } = await import("../src/components/tabs/Overview");
    const overview = mount(Overview as (props: unknown) => ReactNode, { trends: TRENDS, tracksSingle: TRACKS, tracksMulti: TRACKS, selectedTracks: ["EL", "ELI"], onDrilldown: (target: Target) => void handed.push(target) });
    pressEverything(overview.tree, null, (_kind, run) => run());
    const feedback = handed.filter((target) => target.topic === "Feedback").map((target) => [...(target.paperIds as string[])].sort());
    assert.ok(feedback.length > 0, JSON.stringify(handed));
    for (const ids of feedback) assert.deepEqual(ids, ["1", "2", "3"]);
    const in2021 = handed.filter((target) => target.year === "2021").map((target) => [...(target.paperIds as string[])].sort());
    assert.ok(in2021.length > 0);
    for (const ids of in2021) assert.deepEqual(ids, ["2", "3"]);

    handed.length = 0;
    const { default: KeywordExplorer } = await import("../src/components/tabs/KeywordExplorer");
    const keywords = mount(KeywordExplorer as (props: unknown) => ReactNode, { trends: TRENDS, onDrilldown: (target: Target) => void handed.push(target) });
    pressEverything(keywords.tree, null, (_kind, run) => run());
    const peer = handed.filter((target) => /^peer\s+feedback$/i.test(String(target.keyword ?? "")));
    assert.ok(peer.length > 0, JSON.stringify(handed));
    for (const target of peer) assert.deepEqual([...(target.paperIds as string[])].sort(), ["1", "2"]);
  } finally {
    dom.restore();
  }
});

test("the dashboard lists exactly the papers a chart handed it, in view, with no rule of its own on top", async () => {
  const dom = installDom("https://papertrend.test/workspace/dashboard");
  globalThis.__auditfixAuth = { user: { id: "00000000-0000-4000-8000-00000000000a" }, session: { access_token: "token" } };
  globalThis.__auditfixWorkspace = {
    currentProject: { id: PROJECT, name: "Assessment studies" }, hasActiveProject: true, selectedProjectId: PROJECT, filtersLoadedFor: PROJECT, profile: {},
    selectedYears: [], selectedTracks: [], searchQuery: "", setSelectedYears: () => undefined, setSelectedTracks: () => undefined, setSearchQuery: () => undefined,
  };
  globalThis.__auditfixDashboardData = { loading: false, data: { trends: TRENDS, tracksSingle: TRACKS, tracksMulti: [], categoryAssignments: [], useMock: false, diagnostics: {} } };
  try {
    const { default: DashboardClient } = await import("../src/components/DashboardClient");
    const page = mount(DashboardClient as (props: unknown) => ReactNode, {});
    const drill = (target: Target) => {
      const overview = elements(page.tree).find((found) => typeof found.props.onDrilldown === "function")!;
      (overview.props.onDrilldown as (target: Target) => void)(target);
      const listed = elements(page.tree).filter((found) => found.type === "article").map((found) => textOf(found.props.children as ReactNode));
      (elements(page.tree).find((found) => found.props["aria-label"] === "Close drilldown")!.props.onClick as () => void)();
      // Each paper's title, then its year.
      return listed.map((text) => /^(Paper \d+?)(?:19|20)\d\d/.exec(text)?.[1]).sort();
    };
    // The year, track, topic and keyword the mark also names do not narrow the chart's own list.
    assert.deepEqual(drill({ paperIds: ["2", "3"], year: "2020", track: "EL", topic: "Writing", keyword: "accuracy" }), ["Paper 2", "Paper 3"]);
    // A paper the chart counted but that is out of view is left out.
    assert.deepEqual(drill({ paperIds: ["4", "gone"], topic: "Writing" }), ["Paper 4"]);
    // Without ids, the list applies its own rules.
    assert.deepEqual(drill({ year: "2021" }), ["Paper 2", "Paper 3"]);
    page.unmount();
  } finally {
    dom.restore();
  }
});
