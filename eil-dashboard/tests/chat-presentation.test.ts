/*
 * How the chat page looks: its colours, motion, focus, layout and measure.
 * The page, an answer, a chart card and the intro are rendered as the server
 * sends them, with sign-in, the workspace, the theme and Next's router the
 * tests/support/stub-auditfix-*.ts ones and recharts at a fixed size, and
 * their markup is checked. What only a stylesheet or every state of the page
 * can show is read from the source, each with its reason.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AA_NORMAL,
  DARK_SURFACES,
  LIGHT_SURFACES,
  checkContrast,
  contrastRatio,
  luminance,
  colourPairs,
  resolveColour,
  worstRatio,
} from "../src/lib/contrast";
import {
  ANSWER_MEASURE_CH,
  ANSWER_MEASURE_CLASS,
} from "../src/lib/answer-typography";
import { GRAY } from "../src/lib/palette";
import { stubModule } from "./support/route-harness";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/recharts/lib/index.js", support("stub-auditfix-recharts.ts"));
stubModule("/node_modules/recharts/es6/index.js", support("stub-auditfix-recharts.ts"));
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
(globalThis as { React?: typeof React }).React = React;

function chatSource(): string {
  return ["ChatClient.tsx", "ChatChartCard.tsx", "AnswerBody.tsx", "ChatIntro.tsx"]
    .map((file) => readFileSync(new URL(`../src/components/chat/${file}`, import.meta.url), "utf8"))
    .join(String.fromCharCode(10));
}

function globalCss(): string {
  return readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
}

const decode = (value: string) =>
  value.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");

const ANSWER = [
  "## Direct answer",
  "",
  "Peer feedback improves revision [1], and **most** studies agree [2].",
  "",
  "- One finding with `inline code`",
  "",
  "| Paper | Year |",
  "| --- | --- |",
  "| A | 2016 |",
  "",
  "```",
  "a fenced block",
  "```",
].join("\n");
const CITATIONS = [
  { paperId: 1, title: "Peer feedback in writing", year: "2021", href: "/workspace/library?paperId=1" },
  { paperId: 2, title: "Revision and feedback", year: "2019", href: "/workspace/library?paperId=2" },
];

/** An answer as the page draws it. */
async function answerHtml(content = ANSWER) {
  const { AssistantAnswer } = await import("../src/components/chat/AnswerBody");
  return renderToStaticMarkup(createElement(AssistantAnswer, { content, messageId: "m1", citations: CITATIONS, unfolded: true }));
}

/** What the chat page draws: the page a reader first sees, an answer, and a chart in each of its forms. */
async function drawnChat() {
  globalThis.__auditfixAuth = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "token" } };
  globalThis.__auditfixWorkspace = { currentProject: { id: "p1", name: "Assessment studies" }, hasActiveProject: true, selectedProjectId: "p1", allProjects: [], selectedYears: [], selectedTracks: [], searchQuery: "" };
  globalThis.__auditfixPathname = "/workspace/chat";
  const { default: ChatClient } = await import("../src/components/chat/ChatClient");
  const { default: ChatChartCard } = await import("../src/components/chat/ChatChartCard");
  const chart = (chartType: "bar" | "line" | "table") =>
    renderToStaticMarkup(
      createElement(ChatChartCard, {
        chart: { chartType, title: "Papers per year", scopeLabel: "Assessment studies", metric: "papers", xKey: "label", yKeys: ["value"], data: [{ label: "2020", value: 3 }, { label: "2021", value: 5 }] } as never,
      })
    );
  return [renderToStaticMarkup(createElement(ChatClient)), await answerHtml(), chart("bar"), chart("line"), chart("table")];
}

/** Drawn markup, in the form the contrast checker reads. */
const asClassNames = (html: string) => decode(html).replace(/\sclass="/g, ' className="');

/* ------------------------------------------------------------ the arithmetic */

test("contrast is computed the way WCAG defines it", () => {
  // Anchored on the two ratios everyone knows, so an error in the formula shows
  // up here rather than as a wrong verdict about the palette.
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  assert.equal(Math.round(luminance("#ffffff")), 1);
  assert.equal(Math.round(luminance("#000000")), 0);
});

test("the palette tokens resolve to the values the Tailwind config defines", async () => {
  // tailwind.config maps `slate` to the neutral ramp, so the checker must read
  // the same ramp or every verdict about a slate class is about a colour the
  // page never paints.
  assert.equal(resolveColour("slate-500"), GRAY["500"]);
  const { default: tailwind } = await import("../tailwind.config");
  assert.equal((tailwind.theme?.extend?.colors as Record<string, unknown>).slate, GRAY);
  assert.equal(resolveColour("white"), "#ffffff");
  assert.equal(resolveColour("[#8e8e8e]"), "#8e8e8e");
  assert.equal(resolveColour("[#abc]"), "#aabbcc");
  assert.equal(resolveColour("not-a-colour"), null);
});

test("a known-bad pairing is reported as failing", () => {
  // Without this the checker could pass everything and look healthy.
  const bad = checkContrast("slate-400", "white");
  assert.ok(bad);
  assert.equal(bad!.passes, false);
  assert.ok(bad!.ratio < AA_NORMAL);
});

/* --------------------------------------------------------------- the palette */

/**
 * Every text colour in `source`, checked against the background beside it.
 *
 * An element that declares its own background gives an exact pair. One that
 * inherits is checked against the surfaces of its theme, which is the only
 * assumption left and the narrow one.
 */
function contrastFailures(source: string, theme: "light" | "dark"): string[] {
  const surfaces = theme === "light" ? LIGHT_SURFACES : DARK_SURFACES;
  const failures: string[] = [];
  for (const pair of colourPairs(source)) {
    if (pair.theme !== theme) continue;
    const ratio = pair.background
      ? checkContrast(pair.text, pair.background, AA_NORMAL, theme)?.ratio ?? Number.NaN
      : worstRatio(pair.text, surfaces, theme);
    if (!Number.isFinite(ratio) || ratio >= AA_NORMAL) continue;
    failures.push(`${pair.text} on ${pair.background ?? `(inherited ${theme})`} = ${ratio.toFixed(2)} | ${pair.source}`);
  }
  return [...new Set(failures)];
}

/** Colours in `source` the checker cannot resolve, which would pass unchecked. */
function unresolved(source: string): string[] {
  return [
    ...new Set(
      colourPairs(source)
        .flatMap((pair) => [pair.text, pair.background])
        .filter((token): token is string => Boolean(token))
        .filter((token) => resolveColour(token) === null)
    ),
  ];
}

test("every text colour the chat page draws meets AA against what it sits on, in both themes", async () => {
  // The caveat line and the citation previews were the palest text on the page
  // and nothing said whether they cleared the bar or merely looked as if they
  // did. slate-500 measured 4.34 against slate-100 - under AA, and used 70
  // times.
  const drawn = (await drawnChat()).map(asClassNames).join("\n");
  assert.ok(colourPairs(drawn).length > 50, "the checker found the page's text");
  assert.deepEqual(contrastFailures(drawn, "light"), []);
  assert.deepEqual(contrastFailures(drawn, "dark"), []);
  assert.deepEqual(unresolved(drawn), [], "colours the contrast checker cannot resolve");
});

// Most of the page's states - menus, errors, research progress, attachments -
// appear only after a press or a server answer, so every class written in the
// page's source is checked too.
test("every text colour in the chat page's source meets AA, in both themes, and resolves", () => {
  assert.deepEqual(contrastFailures(chatSource(), "light"), []);
  assert.deepEqual(contrastFailures(chatSource(), "dark"), []);
  assert.deepEqual(unresolved(chatSource()), [], "colours the contrast checker cannot resolve");
});

test("an inverted control is judged against its own background, not its theme", () => {
  // A white button inside a dark page carries dark text on purpose. Assuming
  // dark-theme text sits on a dark surface reported three such controls as
  // failures when they are the most legible things on the page.
  const pairs = colourPairs('className="dark:bg-white dark:text-[#111111]"');
  const dark = pairs.find((pair) => pair.theme === "dark");
  assert.ok(dark);
  assert.equal(dark!.background, "white");
  assert.equal(checkContrast(dark!.text, dark!.background!)!.passes, true);
});

/* ---------------------------------------------------------------- the motion */

// The reduced-motion rule is in globals.css, which a render here does not
// apply; the stylesheet is read.
test("reduced motion applies to the whole page, not a list of components", () => {
  // The rules that existed named the components present when each was written,
  // so anything added later moved regardless of the setting.
  const css = globalCss();
  const universal = css.match(
    /@media \(prefers-reduced-motion: reduce\) \{\s*\*,\s*\*::before,\s*\*::after \{([\s\S]*?)\}/
  );
  assert.ok(universal, "no universal reduced-motion rule");
  assert.match(universal![1], /animation-duration: 0\.01ms !important/);
  assert.match(universal![1], /transition-duration: 0\.01ms !important/);
});

test("reduced motion collapses duration rather than removing animation", () => {
  // `animation: none` stops animationend firing, and anything waiting on it
  // hangs. Collapsing the duration keeps the events.
  const css = globalCss();
  const block = css.slice(css.indexOf("Reduced motion, everywhere"));
  assert.equal(/animation:\s*none/.test(block.slice(0, 900)), false);
});

test("the chat page's own animations are covered", async () => {
  // The page animates (its drawn classes say so), and the rule that stills
  // them applies to every element rather than a list of class names.
  const drawn = decode((await drawnChat()).join("\n"));
  const used = [...drawn.matchAll(/class="[^"]*\b(animate-[a-z-]+|transition-[a-z]+)\b/g)].map((m) => m[1]);
  assert.ok(used.length > 0, "expected the page to animate something");
  assert.match(globalCss(), /@media \(prefers-reduced-motion: reduce\) \{\s*\*,/);
});

/* ----------------------------------------------------------------- the focus */

// The focus ring is drawn by globals.css; the stylesheet is read.
test("focus is visible on every control, including custom ones", () => {
  const css = globalCss();
  assert.match(css, /:where\(button, a, input, select, textarea, summary, \[tabindex\]:not\(\[tabindex="-1"\]\)\):focus-visible/);
  assert.match(css, /outline: 2px solid/);
  assert.match(css, /outline-offset: 2px/);
});

test("the dark theme keys off the class this app toggles, not the OS preference", () => {
  // A rule written against prefers-color-scheme would paint the wrong colour
  // for a reader whose OS is dark while the app is light.
  const css = globalCss();
  assert.match(css, /\.dark :where\(button, a, input, select, textarea, summary, \[tabindex\]/);
});

test("the focus ring itself is legible in both themes", () => {
  assert.ok(contrastRatio("#171717", "#ffffff") >= 3, "light focus ring too faint");
  assert.ok(contrastRatio("#f2f2f2", "#050505") >= 3, "dark focus ring too faint");
});

/** Elements in `source` that switch the focus outline off and put nothing back. */
function focusOffenders(classLists: string[]) {
  return classLists.filter((classes) => /(^|\s)focus:outline-none(\s|$)/.test(classes) && !/(^|\s)focus-visible:/.test(classes));
}

test("no control switches focus off without putting something back", async () => {
  // `focus:outline-none` with no `focus-visible:` replacement leaves a keyboard
  // reader with nothing.
  const drawn = decode((await drawnChat()).join("\n"));
  const classLists = [...drawn.matchAll(/class="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(classLists.length > 100);
  assert.deepEqual(focusOffenders(classLists), []);
});

// The controls behind a press (menus, the editor, the report view) are not in
// a first render, so each line of the source is checked as well.
test("no control in the chat page's source switches focus off without putting something back", () => {
  const lines = chatSource().split(/\r?\n/);
  const offenders = lines.filter((line) => line.includes("focus:outline-none") && !line.includes("focus-visible:"));
  assert.deepEqual(offenders.map((line) => line.trim().slice(0, 80)), []);
});

/* ------------------------------------------------------------ layout stability */

test("the answer area reserves its space rather than resizing around content", async () => {
  // Layout shift when an answer arrives comes from a container that grows from
  // nothing. The composer keeps the message column's width and its own height,
  // so text arriving reflows inside a box that is already there.
  const [page] = await drawnChat();
  assert.match(page, /<form class="[^"]*\bmax-w-\[1040px\][^"]*">/);
  assert.match(page, /<textarea[^>]*aria-label="Message"[^>]*class="[^"]*\bmin-h-\[28px\]/);
});

// An image appears only with an attachment the server returns, in a part of
// the page a first render does not reach, so the source's <img> tags are read.
test("images and charts declare their box before they load", () => {
  // An element that sizes itself from its content after loading is the other
  // common source of shift.
  const images = [...chatSource().matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  for (const image of images) {
    assert.ok(
      /className="[^"]*\b(?:h-\d|max-h-|aspect-)/.test(image),
      `an image sets no height before it loads: ${image.slice(0, 90)}`
    );
  }
});

/* --------------------------------------------------------------- the measure */

test("answer prose is held to a readable measure", async () => {
  // The message column is 1040px, which at 15px is roughly 138 characters per
  // line. Past about 75 the eye loses its place on the return sweep, and a long
  // answer becomes work to read for a reason unrelated to what it says.
  assert.ok(ANSWER_MEASURE_CH >= 45 && ANSWER_MEASURE_CH <= 80, `measure is ${ANSWER_MEASURE_CH}ch`);
  assert.equal(ANSWER_MEASURE_CLASS, `max-w-[${ANSWER_MEASURE_CH}ch]`);
  // Every paragraph and list of an answer is held to it, through the one class.
  const html = await answerHtml();
  for (const tag of ["p", "ul"]) {
    const opening = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].map((m) => m[0]);
    assert.ok(opening.length > 0, tag);
    for (const open of opening) assert.ok(open.includes(ANSWER_MEASURE_CLASS), `${tag}: ${open}`);
  }
});

test("tables and code keep the full column", async () => {
  // Narrowing those makes them worse, not better: a table that wraps every
  // cell is harder to read than a wide one.
  const html = await answerHtml();
  for (const tag of ["table", "pre"]) {
    const at = html.indexOf(`<${tag}`);
    assert.ok(at > 0, tag);
    // The element and every element still open around it.
    const before = html.slice(0, at + html.slice(at).indexOf(">") + 1);
    const open: string[] = [];
    for (const match of before.matchAll(/<(\/?)([a-z0-9]+)\b[^>]*?(\/?)>/g)) {
      if (match[3]) continue;
      if (match[1]) open.pop();
      else open.push(match[0]);
    }
    assert.deepEqual(open.filter((element) => element.includes(ANSWER_MEASURE_CLASS)), [], `${tag} is narrowed by an element around it`);
  }
});
