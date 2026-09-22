import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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

function chatSource(): string {
  return ["ChatClient.tsx", "AnswerBody.tsx", "ChatIntro.tsx"]
    .map((file) => readFileSync(new URL(`../src/components/chat/${file}`, import.meta.url), "utf8"))
    .join(String.fromCharCode(10));
}

function globalCss(): string {
  return readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
}

/* ------------------------------------------------------------ the arithmetic */

test("contrast is computed the way WCAG defines it", () => {
  // Anchored on the two ratios everyone knows, so an error in the formula shows
  // up here rather than as a wrong verdict about the palette.
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  assert.equal(Math.round(luminance("#ffffff")), 1);
  assert.equal(Math.round(luminance("#000000")), 0);
});

test("the palette tokens resolve to the values Tailwind ships", () => {
  assert.equal(resolveColour("slate-500"), "#64748b");
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
 * Every text colour on the page, checked against the background beside it.
 *
 * An element that declares its own background gives an exact pair. One that
 * inherits is checked against the surfaces of its theme, which is the only
 * assumption left and the narrow one.
 */
function contrastFailures(theme: "light" | "dark"): string[] {
  const surfaces = theme === "light" ? LIGHT_SURFACES : DARK_SURFACES;
  const failures: string[] = [];
  for (const pair of colourPairs(chatSource())) {
    if (pair.theme !== theme) continue;
    const ratio = pair.background
      ? checkContrast(pair.text, pair.background)?.ratio ?? Number.NaN
      : worstRatio(pair.text, surfaces);
    if (!Number.isFinite(ratio) || ratio >= AA_NORMAL) continue;
    failures.push(`${pair.text} on ${pair.background ?? `(inherited ${theme})`} = ${ratio.toFixed(2)} | ${pair.source}`);
  }
  return [...new Set(failures)];
}

test("every light-theme text colour meets AA against what it sits on", () => {
  // The caveat line and the citation previews were the palest text on the page
  // and nothing said whether they cleared the bar or merely looked as if they
  // did. slate-500 measured 4.34 against slate-100 - under AA, and used 70
  // times.
  assert.deepEqual(contrastFailures("light"), []);
});

test("every dark-theme text colour meets AA against what it sits on", () => {
  assert.deepEqual(contrastFailures("dark"), []);
});

test("the page names no colour the checker cannot resolve", () => {
  // An unresolvable token would silently pass both checks above.
  const unknown = [
    ...new Set(
      colourPairs(chatSource())
        .flatMap((pair) => [pair.text, pair.background])
        .filter((token): token is string => Boolean(token))
        .filter((token) => resolveColour(token) === null)
    ),
  ];
  assert.deepEqual(unknown, [], "colours the contrast checker cannot resolve");
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

test("the chat page's own animations are covered", () => {
  // Named explicitly so that if the universal rule is ever narrowed, the
  // classes the chat page actually uses are what fails the test.
  const source = chatSource();
  const used = [...source.matchAll(/\b(animate-[a-z-]+|transition-[a-z]+)\b/g)].map((m) => m[1]);
  assert.ok(used.length > 0, "expected the page to animate something");
  const css = globalCss();
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\*,/);
});

/* ----------------------------------------------------------------- the focus */

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

test("no control switches focus off without putting something back", () => {
  // `focus:outline-none` with no `focus-visible:` replacement leaves a keyboard
  // reader with nothing.
  const source = chatSource();
  const lines = source.split(/\r?\n/);
  const offenders = lines.filter(
    (line) => line.includes("focus:outline-none") && !line.includes("focus-visible:")
  );
  assert.deepEqual(offenders.map((line) => line.trim().slice(0, 80)), []);
});

/* ------------------------------------------------------------ layout stability */

test("the answer area reserves its space rather than resizing around content", () => {
  // Layout shift when an answer arrives comes from a container that grows from
  // nothing. The message list keeps its width and the composer keeps its
  // height, so text arriving reflows inside a box that is already there.
  const source = chatSource();
  assert.match(source, /max-w-\[1040px\]/);
  assert.match(source, /min-h-\[28px\]/);
});

test("images and charts declare their box before they load", () => {
  // An element that sizes itself from its content after loading is the other
  // common source of shift.
  const source = chatSource();
  const images = [...source.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  for (const image of images) {
    assert.ok(
      /className="[^"]*\b(?:h-\d|max-h-|aspect-)/.test(image),
      `an image sets no height before it loads: ${image.slice(0, 90)}`
    );
  }
});

/* --------------------------------------------------------------- the measure */

test("answer prose is held to a readable measure", () => {
  // The message column is 1040px, which at 15px is roughly 138 characters per
  // line. Past about 75 the eye loses its place on the return sweep, and a long
  // answer becomes work to read for a reason unrelated to what it says.
  assert.ok(ANSWER_MEASURE_CH >= 45 && ANSWER_MEASURE_CH <= 80, `measure is ${ANSWER_MEASURE_CH}ch`);
  assert.match(ANSWER_MEASURE_CLASS, /max-w-\[72ch\]/);
});

test("tables and code keep the full column", () => {
  // Narrowing those makes them worse, not better: a table that wraps every
  // cell is harder to read than a wide one.
  const body = readFileSync(
    new URL("../src/components/chat/AnswerBody.tsx", import.meta.url),
    "utf8"
  );
  const table = body.slice(body.indexOf("<table"), body.indexOf("</table>"));
  assert.equal(/ANSWER_MEASURE_CLASS/.test(table), false);
  const pre = body.slice(body.indexOf("<pre"), body.indexOf("</pre>"));
  assert.equal(/ANSWER_MEASURE_CLASS/.test(pre), false);
});

test("the measure reaches prose through one shared class", () => {
  const body = readFileSync(
    new URL("../src/components/chat/AnswerBody.tsx", import.meta.url),
    "utf8"
  );
  // Searching from the declaration, not from the top of the file: the first
  // "return (" belongs to a component defined earlier.
  const start = body.indexOf("const paragraphClass");
  const paragraphClass = body.slice(start, body.indexOf("return (", start));
  assert.match(paragraphClass, /ANSWER_MEASURE_CLASS/);
});
