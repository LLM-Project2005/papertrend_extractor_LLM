/*
 * The site's visual and navigation fixes. What a page draws is rendered and
 * checked in tests/site-ui-behaviour.test.ts; what is left here is the chart
 * palette's own numbers, the published figures, the stylesheet, the
 * page-audit script's in-page code (run against a small page), and a few pins
 * on states a server render cannot reach, each saying why.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { chartTheme } from "../src/lib/chart-theme";
import { proofMetrics } from "../src/components/marketing/marketing-content";

function exists(relative: string): boolean {
  return existsSync(new URL(`../${relative}`, import.meta.url));
}

function read(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

/**
 * The same file with comments removed.
 *
 * Several fixes below are recorded in a comment that quotes the string being
 * removed - "it used to say LIVE REPOSITORY" - so a test searching the raw
 * source finds its own explanation and fails. What matters is what ships.
 */
function readCode(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** WCAG relative luminance of a #rrggbb string. */
function luminance(hex: string): number {
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * linear(channel(1)) + 0.7152 * linear(channel(3)) + 0.0722 * linear(channel(5));
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* ------------------------------------------------- chart legibility and colour */

test("tick labels clear WCAG AA on both page backgrounds", () => {
  // Recharts paints tick text with `fill`, not `color`. A checker that reads
  // `color` reports a clean page while every chart label fails - which is
  // exactly what happened, so this is asserted on the values themselves.
  const darkLabel = chartTheme(true).label;
  const lightLabel = chartTheme(false).label;
  assert.notEqual(darkLabel, lightLabel, "one label colour per theme");
  assert.ok(contrast(darkLabel, "#000000") >= 4.5, `dark label ${darkLabel} is ${contrast(darkLabel, "#000000").toFixed(2)}:1`);
  assert.ok(contrast(lightLabel, "#f8fafc") >= 4.5, `light label ${lightLabel} is ${contrast(lightLabel, "#f8fafc").toFixed(2)}:1`);
});

test("the Adaptive tab's cards add no colour of the borrowed template palette", () => {
  // The cards around each chart draw only after the insights request, made in
  // an effect, returns, so a server render shows none of them; the charts
  // themselves are rendered in site-ui-behaviour.test.ts.
  const stock = ["#007cf0", "#00dfd8", "#ff0080", "#7928ca", "#f9cb28", "#50e3c2", "#ff4d4d", "#eb367f"];
  const tab = read("src/components/dashboard/InsightsTab.tsx").toLowerCase();
  for (const hex of stock) assert.equal(tab.includes(hex), false, `InsightsTab still uses ${hex}`);
});

/* ------------------------------------------------- the public pages */

test("the drawings of the product, and the script that photographed real data, are gone", () => {
  // The front page used to carry div-built imitations of the product - an
  // "example workspace" with invented stages and percentages. The pages now show
  // screenshots of the real app (rendered in site-ui-behaviour.test.ts).
  for (const gone of ["FeatureShowcases.tsx", "MarketingMotion.tsx", "FeatureBand.tsx"]) {
    assert.equal(exists(`src/components/marketing/${gone}`), false, `${gone} was a drawing of the product`);
  }
  assert.equal(exists("scripts/capture-marketing-shots.ts"), false, "the real-data capture script is gone");
});

test("a product clip waits for the reader's motion setting and for being on screen, and can be paused", () => {
  // These run in the clip's effects and its playing event, which a server
  // render never fires; that the clips are muted, inline and in the page's
  // theme is rendered in site-ui-behaviour.test.ts.
  const clip = read("src/components/marketing/ProductClip.tsx");
  assert.match(clip, /prefers-reduced-motion: reduce/, "no autoplay for readers who asked for less motion");
  assert.match(clip, /IntersectionObserver/, "a clip off screen does not play");
  assert.match(clip, /Pause the product video/, "moving content beside text can be stopped");
});

test("the figures under the hero are figures, and each one is checkable", () => {
  // "4 core research workflows" and "1 workspace for papers, charts and chat"
  // were set at display size and proved nothing.
  const figures = proofMetrics.map((metric) => `${metric.value} ${metric.label}`);
  assert.equal(figures.includes("4 core research workflows"), false);
  assert.ok(figures.includes("12 analysis stages per paper"), figures.join("; "));
  assert.ok(figures.some((figure) => figure.startsWith("6 dashboard views")), figures.join("; "));

  // Twelve is the ingestion graph's analysing nodes. graphs.py is the Python
  // worker's graph, which these Node tests cannot build, so its registrations
  // are counted. (The six dashboard views are counted as rendered tabs in
  // site-ui-behaviour.test.ts.)
  const graphs = readFileSync(new URL("../../graphs.py", import.meta.url), "utf8");
  const ingestion = graphs.slice(graphs.indexOf("def build_ingestion_graph"));
  const nodes = (ingestion.slice(0, ingestion.indexOf("return")).match(/workflow\.add_node\(/g) ?? []).length;
  assert.equal(nodes, 13, "12 analysing nodes plus build_dataset");
});

test("a perpetual rainbow sweep is no longer in the stylesheet", () => {
  assert.equal(read("src/app/globals.css").includes("marketing-scanline"), false);
});

/* --------------------------------------------------------- dark-mode legibility */

test("the drawer marks the page you are on in the rail's tone", () => {
  // The rail is rendered in site-ui-behaviour.test.ts. The drawer is drawn only
  // after its menu button is clicked, which a server render cannot do, so both
  // chips are counted: the drawer's was #030303, darker than its own surface.
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  assert.equal(/"bg-slate-900 text-white dark:bg-\[#030303\]"/.test(shell), false);
  assert.ok(contrast("#1f1f1f", "#050505") > contrast("#111111", "#050505"));
  assert.equal((shell.match(/bg-slate-900 text-white dark:bg-\[#1f1f1f\]/g) ?? []).length, 2);
});

test("a failed chat message can be read in light mode", () => {
  // text-red-200 (#fecaca) over bg-red-500/10 on white computes to about 1.27:1.
  // The error surfaces appear only once a request has failed, which a server
  // render of the chat never reaches.
  const chat = read("src/components/chat/ChatClient.tsx");
  const surfaces = [...chat.matchAll(/border-red-500\/20 bg-red-500\/10[^"]*/g)].map((m) => m[0]);
  assert.ok(surfaces.length >= 3);
  for (const surface of surfaces) {
    assert.match(surface, /text-red-700/, `an error surface with no light-mode colour: ${surface}`);
    assert.match(surface, /dark:text-red-200/);
  }
});

test("the commit action in the message editor outranks the cancel action", () => {
  // Cancel was the one solid near-black pill and Send was white-on-white. The
  // editor opens on a click, which a server render cannot make.
  const chat = read("src/components/chat/ChatClient.tsx");
  assert.equal(/dark:bg-black dark:text-white dark:hover:bg-\[#0a0a0a\]/.test(chat), false);
  assert.match(chat, /onClick=\{cancelEditingUserMessage\}\s*\n\s*className="inline-flex h-10 items-center rounded-full border/);
});

/* ---------------------------------------------------------------- navigation */

test("the places that open a paper by its id still do", () => {
  // The citation, the paper link and the old /workspace/papers address are run
  // in site-ui-behaviour.test.ts. Keyword Explorer's paper links appear only
  // once its concept search, a request made in an effect, has answered, and
  // the Library opens a ?paperId= paper in an effect once its list has loaded.
  assert.match(read("src/components/tabs/KeywordExplorer.tsx"), /<PaperLink\s+paper=\{\{ paperId: String\(paper\.paperId\) \}\}/);
  assert.match(
    read("src/components/admin/AdminImportClient.tsx"),
    /searchParams\.get\("paperId"\)/,
    "the destination must still read the parameter"
  );
});

test("the Library says why a run failed, in both the list and grid views", () => {
  // What the retired History page did that nothing else did. The Library's
  // runs arrive by a request made in an effect, so a server render has none.
  const library = readCode("src/components/admin/AdminImportClient.tsx");
  assert.match(library, /run\.status === "failed"\s*\n?\s*\? describeRunFailure\(run\.error_message\)/);
  assert.ok(
    (library.match(/item\.run\.status === "failed"/g) ?? []).length >= 3,
    "the pill and both subtitle renders must mark a failure"
  );
});

/* --------------------------------------------------------------- hit areas */

test("a chat thread row is clickable across its whole height", () => {
  // The padding sat on the row wrapper, so the row looked 28px tall while only
  // the 20px of text responded. The thread list arrives by a request made in
  // an effect, so a server render of the chat has no rows.
  const chat = read("src/components/chat/ChatClient.tsx");
  assert.match(chat, /className="block w-full min-w-0 py-1\.5 text-left \[@media\(hover:none\)\]:pr-8"/);
});

/* -------------------------------------------------------- page structure */

test("the filter sheet's close button carries a name too", () => {
  // The side panel's is rendered in site-ui-behaviour.test.ts; the sheet that
  // replaces it below xl opens on a click, so both are counted.
  assert.equal((read("src/components/DashboardClient.tsx").match(/aria-label="Close analytics filters"/g) ?? []).length, 2);
});

/* ------------------------------------------------------- muted text legibility */

test("the replacement greys measure as the fixes say", () => {
  // slate-400 on white was the most common contrast failure on the site;
  // #666666 and #6f6f6f were the faintest dark-mode greys. Where they were used
  // is rendered in site-ui-behaviour.test.ts.
  assert.ok(contrast("#94a3b8", "#ffffff") < 4.5, "slate-400 on white fails");
  assert.ok(contrast("#64748b", "#ffffff") >= 4.5, "slate-500 on white passes");
  assert.ok(contrast("#666666", "#050505") < 4.5 && contrast("#6f6f6f", "#050505") < 4.5);
  assert.ok(contrast("#8f8f8f", "#050505") >= 4.5);
});

/* ------------------------------------------------------ state and feedback */

test("switching conversations does not show the previous one's messages", () => {
  // Clicking a thread marks it active at once, but the transcript was only
  // replaced when the fetch returned. This all happens in the chat's effects
  // and click handlers, which a server render never runs.
  const chat = readCode("src/components/chat/ChatClient.tsx");
  assert.match(chat, /const loadedThreadIdRef = useRef<string \| null>\(null\)/);
  assert.match(chat, /if \(loadedThreadIdRef\.current !== threadId\) \{[\s\S]{0,200}setMessages\(\[\]\)/);
  // ...but reloading the SAME thread after sending a message must not blank it.
  assert.match(chat, /loadedThreadIdRef\.current = threadId;/);
  // and the empty transcript must not flash the "ask me anything" intro.
  assert.match(chat, /!hasContent && !loading && !detailLoading \?/);
  assert.match(chat, /setActiveThread\(null\);\s*\n\s*loadedThreadIdRef\.current = null;/);
});

test("opening a repository's card in the Library does not switch the app to it", () => {
  // The notice and its switch button are rendered in site-ui-behaviour.test.ts;
  // what the card and the button do happens in their click handlers.
  const library = readCode("src/components/admin/AdminImportClient.tsx");
  const cardClick = library.slice(
    library.indexOf("setLibraryProjectId(project.id);"),
    library.indexOf("setLibraryProjectId(project.id);") + 220
  );
  assert.equal(/setSelectedProjectId\(project\.id\)/.test(cardClick), false, "browsing must not change the active repository");
  assert.match(library, /onClick=\{\(\) => setSelectedProjectId\(libraryProject\.id\)\}/);
});

test("a loading indicator still means something without motion", () => {
  // The site-wide reduced-motion rule froze animate-pulse on a half-width bar.
  // The bar shows only after a navigation link is clicked.
  const shell = readCode("src/components/workspace/WorkspaceShell.tsx");
  assert.match(shell, /role="status"\s*\n\s*aria-label="Loading page"/);
  assert.match(shell, /w-full bg-slate-950 motion-safe:w-1\/2 motion-safe:animate-pulse/);
});

test("both tab states carry the same bottom border, so neither is larger", () => {
  // That every tab wears tab-btn and only one is active is rendered in
  // site-ui-behaviour.test.ts; the border itself is the stylesheet's.
  const css = read("src/app/globals.css");
  assert.match(css, /\.tab-btn \{\s*@apply[^;]*border-b-2/);
  assert.match(css, /\.tab-btn-inactive \{\s*@apply border-transparent/);
});

test("no stylesheet rule ships with nothing to style", () => {
  // .app-muted was in the bundle every visitor downloads and had zero call
  // sites.
  const css = read("src/app/globals.css");
  assert.equal(css.includes(".app-muted {"), false, ".app-muted had zero call sites");
  // The ones that remain are defined because something uses them.
  for (const rule of ["app-surface", "app-card", "tab-btn"]) {
    assert.match(css, new RegExp(`\\.${rule}[ -]`), `.${rule} should still be defined`);
  }
});

/* ------------------------------------------------- the instrument itself */

/**
 * The in-page code of scripts/capture-ui.ts: the value of its DIAGNOSTICS
 * literal, as page.evaluate receives it. The script launches a browser when
 * it is loaded, so the value is taken from its syntax tree instead.
 */
function diagnosticsLiteral() {
  const path = new URL("../scripts/capture-ui.ts", import.meta.url);
  const source = ts.createSourceFile("capture-ui.ts", readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "DIAGNOSTICS") initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(initializer, "the diagnostics block must exist");
  return initializer;
}

type FakeNode = FakeElement | { nodeType: 3; textContent: string };

/** Just enough of a DOM element for the diagnostics to walk. */
class FakeElement {
  readonly nodeType = 1;
  parentElement: FakeElement | null = null;
  readonly childNodes: FakeNode[] = [];
  readonly scrollWidth = 0;
  readonly clientWidth = 0;
  constructor(
    readonly tagName: string,
    readonly attributes: Record<string, string> = {},
    readonly style: Record<string, string> = {},
    children: Array<FakeElement | string> = []
  ) {
    for (const child of children) {
      if (typeof child === "string") this.childNodes.push({ nodeType: 3, textContent: child });
      else {
        child.parentElement = this;
        this.childNodes.push(child);
      }
    }
  }
  get id() {
    return this.attributes.id ?? "";
  }
  get className() {
    return this.attributes.class ?? "";
  }
  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join("");
  }
  get outerHTML() {
    return `<${this.tagName.toLowerCase()}>${this.textContent}</${this.tagName.toLowerCase()}>`;
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  hasAttribute(name: string) {
    return name in this.attributes;
  }
  getBoundingClientRect() {
    return { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 };
  }
  descendants(): FakeElement[] {
    return this.childNodes.flatMap((node) => (node instanceof FakeElement ? [node, ...node.descendants()] : []));
  }
  matches(selector: string): boolean {
    return selector.split(",").some((compound) => {
      const parts = compound.trim().split(/\s+/);
      if (!matchesSimple(this, parts[parts.length - 1])) return false;
      let ancestor = this.parentElement;
      for (const part of parts.slice(0, -1).reverse()) {
        while (ancestor && !matchesSimple(ancestor, part)) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
  }
  closest(selector: string): FakeElement | null {
    for (let node: FakeElement | null = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  querySelectorAll(selector: string) {
    return this.descendants().filter((node) => node.matches(selector));
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function matchesSimple(element: FakeElement, part: string) {
  if (part === "*") return true;
  const attribute = /^\[([\w-]+)="([^"]*)"\]$/.exec(part);
  if (attribute) return element.attributes[attribute[1]] === attribute[2];
  return element.tagName.toLowerCase() === part.toLowerCase();
}

const COMPUTED_DEFAULTS: Record<string, string> = {
  display: "block",
  visibility: "visible",
  opacity: "1",
  color: "rgb(0, 0, 0)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  fill: "rgb(0, 0, 0)",
  fontSize: "14px",
  fontWeight: "400",
  position: "static",
  overflow: "visible",
  overflowX: "visible",
  textOverflow: "clip",
  zIndex: "auto",
};

/** Runs the diagnostics on a page built of fake elements, as the page would. */
function diagnose(body: FakeElement) {
  const html = new FakeElement("HTML", {}, {}, [body]);
  const document = {
    documentElement: Object.assign(html, { clientWidth: 1280, scrollWidth: 1280 }),
    querySelectorAll: (selector: string) => [html, ...html.descendants()].filter((node) => node.matches(selector)),
  };
  const getComputedStyle = (element: FakeElement) => ({ ...COMPUTED_DEFAULTS, ...element.style });
  const initializer = diagnosticsLiteral();
  assert.ok(ts.isNoSubstitutionTemplateLiteral(initializer));
  const result = vm.runInNewContext(initializer.text, { document, getComputedStyle });
  return JSON.parse(JSON.stringify(result)) as { contrast: Array<Record<string, unknown>>; [section: string]: unknown };
}

test("the in-page diagnostics block is one whole literal, with no holes, that runs to its end", () => {
  // A backtick anywhere in it - even in a comment - ends the literal early.
  // That happened, and the truncated string still ran, measuring less than it
  // claimed. A template hole would interpolate at build time.
  assert.ok(ts.isNoSubstitutionTemplateLiteral(diagnosticsLiteral()), "one literal with no ${} holes");
  const header = new FakeElement("HEADER", {}, { zIndex: "40" }, [new FakeElement("H1", {}, { fontSize: "30px" }, ["Dashboard"])]);
  const report = diagnose(new FakeElement("BODY", {}, { backgroundColor: "rgb(255, 255, 255)" }, [header, new FakeElement("P", {}, {}, ["Readable text"])]));
  assert.deepEqual(report.contrast, []);
  assert.deepEqual(report.headings, [{ level: 1, text: "Dashboard", fontSize: 30 }]);
  assert.deepEqual(report.zIndexes, [{ z: "40", count: 1 }], "the last section ran");
});

test("the page audit measures chart text by its fill, not its colour", () => {
  // Every chart label is SVG text painted with `fill`. Reading `color` reported
  // a clean page while the axis labels sat at 2.6:1.
  const tick = (label: string, fill: string) => new FakeElement("text", { class: "recharts-text" }, { fill, color: "rgb(0, 0, 0)", fontSize: "12px" }, [label]);
  const chart = new FakeElement("DIV", {}, {}, [new FakeElement("svg", {}, {}, [new FakeElement("g", {}, {}, [tick("2018", "rgb(148, 163, 184)"), tick("2020", "rgb(112, 112, 112)")])])]);
  const report = diagnose(new FakeElement("BODY", {}, { backgroundColor: "rgb(255, 255, 255)" }, [chart]));
  assert.deepEqual(
    report.contrast.map((entry) => [entry.tag, entry.text, entry.color, entry.ratio, entry.need]),
    [["svg:text", "2018", "rgb(148, 163, 184)", 2.56, 4.5]],
    "the grey tick label fails; the #707070 one and the black `color` do not count"
  );
});
