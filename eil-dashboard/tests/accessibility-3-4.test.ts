import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { categoricalColor, CATEGORICAL_PALETTE, ordinalColor, ORDINAL_RAMP } from "../src/lib/chart-palette";
import { buildCategoryOptions, categoryColor } from "../src/lib/category-options";
import type { CategoryAssignmentRow, IngestionRunRow, TrackRow, TrendRow } from "../src/types/database";
import { stubModule } from "./support/route-harness";
import { installDom, settle, type FakeWindow } from "./support/stub-uia11y-dom";
import { elements, mount, only, textOf, withProps, type FoundElement } from "./support/stub-uia11y-hooks";

/**
 * Accessibility fixes from the audit (docs/32, 3.4), drawn and pressed rather
 * than read. Contrast is in contrast-all.test.ts. The dashboard's tabs are
 * rendered with recharts at a fixed size and each chart's value list kept
 * (stub-uia11y-chart-values.ts); search, the Library and the chat run through
 * stub-uia11y-hooks.ts against the stand-in document of stub-uia11y-dom.ts.
 * Sign-in, the workspace, the theme and Next's router are the
 * tests/support/stub-auditfix-*.ts ones.
 */

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/recharts/lib/index.js", support("stub-auditfix-recharts.ts"));
stubModule("/node_modules/recharts/es6/index.js", support("stub-auditfix-recharts.ts"));
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
stubModule("/src/lib/use-narrow.ts", support("stub-profiledash-narrow.ts"));
stubModule("/src/components/tabs/ChartValues.tsx", support("stub-uia11y-chart-values.ts"));
(globalThis as { React?: typeof React }).React = React;

const PROJECT = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment studies" };
const SIGNED_IN = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "token" } };

function row(paper: string, year: string, topic: string, keyword: string): TrendRow {
  return { paper_id: paper, year, title: `Paper ${paper}`, topic, keyword, keyword_frequency: 1, evidence: "" } as TrendRow;
}

/** Twelve papers over six years in two themes, three of them also about rubrics. */
const TRENDS: TrendRow[] = Array.from({ length: 12 }, (_, index) => {
  const id = String(index + 1);
  const year = String(index < 6 ? 2016 + Math.floor(index / 2) : 2021 + Math.floor((index - 6) / 2));
  return index < 6 ? row(id, year, "Reading", "reading fluency") : row(id, year, "Writing", "peer feedback");
}).flatMap((entry) => (["3", "8", "11"].includes(entry.paper_id) ? [entry, row(entry.paper_id, entry.year, "Assessment", "rubrics")] : [entry]));

const PAPERS = [...new Set(TRENDS.map((entry) => entry.paper_id))];
const yearOf = (id: string) => TRENDS.find((entry) => entry.paper_id === id)!.year;
const ASSIGNMENTS: CategoryAssignmentRow[] = PAPERS.map((id) => ({
  paper_id: id,
  year: yearOf(id),
  title: `Paper ${id}`,
  category_key: Number(id) % 3 === 0 ? "lae" : "eli",
  category_label: Number(id) % 3 === 0 ? "Assessment" : "Instruction",
  assignment_type: "single",
}));
const TRACKS: TrackRow[] = PAPERS.map((id) => ({ paper_id: id, year: yearOf(id), title: `Paper ${id}`, el: 0, eli: Number(id) % 3 === 0 ? 0 : 1, lae: Number(id) % 3 === 0 ? 1 : 0, other: 0 }) as TrackRow);

type Target = { track?: string; year?: string; topic?: string; keyword?: string; paperIds?: string[] };

async function tabs() {
  const common = { trends: TRENDS, tracksSingle: TRACKS, tracksMulti: TRACKS, selectedTracks: [] as string[] };
  const categoryOptions = buildCategoryOptions({ categoryAssignments: ASSIGNMENTS });
  return {
    TrendAnalysis: [(await import("../src/components/tabs/TrendAnalysis")).default, { trends: TRENDS }],
    TrackAnalysis: [(await import("../src/components/tabs/TrackAnalysis")).default, { ...common, categoryAssignments: ASSIGNMENTS, categoryOptions }],
    KeywordExplorer: [(await import("../src/components/tabs/KeywordExplorer")).default, { trends: TRENDS }],
  } as unknown as Record<string, [ComponentType<Record<string, unknown>>, Record<string, unknown>]>;
}

/** The tab as drawn, and the value lists its charts were given. */
function drawTab(component: ComponentType<Record<string, unknown>>, props: Record<string, unknown>) {
  globalThis.__auditfixTheme = "light";
  globalThis.__uia11yChartValues = [];
  const html = renderToStaticMarkup(createElement(component, props));
  return { html, lists: globalThis.__uia11yChartValues };
}

test("every chart that opens papers on a click has a keyboard path to the same papers", async () => {
  // Each chart's bars or slices are mouse-only; beside each sits a list of its
  // values, each a button opening what its bar opens (DASH-3, A11Y-4).
  const expected: Record<string, number> = { TrendAnalysis: 3, TrackAnalysis: 3, KeywordExplorer: 1 };
  for (const [name, [component, props]] of Object.entries(await tabs())) {
    const opened: Target[] = [];
    const { html, lists } = drawTab(component, { ...props, onDrilldown: (target: Target) => opened.push(target) });
    assert.equal(lists.length, expected[name], `${name}: one list per chart`);
    assert.equal((html.match(/Show the values/g) ?? []).length, lists.length, `${name}: each list drawn`);
    for (const list of lists) {
      assert.ok(list.values.length > 0, `${name} / ${list.title}`);
      for (const value of list.values) {
        const where = `${name} / ${list.title} / ${value.group ?? ""} ${value.label}`;
        assert.equal(typeof value.onSelect, "function", `${where}: a button`);
        opened.length = 0;
        value.onSelect!();
        assert.equal(opened.length, 1, where);
        const target = opened[0];
        const papers = target.paperIds ?? [];
        assert.ok(papers.length > 0 && papers.every((id) => PAPERS.includes(id)), `${where}: opens papers of this repository`);
        const count = /^(\d+) papers?$/.exec(value.detail)?.[1];
        if (count) assert.equal(papers.length, Number(count), `${where}: the papers its number counts`);
        if (value.group) assert.equal(target.year, value.group, `${where}: in its year`);
        const named = [target.topic, target.keyword, target.year, target.track && ASSIGNMENTS.find((entry) => entry.category_key === target.track)?.category_label];
        assert.ok(named.includes(value.label), `${where}: opens what it names, not ${JSON.stringify(target)}`);
      }
    }
    const plain = drawTab(component, props);
    assert.ok(plain.lists.every((list) => list.values.every((value) => value.onSelect === undefined)), `${name}: nothing to open without a drilldown`);
  }
});

test("a chart's values are a collapsed list of buttons, with its CSV beside it", async () => {
  // Rendered: a collapsed list whose values are buttons, and the CSV beside it (4.3).
  const { default: ChartValues } = await import("../src/components/tabs/ChartValues");
  const html = renderToStaticMarkup(
    createElement(ChartValues, {
      title: "Papers per year",
      values: [{ key: "2019", label: "2019", detail: "7 papers", onSelect: () => undefined }],
      csv: { name: "Papers per year", header: ["Year", "Papers"], rows: [["2019", 7]] },
    })
  );
  assert.match(html, /<details class="group min-w-0 flex-1"><summary[^>]*>.*Show the values/);
  assert.match(html, /<button type="button"[^>]*><span class="min-w-0 truncate">2019<\/span><span[^>]*>7 papers<\/span><\/button>/);
  assert.match(html, /Download CSV<span class="sr-only">: Papers per year<\/span>/);
});

test("the PDF's page counter is not read out on every scroll", async () => {
  const { default: PdfViewer } = await import("../src/components/workspace/PdfViewer");
  const html = renderToStaticMarkup(createElement(PdfViewer, { cacheKey: "run-1", url: null, title: "Paper 1" }));
  const counter = /<p class="([^"]*)"[^>]*>Loading the PDF…<\/p>/.exec(html);
  assert.ok(counter, "the counter in the toolbar");
  assert.doesNotMatch(counter[0], /aria-live|role="status"/);
  assert.doesNotMatch(html, /aria-live/, "nothing on the reader announces itself");
});

// The text layer is laid by pdf.js over a drawn page once a PDF has loaded,
// which needs a canvas and the worker; and its transparency is a rule in
// globals.css. Both are read here.
test("the PDF's text can be selected and searched", () => {
  const viewer = readFileSync(new URL("../src/components/workspace/PdfViewer.tsx", import.meta.url), "utf8");
  assert.match(viewer, /new pdfjs\.TextLayer\(\{\s*textContentSource: page\.streamTextContent\(\),\s*container,/);
  assert.match(viewer, /<div ref=\{textLayerRef\} className="textLayer" \/>/);
  assert.match(viewer, /\["--scale-factor" as string\]: scale/);
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.textLayer :is\(span, br\) \{\s*color: transparent;/);
});

/** Runs `body` with the stand-in document in place, and takes it away after. */
async function withDom(body: (window: FakeWindow) => Promise<void>) {
  const dom = installDom();
  try {
    await body(dom.window);
  } finally {
    dom.restore();
  }
}

const click = (found: FoundElement | undefined, event: unknown = undefined) => (found?.props.onClick as (event: unknown) => void)(event);
const key = (name: string) => ({ key: name, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });

test("search is a combobox the arrow keys move through (SHELL-8)", async () => {
  await withDom(async () => {
    globalThis.__auditfixAuth = SIGNED_IN;
    globalThis.__auditfixWorkspace = { allProjects: [] };
    globalThis.__auditfixNavigations = [];
    const { default: WorkspaceGlobalSearch } = await import("../src/components/workspace/WorkspaceGlobalSearch");
    const Icon = () => null;
    const pageItems = ["Home", "Library", "Dashboard"].map((label) => ({ id: label.toLowerCase(), label, description: `The ${label}`, href: `/workspace/${label.toLowerCase()}`, icon: Icon, featured: true }));
    const search = mount(WorkspaceGlobalSearch, { pageItems });
    click(only(search.tree, { "aria-label": "Search repository" }));

    const input = () => only(search.tree, { role: "combobox" });
    const listbox = only(search.tree, { role: "listbox" });
    const options = () => withProps(search.tree, { role: "option" });
    assert.equal(input().props["aria-controls"], listbox.props.id);
    assert.equal(input().props["aria-expanded"], true);
    const shown = options().map((option) => textOf(option.props.children as ReactNode));
    assert.ok(shown.length >= 4, shown.join(" | "));
    const active = () => options().findIndex((option) => option.props["aria-selected"] === true);
    assert.equal(active(), 0);
    assert.equal(input().props["aria-activedescendant"], options()[0].props.id);

    const arrowDown = key("ArrowDown");
    (input().props.onKeyDown as (event: unknown) => void)(arrowDown);
    assert.equal(arrowDown.defaultPrevented, true, "the caret stays put");
    assert.equal(active(), 1);
    assert.equal(input().props["aria-activedescendant"], options()[1].props.id);
    assert.equal(options().filter((option) => option.props["aria-selected"] === true).length, 1, "one option chosen at a time");
    (input().props.onKeyDown as (event: unknown) => void)(key("End"));
    assert.equal(active(), shown.length - 1);
    (input().props.onKeyDown as (event: unknown) => void)(key("ArrowDown"));
    assert.equal(active(), 0, "past the last comes the first");
    (input().props.onKeyDown as (event: unknown) => void)(key("ArrowUp"));
    (input().props.onKeyDown as (event: unknown) => void)(key("ArrowUp"));
    const chosen = shown[active()];

    // Enter submits the form, which opens the option the arrows reached.
    const form = elements(search.tree).find((found) => found.type === "form")!;
    (form.props.onSubmit as (event: unknown) => void)(key("Enter"));
    const page = pageItems.find((item) => chosen.startsWith(item.label));
    assert.ok(page, chosen);
    assert.deepEqual(globalThis.__auditfixNavigations, [page.href]);
    search.unmount();
  });
});

const run = (id: string, title: string, favorite: boolean): IngestionRunRow =>
  ({
    id,
    source_type: "upload",
    status: "succeeded",
    source_filename: `${id}.pdf`,
    display_name: title,
    is_favorite: favorite,
    input_payload: { project_id: PROJECT.id },
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-02T00:00:00Z",
  }) as unknown as IngestionRunRow;

/** A press on a button, as the Library's menus read it: where the button is. */
const pressAt = () => ({ currentTarget: { getBoundingClientRect: () => ({ top: 100, bottom: 136, left: 200, right: 300, width: 100, height: 36 }) } });

test("the Library says which menus are open and which choices are on (LIB-11, A11Y-7)", async () => {
  await withDom(async (window) => {
    globalThis.__auditfixAuth = SIGNED_IN;
    globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: [PROJECT] };
    globalThis.__auditfixSearch = `repo=${PROJECT.id}`;
    window.respond = (url) =>
      url.startsWith("/api/workspace/library?includeTrashed=false")
        ? { body: { runs: [run("run-a", "Alpha study", true), run("run-b", "Beta study", false)] } }
        : { status: 404, body: {} };
    const { default: Library } = await import("../src/components/admin/AdminImportClient");
    const library = mount(Library, {});
    await settle();
    const labelled = (label: string) => only(library.tree, { "aria-label": label });

    // The sort menu and each filter menu say whether they are open.
    const sort = () => elements(library.tree).find((found) => String(found.props["aria-label"] ?? "").startsWith("Sort: "))!;
    assert.equal(sort().props["aria-expanded"], false);
    click(sort(), pressAt());
    assert.equal(sort().props["aria-expanded"], true);
    click(sort(), pressAt());
    const filter = (label: string) => elements(library.tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode) === label)!;
    for (const label of ["Type", "Modified"]) {
      assert.equal(filter(label).props["aria-expanded"], false, label);
      click(filter(label), pressAt());
      assert.equal(filter(label).props["aria-expanded"], true, label);
      const others = ["Type", "Modified"].filter((other) => other !== label).map((other) => filter(other).props["aria-expanded"]);
      assert.deepEqual([...others, sort().props["aria-expanded"]], [false, false], `${label}: only the menu pressed is open`);
      click(filter(label), pressAt());
      assert.equal(filter(label).props["aria-expanded"], false, `${label}: pressed again, it closes`);
    }

    // The layout buttons say which is chosen.
    assert.equal(labelled("List layout").props["aria-pressed"], true);
    assert.equal(labelled("Grid layout").props["aria-pressed"], false);

    // Column headers say how the list is sorted by them.
    assert.ok(labelled("Name, sorted ascending"));
    assert.ok(labelled("Date modified, sort by this column"));
    click(labelled("Name, sorted ascending"));
    assert.ok(labelled("Name, sorted descending"));
    click(labelled("File size, sort by this column"));
    assert.ok(withProps(library.tree, { "aria-label": "File size, sort by this column" }).length === 0);
    assert.ok(labelled("Name, sort by this column"));

    // In both layouts, a favourite says it is one and each file's menu says when it is open.
    for (const layout of ["List layout", "Grid layout"]) {
      click(labelled(layout));
      assert.equal(labelled(layout).props["aria-pressed"], true, layout);
      assert.equal(labelled("Remove Alpha study from favorites").props["aria-pressed"], true, layout);
      assert.equal(labelled("Add Beta study to favorites").props["aria-pressed"], false, layout);
      const actions = () => labelled("Open actions for Beta study");
      assert.equal(actions().props["aria-expanded"], false, layout);
      click(actions(), pressAt());
      assert.equal(actions().props["aria-expanded"], true, layout);
      assert.equal(labelled("Open actions for Alpha study").props["aria-expanded"], false, layout);
      click(only(library.tree, { className: "fixed inset-0 z-40" }));
      assert.equal(actions().props["aria-expanded"], false, `${layout}: a press beside the menu closes it`);
    }
    library.unmount();
  });
});

test("the chat's tools say whether they are on (CHAT-10)", async () => {
  await withDom(async () => {
    globalThis.__auditfixAuth = SIGNED_IN;
    globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: [PROJECT], selectedYears: [], selectedTracks: [], searchQuery: "" };
    globalThis.__auditfixPathname = "/workspace/chat";
    const { default: ChatClient } = await import("../src/components/chat/ChatClient");
    const chat = mount(ChatClient, {});
    const openMenu = () => click(only(chat.tree, { "aria-label": "Open attachment and tool menu" }));
    const tool = (label: string) => elements(chat.tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode).startsWith(label))!;
    // Thinking effort is one slider beside the model, in every mode (2026-10-10), not a tool.
    const { default: ThinkingEffort } = await import("../src/components/chat/ThinkingEffort");
    const effort = () => elements(chat.tree).find((found) => found.type === ThinkingEffort)!;
    const choose = (level: string) => (effort().props.onChange as (level: string) => void)(level);
    assert.equal(effort().props.value, "medium");
    choose("max");
    assert.equal(effort().props.value, "max", "Max is chosen");
    assert.equal(effort().props.maxUnavailable, null);
    choose("medium");
    openMenu();
    assert.equal(tool("Deep research"), undefined);
    for (const label of ["Chart mode", "Web search"]) assert.equal(tool(label).props["aria-pressed"], false, label);
    click(tool("Web search"));
    openMenu();
    assert.equal(tool("Web search").props["aria-pressed"], true);
    assert.equal(tool("Chart mode").props["aria-pressed"], false);
    click(tool("Chart mode"));
    openMenu();
    assert.deepEqual(["Chart mode", "Web search"].map((label) => tool(label).props["aria-pressed"]), [true, true]);
    // Chart mode keeps the slider, up to High: a chart is counted, not researched.
    assert.ok(effort(), "Chart mode keeps the thinking effort");
    assert.match(String(effort().props.maxUnavailable), /Chart mode goes up to High/);
    chat.unmount();
  });
});

test("the thinking effort is a slider from Low to Max, read out by name", async () => {
  await withDom(async () => {
    const { default: ThinkingEffort } = await import("../src/components/chat/ThinkingEffort");
    const chosen: string[] = [];
    const slider = mount(ThinkingEffort, { value: "medium", onChange: (level: string) => void chosen.push(level) });
    const trigger = () => only(slider.tree, { "aria-haspopup": "dialog" });
    assert.equal(trigger().props["aria-label"], "Thinking effort: Medium");
    assert.equal(trigger().props["aria-expanded"], false);
    click(trigger());
    assert.equal(trigger().props["aria-expanded"], true, "it opens");
    const range = () => elements(slider.tree).find((found) => found.type === "input" && found.props.type === "range")!;
    assert.equal(range().props["aria-valuetext"], "Medium", "a screen reader hears the level, not a number");
    assert.deepEqual([range().props.min, range().props.max, range().props.step], [0, 3, 1]);
    (range().props.onChange as (event: unknown) => void)({ target: { value: "3" } });
    assert.deepEqual(chosen, ["max"]);
    slider.unmount();

    // In Chart mode the top stop is held back, and the slider says why.
    const capped: string[] = [];
    const chart = mount(ThinkingEffort, { value: "high", onChange: (level: string) => void capped.push(level), maxUnavailable: "Chart mode goes up to High." });
    click(only(chart.tree, { "aria-haspopup": "dialog" }));
    (elements(chart.tree).find((found) => found.type === "input" && found.props.type === "range")!.props.onChange as (event: unknown) => void)({ target: { value: "3" } });
    assert.deepEqual(capped, ["high"]);
    assert.ok(elements(chart.tree).some((found) => textOf(found.props.children as ReactNode) === "Chart mode goes up to High."));
    chart.unmount();
  });
});

test("chart colours go by position, never by a hash, and years by order (A11Y-5)", async () => {
  assert.equal(CATEGORICAL_PALETTE.length, 8);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(categoricalColor), [...CATEGORICAL_PALETTE]);
  // Five custom categories: five different colours, whatever their names.
  const colours = ["alpha", "beta", "gamma", "delta", "epsilon"].map((name, index) => categoryColor(name, index));
  assert.equal(new Set(colours).size, 5);
  const options = buildCategoryOptions({
    categoryAssignments: ["alpha", "beta", "gamma", "delta", "epsilon"].map((name, index) => ({ paper_id: String(index), year: "2020", title: "t", category_key: name, category_label: name, assignment_type: "single" })),
  });
  assert.equal(new Set(options.map((option) => option.color)).size, options.length, "a repository's own categories never share a colour");
  // The same name takes whatever colour its position gives it: nothing in the name decides.
  assert.deepEqual([0, 1, 2, 3].map((index) => categoryColor("anything", index)), CATEGORICAL_PALETTE.slice(0, 4));
  assert.equal(ordinalColor(0, 10), ORDINAL_RAMP[0]);
  assert.equal(ordinalColor(9, 10), ORDINAL_RAMP[ORDINAL_RAMP.length - 1]);
  const { default: tailwind } = await import("../tailwind.config");
  const colors = (tailwind.theme?.extend?.colors ?? {}) as Record<string, unknown>;
  assert.equal("track" in colors, false, "the unused copy of the track colours is gone");
});

