import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

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

test("charts read the theme instead of hardcoding one", () => {
  // Four of the five chart components hardcoded stroke="#94a3b8" and never read
  // the theme. Measured on the deployed dashboard, tick text rendered at
  // rgb(124,138,160) on the page background - 3.35:1, under the 4.5:1 that
  // body-size text needs. The hardcoded value elsewhere is worse, about 2.6:1.
  for (const file of [
    "src/components/tabs/KeywordExplorer.tsx",
    "src/components/tabs/TrackAnalysis.tsx",
    "src/components/tabs/TrendAnalysis.tsx",
    "src/components/dashboard/AdaptiveDashboardTab.tsx",
  ]) {
    const src = read(file);
    assert.equal(/#94a3b8/.test(src), false, `${file} still hardcodes the axis colour`);
    assert.match(src, /chartTheme\(hydrated && theme === "dark"\)/, `${file} must read the theme`);
    assert.match(src, /tickStyle\(ct/, `${file} must set an explicit tick fill`);
  }
});

test("tick labels clear WCAG AA on both page backgrounds", () => {
  // Recharts paints tick text with `fill`, not `color`. A checker that reads
  // `color` reports a clean page while every chart label fails - which is
  // exactly what happened, so this is asserted on the values themselves.
  const theme = read("src/lib/chart-theme.ts");
  const labels = [...theme.matchAll(/label: "(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  assert.equal(labels.length, 2, "one label colour per theme");
  const [darkLabel, lightLabel] = labels;
  assert.ok(
    contrast(darkLabel, "#000000") >= 4.5,
    `dark label ${darkLabel} is ${contrast(darkLabel, "#000000").toFixed(2)}:1`
  );
  assert.ok(
    contrast(lightLabel, "#f8fafc") >= 4.5,
    `light label ${lightLabel} is ${contrast(lightLabel, "#f8fafc").toFixed(2)}:1`
  );
});

test("one quantity is drawn in one colour", () => {
  // The identical "Papers" series was cyan, purple and hot pink in three
  // adjacent charts, inviting a reader to infer a categorical meaning the hue
  // does not carry.
  const tab = read("src/components/dashboard/AdaptiveDashboardTab.tsx");
  assert.equal(/(?:fill|stroke)="#[0-9a-fA-F]{6}"/.test(tab), false, "no chart colour may be hardcoded");
  assert.match(tab, /name="Papers" fill=\{ct\.barFill\}/);
});

/* ----------------------------------------------------- the stock palette is gone */

test("the borrowed template palette appears nowhere in the app", () => {
  // #007cf0 / #00dfd8 / #ff0080 / #7928ca / #f9cb28 are the stock gradient
  // colours of a well-known deployment template. They carried no product
  // meaning, clashed with a monochrome brand, and had leaked off the marketing
  // pages into real dashboard charts.
  const stock = ["#007cf0", "#00dfd8", "#ff0080", "#7928ca", "#f9cb28", "#50e3c2", "#ff4d4d", "#eb367f"];
  for (const file of [
    "src/app/page.tsx",
    "src/app/features/[slug]/page.tsx",
    "src/components/marketing/FeatureShowcases.tsx",
    "src/components/marketing/MarketingMotion.tsx",
    "src/components/marketing/FeatureBand.tsx",
    "src/components/marketing/marketing-content.ts",
    "src/components/dashboard/AdaptiveDashboardTab.tsx",
  ]) {
    const src = read(file);
    for (const hex of stock) {
      assert.equal(src.includes(hex), false, `${file} still uses ${hex}`);
    }
  }
});

test("nothing claims to be live that is a drawing", () => {
  const motion = readCode("src/components/marketing/MarketingMotion.tsx");
  assert.equal(/LIVE REPOSITORY/.test(motion), false);
  assert.equal(/research-trend-analysis\.web\.app/.test(motion), false, "and not a stale hostname either");
  assert.match(motion, /EXAMPLE WORKSPACE/);
  assert.match(readCode("src/components/marketing/FeatureShowcases.tsx"), /illustration/);
});

test("the product illustration shows stages the product actually has", () => {
  // "Extract text 96%" and "Find metadata 88%" read as accuracy figures, and
  // nothing in the product measures or publishes such a number.
  const showcases = readCode("src/components/marketing/FeatureShowcases.tsx");
  for (const invented of ["96%", "88%", "74%", "91%"]) {
    assert.equal(
      showcases.includes(`"${invented}"`),
      false,
      `${invented} reads as a measurement the product never makes`
    );
  }
  assert.match(showcases, /Extract and clean text/);
  assert.match(showcases, /Classify tracks and typology/);
});

test("a published number can be traced to the thing it counts", () => {
  // "9 analysis passes" matched nothing in the code. The ingestion graph
  // registers 13 nodes, 12 of which analyse.
  const content = read("src/components/marketing/marketing-content.ts");
  assert.equal(/metric: "9", label: "analysis passes"/.test(content), false);
  assert.match(content, /metric: "12", label: "analysis stages per paper"/);
});

test("the figures under the hero are figures, and each one is checkable", () => {
  // "4 core research workflows" and "1 workspace for papers, charts and chat"
  // were set at display size, where the eye goes looking for evidence - and
  // proved nothing. Both numbers here can be counted in the code.
  const content = readCode("src/components/marketing/marketing-content.ts");
  const strip = content.slice(
    content.indexOf("export const proofMetrics"),
    content.indexOf("];", content.indexOf("export const proofMetrics"))
  );
  assert.equal(/value: "4", label: "core research workflows"/.test(strip), false);
  assert.match(strip, /value: "12", label: "analysis stages per paper"/);
  assert.match(strip, /value: "6", label: "dashboard views/);

  // The published counts must match what they count.
  const graphs = readFileSync(new URL("../../graphs.py", import.meta.url), "utf8");
  const ingestion = graphs.slice(graphs.indexOf("def build_ingestion_graph"));
  const nodes = (ingestion.slice(0, ingestion.indexOf("return")).match(/workflow\.add_node\(/g) ?? []).length;
  assert.equal(nodes, 13, "12 analysing nodes plus build_dataset");

  const dash = readCode("src/components/DashboardClient.tsx");
  assert.equal((dash.match(/\{ key: "[a-z_]+", label: "[^"]+" \}/g) ?? []).length, 6);
});

test("footer navigation looks like navigation", () => {
  // Six links were drawn as bordered, filled boxes in a two-column grid - the
  // treatment this site gives buttons and text inputs - so the footer read as a
  // row of disabled form controls.
  const layout = readCode("src/components/marketing/MarketingLayout.tsx");
  const footer = layout.slice(layout.indexOf("data-site-footer"));
  assert.match(footer, /<nav aria-label="Footer"/);
  assert.equal(
    /footerLinks\.map[\s\S]{0,400}rounded-lg border border-slate-200 bg-white/.test(footer),
    false,
    "a link should not wear the control treatment"
  );
  assert.match(footer, /-mx-2 rounded px-2 py-2 text-sm/, "padding keeps the hit area the boxes gave");
});

test("a perpetual rainbow sweep no longer runs over every product frame", () => {
  assert.equal(read("src/app/globals.css").includes("marketing-scanline"), false);
  for (const file of [
    "src/components/marketing/FeatureShowcases.tsx",
    "src/components/marketing/MarketingMotion.tsx",
  ]) {
    assert.equal(read(file).includes("marketing-scanline"), false);
  }
});

test("hover feedback survives the light-mode retrofit", () => {
  // The retrofit rewrites base utility classes by name, and a hover utility is a
  // different class name - but the base rule out-specifies it, so hovering these
  // controls in light mode changed nothing at all. Measured on the deployed
  // landing page: rest rgb(255,255,255), hover rgb(255,255,255).
  const banned = /(?<!dark:)\bhover:(?:bg|border|text)-\[#[0-9a-fA-F]{6}\]/;
  for (const file of [
    "src/app/page.tsx",
    "src/app/features/[slug]/page.tsx",
    "src/components/marketing/FeatureBand.tsx",
    "src/components/marketing/FeatureShowcases.tsx",
    "src/components/marketing/MarketingMotion.tsx",
  ]) {
    assert.equal(banned.test(read(file)), false, `${file} hover state cannot reach light mode`);
  }
});

/* --------------------------------------------------------- dark-mode legibility */

test("the workspace tells you which page you are on, in both themes", () => {
  // The rail's active chip was #111111 on a #050505 surface (1.08:1); the
  // drawer's was #030303, darker than the surface it sat on, so the "you are
  // here" mark was not merely invisible but inverted.
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  assert.equal(/dark:bg-\[#111111\]"/.test(shell), false);
  assert.equal(/"bg-slate-900 text-white dark:bg-\[#030303\]"/.test(shell), false);
  assert.ok(contrast("#1f1f1f", "#050505") > contrast("#111111", "#050505"));
  assert.equal((shell.match(/bg-slate-900 text-white dark:bg-\[#1f1f1f\]/g) ?? []).length, 2);
});

test("a selected preference looks different from an unselected one in dark mode", () => {
  // Active and inactive rendered byte-identical dark classes, and hovering an
  // option you had NOT chosen gave it a brighter border than the one you had.
  const settings = read("src/components/workspace/WorkspaceSettingsClient.tsx");
  assert.equal(
    settings.includes('? "border-slate-400 bg-slate-50 dark:border-[#1f1f1f] dark:bg-[#050505]"'),
    false
  );
  const active = settings.match(/\? "border-slate-400 bg-slate-50 dark:border-\[#8f8f8f\] dark:bg-\[#0a0a0a\]"/g) ?? [];
  assert.equal(active.length, 3, "all three preference groups need a visible selected state");
});

test("a failed chat message can be read in light mode", () => {
  // text-red-200 (#fecaca) over bg-red-500/10 on white computes to about 1.27:1.
  // The sentence explaining the failure was present and unreadable.
  const chat = read("src/components/chat/ChatClient.tsx");
  const surfaces = [...chat.matchAll(/border-red-500\/20 bg-red-500\/10[^"]*/g)].map((m) => m[0]);
  assert.ok(surfaces.length >= 3);
  for (const surface of surfaces) {
    assert.match(surface, /text-red-700/, `an error surface with no light-mode colour: ${surface}`);
    assert.match(surface, /dark:text-red-200/);
  }
});

test("the commit action in the message editor outranks the cancel action", () => {
  // Cancel was the one solid near-black pill and Send was white-on-white with no
  // border, so the page styled the discard as primary and the commit as nothing.
  // In dark mode the fault swapped: Cancel became #000000 on a #050505 card.
  const chat = read("src/components/chat/ChatClient.tsx");
  assert.equal(/dark:bg-black dark:text-white dark:hover:bg-\[#0a0a0a\]/.test(chat), false);
  assert.match(chat, /onClick=\{cancelEditingUserMessage\}\s*\n\s*className="inline-flex h-10 items-center rounded-full border/);
});

/* ---------------------------------------------------------------- navigation */

test("a citation leads to the paper it cites", () => {
  // /workspace/papers is a redirect() with a fixed path, so ?paperId= was
  // discarded. Every research-chat citation and every "Open paper" link pointed
  // there, and the destination reads paperId perfectly well - the parameter just
  // never arrived. A citation that opens nothing reads as a fabricated citation.
  for (const file of [
    "src/lib/repository-chat.ts",
    "src/lib/corpus.ts",
    "src/components/tabs/KeywordExplorer.tsx",
  ]) {
    const src = read(file);
    assert.equal(/\/workspace\/papers\?paperId=/.test(src), false, `${file} still links to the redirect`);
    assert.match(src, /\/workspace\/library\?paperId=/);
  }
  assert.match(
    read("src/components/admin/AdminImportClient.tsx"),
    /searchParams\.get\("paperId"\)/,
    "the destination must still read the parameter"
  );
});

test("an old bookmark keeps its parameters", () => {
  const page = read("src/app/workspace/papers/page.tsx");
  assert.match(page, /searchParams/);
  assert.match(page, /\/workspace\/library\?\$\{suffix\}/);
});

test("every built page is reachable from the interface", () => {
  // /workspace/logs is a finished 441-line History page that nothing linked to.
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  assert.match(shell, /href: "\/workspace\/logs", label: "History"/);
  assert.match(shell, /href: "\/workspace\/logs",\n\s*icon: FileIcon/);
});

test("one label does not name two destinations", () => {
  // The command palette listed "Repositories" twice - /workspaces and
  // /workspace/library - so the reader had to read the descriptions to guess.
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  const start = shell.indexOf("const SEARCH_PAGE_ITEMS");
  const items = shell.slice(start, shell.indexOf("];", start));
  const labels = [...items.matchAll(/^\s*label: "([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(labels.length >= 7);
  assert.equal(new Set(labels).size, labels.length, `duplicate labels: ${labels.join(", ")}`);
});

test("a button says where it actually goes", () => {
  // "Open imports" pointed at /workspace/imports, which redirects to
  // /workspace/library - a page titled "Repositories".
  const card = read("src/components/workspace/AnalysisStatusCard.tsx");
  assert.equal(/href="\/workspace\/imports"/.test(card), false);
  assert.match(card, /href="\/workspace\/library"[\s\S]{0,400}Open repositories/);
});

/* --------------------------------------------------------------- hit areas */

test("a chat thread row is clickable across its whole height", () => {
  // The padding sat on the row wrapper, so the row looked 28px tall while only
  // the 20px of text responded to a click.
  const chat = read("src/components/chat/ChatClient.tsx");
  assert.match(chat, /className="block w-full min-w-0 py-1\.5 text-left"/);
});

test("the feature card link is bigger than its text", () => {
  assert.match(
    read("src/components/marketing/FeatureBand.tsx"),
    /-my-1\.5 mt-\[18px\] inline-flex items-center gap-2 py-1\.5/
  );
});

/* -------------------------------------------------------- page structure */

test("the dashboard names itself", () => {
  // It opened directly onto a search field: the only workspace page with no h1,
  // and the only one a screen reader announced with no title.
  assert.match(
    read("src/components/DashboardClient.tsx"),
    /<h1 className="text-2xl font-semibold[^"]*">\s*Dashboard\s*<\/h1>/
  );
});

test("icon-only controls carry a name", () => {
  assert.match(read("src/components/chat/ChatClient.tsx"), /aria-label="Start a new chat"/);
  const dash = read("src/components/DashboardClient.tsx");
  assert.equal((dash.match(/aria-label="Close analytics filters"/g) ?? []).length, 2);
});

test("a decorative separator is marked decorative", () => {
  assert.match(
    read("src/components/workspace/WorkspaceShell.tsx"),
    /aria-hidden="true" className="hidden flex-none text-slate-300/
  );
});

/* ------------------------------------------------------- muted text legibility */

test("muted light-mode text is not slate-400", () => {
  // slate-400 on white measures 2.56:1 and was the most common contrast failure
  // on the site. dark:text-slate-400 is deliberately left alone: on a near-black
  // surface it reads 7.8:1, and one step darker would fail.
  assert.ok(contrast("#94a3b8", "#ffffff") < 4.5, "slate-400 on white fails");
  assert.ok(contrast("#64748b", "#ffffff") >= 4.5, "slate-500 on white passes");
  const offenders: string[] = [];
  for (const file of [
    "src/components/docs/DocsFrame.tsx",
    "src/components/docs/DocsOnThisPage.tsx",
    "src/components/workspace/WorkspaceShell.tsx",
    "src/components/DashboardClient.tsx",
    "src/components/admin/AdminImportClient.tsx",
    "src/components/auth/AuthPanel.tsx",
  ]) {
    if (/(?<!dark:)(?<!:)\btext-slate-400\b/.test(read(file))) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

/* ------------------------------------------------------ state and feedback */

test("switching conversations does not show the previous one's messages", () => {
  // Clicking a thread marks it active in the sidebar at once, but the transcript
  // was only replaced when the fetch returned - so for the length of the round
  // trip one conversation sat under another's name, and on failure it stayed
  // there under an error about a thread the reader was no longer looking at.
  const chat = readCode("src/components/chat/ChatClient.tsx");
  assert.match(chat, /const loadedThreadIdRef = useRef<string \| null>\(null\)/);
  assert.match(chat, /if \(loadedThreadIdRef\.current !== threadId\) \{[\s\S]{0,200}setMessages\(\[\]\)/);
  // ...but reloading the SAME thread after sending a message must not blank it.
  assert.match(chat, /loadedThreadIdRef\.current = threadId;/);
  // and the empty transcript must not flash the "ask me anything" intro, which
  // would say "this conversation is empty" about one that is still arriving.
  assert.match(chat, /!hasContent && !loading && !detailLoading \?/);
  assert.match(chat, /setActiveThread\(null\);\s*\n\s*loadedThreadIdRef\.current = null;/);
});

test("a loading indicator still means something without motion", () => {
  // The site-wide reduced-motion rule collapses every animation duration, so
  // animate-pulse on a half-width bar stopped at its last keyframe and sat
  // there - a bar frozen at 50%, which reads as stalled rather than working.
  const shell = readCode("src/components/workspace/WorkspaceShell.tsx");
  assert.match(shell, /role="status"\s*\n\s*aria-label="Loading page"/);
  assert.match(shell, /w-full bg-slate-950 motion-safe:w-1\/2 motion-safe:animate-pulse/);
});

test("a tab row does not resize when you click a tab", () => {
  // The border sat only on the inactive pills. Under border-box sizing with auto
  // width that made every inactive pill 2px wider and taller than the active
  // one, so clicking reflowed the whole nowrap row sideways under the pointer.
  const modal = readCode("src/components/workspace/PaperAnalysisExplorerModal.tsx");
  assert.match(modal, /flex-none rounded-full border px-4 py-2/);
  assert.match(modal, /border-slate-900 bg-slate-900 text-white/);
  assert.equal(
    /\? "bg-slate-900 text-white dark:bg-white dark:text-\[#171717\]"/.test(modal),
    false,
    "the active branch must carry a border too"
  );
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

/* ------------------------------------------------- data the reader is shown */

test("a seeded fabrication is only ever shown when preview mode was chosen", () => {
  // Two paths handed back generateMockData() - eleven years of invented topics -
  // when there was no session, which is also the moment after mount before the
  // session hydrates. A signed-in reader saw it flash past as their own library.
  const hook = read("src/hooks/useData.ts");
  const calls = [...hook.matchAll(/generateMockData\(\)/g)];
  assert.ok(calls.length >= 1, "explicit preview mode still needs it");
  for (const call of calls) {
    const before = hook.slice(Math.max(0, call.index! - 400), call.index!);
    assert.match(
      before,
      /mode === "mock"/,
      "every fabrication must sit inside an explicit preview-mode guard"
    );
  }
});

test("the first screen after signing in is not an empty box", () => {
  // /workspaces is where login lands and where every workspace breadcrumb
  // points. It rendered a bare coloured <main> for the whole projects
  // round-trip: no logo, no heading, no spinner, nothing.
  const index = read("src/components/workspace/workspaces/ProjectIndexClient.tsx");
  assert.equal(
    /return <main className="min-h-screen bg-slate-50 dark:bg-black" \/>;/.test(index),
    false
  );
  const loading = index.slice(index.indexOf("if (!hydrated || workspaceLoading)"), index.indexOf("return (\n    <main className=\"min-h-screen bg-slate-50 text-slate-900"));
  assert.match(index, /aria-busy="true"/);
  assert.match(index, /Loading your repositories/);
  assert.match(index, /animate-pulse/, "the cards are blocked out so the page does not jump");
  assert.ok(loading.length > 0);
});

test("the dashboard feature page does not claim what the code refuses to do", () => {
  // "Live library updates" - the dashboard passes no pollIntervalMs and sets
  // refetchOnWindowFocus: false, so the only refresh is the manual one. And
  // there are six views, not four.
  const content = read("src/components/marketing/marketing-content.ts");
  assert.equal(/metric: "Live", label: "library updates"/.test(content), false);
  assert.equal(/metric: "4", label: "category views"/.test(content), false);
  assert.match(content, /metric: "6", label: "dashboard views"/);

  const dash = read("src/components/DashboardClient.tsx");
  const tabs = (dash.match(/\{ key: "[a-z_]+", label: "[^"]+" \}/g) ?? []).length;
  assert.equal(tabs, 6, "the published count must match TAB_DEFINITIONS");
  assert.equal(/pollIntervalMs/.test(dash), false, "still not polling, so still not live");
});

test("the faintest dark-mode greys are gone", () => {
  // #666666 measured 3.55:1 and #6f6f6f 4.06:1 on the #050505 panel; #8f8f8f
  // reads 6.31:1 and was already the brand's label grey, so this raises
  // legibility and removes two near-duplicate greys in the same move.
  assert.ok(contrast("#8f8f8f", "#050505") >= 4.5);
  for (const file of [
    "src/components/docs/DocsFrame.tsx",
    "src/components/workspace/WorkspaceShell.tsx",
    "src/app/error.tsx",
  ]) {
    const src = read(file);
    assert.equal(/text-\[#666666\]/.test(src), false, `${file} still uses #666666`);
    assert.equal(/text-\[#6f6f6f\]/.test(src), false, `${file} still uses #6f6f6f`);
  }
});
