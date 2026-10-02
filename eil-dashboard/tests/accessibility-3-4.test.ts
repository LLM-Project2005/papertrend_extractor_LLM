import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { categoricalColor, CATEGORICAL_PALETTE, ordinalColor, ORDINAL_RAMP } from "../src/lib/chart-palette";
import { categoryColor } from "../src/lib/category-options";

/** Accessibility fixes from the audit (docs/32, 3.4). Contrast is in contrast-all.test.ts. */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every chart that opens papers on a click has a keyboard path to the same papers", () => {
  // Each chart's bars or slices are mouse-only; beside each sits a list of its
  // values, each a button opening what its bar opens (DASH-3, A11Y-4).
  const expectations: Array<[string, number]> = [
    ["src/components/tabs/Overview.tsx", 2],
    ["src/components/tabs/TrendAnalysis.tsx", 2],
    ["src/components/tabs/TrackAnalysis.tsx", 2],
    ["src/components/tabs/KeywordExplorer.tsx", 1],
  ];
  for (const [file, lists] of expectations) {
    const source = read(file);
    assert.equal((source.match(/<ChartValues\b/g) ?? []).length, lists, file);
    assert.match(source, /onSelect: onDrilldown\s*\?\s*\(\) => onDrilldown\(/, file);
  }
  const values = read("src/components/tabs/ChartValues.tsx");
  assert.match(values, /<details className="group mt-3">/);
  assert.match(values, /<button\s+type="button"\s+onClick=\{item\.onSelect\}/);
});

test("the PDF's text can be selected and searched, and the page counter is quiet", () => {
  const viewer = read("src/components/workspace/PdfViewer.tsx");
  assert.match(viewer, /new pdfjs\.TextLayer\(\{\s*textContentSource: page\.streamTextContent\(\),\s*container,/);
  assert.match(viewer, /<div ref=\{textLayerRef\} className="textLayer" \/>/);
  assert.match(viewer, /\["--scale-factor" as string\]: scale/);
  assert.doesNotMatch(viewer, /aria-live="polite">\s*\{doc \? `Page/, "the counter is not read out on every scroll");
  const css = read("src/app/globals.css");
  assert.match(css, /\.textLayer :is\(span, br\) \{\s*color: transparent;/);
});

test("search is a combobox the arrow keys move through (SHELL-8)", () => {
  const search = read("src/components/workspace/WorkspaceGlobalSearch.tsx");
  assert.match(search, /role="combobox"/);
  assert.match(search, /aria-activedescendant=\{shownResults\.length > 0 \? optionId\(activeIndex\) : undefined\}/);
  assert.match(search, /role="listbox"/);
  assert.match(search, /role="option"\s+aria-selected=\{active\}/);
  assert.match(search, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(search, /const chosen = shownResults\[activeIndex\] \?\? shownResults\[0\];/);
});

test("the Library and chat say which menus are open and which choices are on (LIB-11, A11Y-7, CHAT-10)", () => {
  const library = read("src/components/admin/AdminImportClient.tsx");
  assert.match(library, /aria-expanded=\{toolbarPopover\?\.kind === kind\}/);
  assert.match(library, /aria-expanded=\{toolbarPopover\?\.kind === "sort"\}/);
  assert.equal((library.match(/aria-expanded=\{itemMenuState\?\.item\.id === item\.id\}/g) ?? []).length, 2);
  assert.equal((library.match(/aria-pressed=\{item\.favorite\}/g) ?? []).length, 2);
  assert.match(library, /aria-pressed=\{viewMode === "list"\}/);
  assert.match(library, /aria-label=\{sortLabel\("Name", "name"\)\}/);
  assert.match(library, /sorted \$\{sortDirection === "asc" \? "ascending" : "descending"\}/);
  assert.match(read("src/components/chat/ChatClient.tsx"), /aria-pressed=\{item\.active\}/);
});

test("chart colours go by position, never by a hash, and years by order (A11Y-5)", () => {
  assert.equal(CATEGORICAL_PALETTE.length, 8);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(categoricalColor), [...CATEGORICAL_PALETTE]);
  // Five custom categories: five different colours, whatever their names.
  const colours = ["alpha", "beta", "gamma", "delta", "epsilon"].map((key, index) => categoryColor(key, index));
  assert.equal(new Set(colours).size, 5);
  assert.equal(categoryColor("anything", 2), CATEGORICAL_PALETTE[2]);
  assert.equal(ordinalColor(0, 10), ORDINAL_RAMP[0]);
  assert.equal(ordinalColor(9, 10), ORDINAL_RAMP[ORDINAL_RAMP.length - 1]);
  assert.doesNotMatch(read("src/lib/category-options.ts"), /charCodeAt/);
  assert.doesNotMatch(read("tailwind.config.ts"), /track: \{/, "the unused copy of the track colours is gone");
});
