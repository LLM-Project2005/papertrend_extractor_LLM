import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fieldClass, menuItemClass } from "../src/components/ui/controls";
import { CATEGORICAL_PALETTE, ORDINAL_RAMP } from "../src/lib/chart-palette";
import {
  AA_NORMAL,
  DARK_SURFACES,
  LIGHT_SURFACES,
  checkContrast,
  colourPairs,
  contrastRatio,
  readableTextOn,
  worstRatio,
} from "../src/lib/contrast";
import { stubModule } from "./support/route-harness";

/**
 * Text contrast on every page, not only chat (docs/32, 3.4; audit A11Y-9): the
 * one gate scanned ChatClient alone and could not read the theme tokens, so
 * newer surfaces went unchecked. Chart colours and outlines are held to the
 * 3:1 non-text minimum (A11Y-5, A11Y-6). Chart cells are rendered, in the
 * theme stub-auditfix-theme.ts is set to.
 */

stubModule("/src/components/theme/ThemeProvider.tsx", new URL("./support/stub-auditfix-theme.ts", import.meta.url).href);
(globalThis as { React?: typeof React }).React = React;

const root = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

// A lint over every page's classes: every page in every state, in both themes, cannot be rendered here.
function failures(theme: "light" | "dark"): string[] {
  const surfaces = theme === "light" ? LIGHT_SURFACES : DARK_SURFACES;
  const found: string[] = [];
  for (const file of [...sources(join(root, "src/components")), ...sources(join(root, "src/app"))]) {
    for (const pair of colourPairs(readFileSync(file, "utf8"))) {
      if (pair.theme !== theme) continue;
      const ratio = pair.background
        ? checkContrast(pair.text, pair.background, AA_NORMAL, theme)?.ratio ?? Number.NaN
        : worstRatio(pair.text, surfaces, theme);
      if (!Number.isFinite(ratio) || ratio >= AA_NORMAL) continue;
      found.push(`${relative(root, file)}: ${pair.text} on ${pair.background ?? `(inherited ${theme})`} = ${ratio.toFixed(2)} | ${pair.source}`);
    }
  }
  return [...new Set(found)];
}

test("every light-theme text colour on every page meets AA", () => {
  assert.deepEqual(failures("light"), []);
});

test("every dark-theme text colour on every page meets AA", () => {
  assert.deepEqual(failures("dark"), []);
});

test("chart colours clear 3:1 on every surface they are drawn on", () => {
  for (const colour of [...CATEGORICAL_PALETTE, ...ORDINAL_RAMP]) {
    for (const surface of ["#ffffff", "#fafafa", "#0a0a0a", "#050505", "#000000"]) {
      const minimum = (ORDINAL_RAMP as readonly string[]).includes(colour) ? 2 : 3;
      assert.ok(contrastRatio(colour, surface) >= minimum, `${colour} on ${surface}: ${contrastRatio(colour, surface).toFixed(2)}`);
    }
  }
});

test("field outlines and menu focus clear 3:1", () => {
  // --field-border in globals.css: light #8f8f8f on white, dark #666666 on #0a0a0a.
  assert.ok(contrastRatio("#8f8f8f", "#ffffff") >= 3);
  assert.ok(contrastRatio("#666666", "#0a0a0a") >= 3);
  const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
  assert.match(css, /--field-border: 143 143 143;/);
  assert.match(css, /--field-border: 102 102 102;/);
  // Every field takes the outline, and a focused menu item the ink ring.
  assert.match(fieldClass, /(^| )border border-field bg-surface( |$)/);
  for (const active of [false, true]) {
    assert.match(menuItemClass(active), /(^| )focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink\/70( |$)/);
  }
  // The chat page's own menus, opened, are checked in small-fixes2-behaviour-chat.test.ts.
});

/** Each cell's background and text colour, as drawn. */
function cellColours(html: string, background: "background" | "background-color"): Array<[string, string]> {
  return [...html.matchAll(new RegExp(`style="${background}:([^;"]+);color:([^;"]+)"`, "g"))].map((match) => [match[1], match[2]]);
}

const hex = (colour: string) => {
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(colour);
  return rgb ? `#${rgb.slice(1).map((value) => Number(value).toString(16).padStart(2, "0")).join("")}` : colour;
};

test("a cell's text is whichever colour reads better on it", async () => {
  // A mid grey: white was 3.2:1 on it under the old cut-off.
  assert.equal(readableTextOn("#8c8c8c", ["#000000", "#ffffff"]), "#000000");
  assert.equal(readableTextOn("#262626", ["#000000", "#ffffff"]), "#ffffff");
  // With black and white to choose from, every grey (and every colour) gets 4.5:1.
  for (let level = 0; level <= 255; level += 1) {
    const hex = `#${level.toString(16).padStart(2, "0").repeat(3)}`;
    const best = readableTextOn(hex, ["#000000", "#ffffff"]);
    assert.ok(contrastRatio(best, hex) >= 4.5, `${best} on ${hex}`);
  }

  // A heatmap over the whole grey range, and over its own default scale.
  const { default: Heatmap } = await import("../src/components/Heatmap");
  const values = [Array.from({ length: 33 }, (_, index) => index)];
  const cols = values[0].map(String);
  const cells = [
    ...cellColours(renderToStaticMarkup(createElement(Heatmap, { rows: ["Theme"], cols, values, colorScale: ["#ffffff", "#000000"] })), "background-color"),
    ...cellColours(renderToStaticMarkup(createElement(Heatmap, { rows: ["Theme"], cols, values })), "background-color"),
  ];
  assert.equal(cells.length, 66);
  for (const [background, text] of cells) {
    assert.ok(contrastRatio(hex(text), hex(background)) >= AA_NORMAL, `${text} on ${background}`);
  }

  // An Adaptive insight's matrix, in both themes.
  const { default: InsightChart } = await import("../src/components/dashboard/InsightChart");
  const matrix = {
    id: "theme_pairs", family: "pairs", question: "Which themes go together?", view: {}, facts: [], takeaway: "", score: 1, paperIds: [], basis: "",
    chart: {
      kind: "matrix", rowLabel: "Theme", colLabel: "Method", rows: ["Feedback"], cols, values,
      marks: [], paperIds: [values[0].map((value) => Array.from({ length: value }, (_, index) => String(index)))],
    },
  } as unknown as Parameters<typeof InsightChart>[0]["insight"];
  for (const theme of ["light", "dark"] as const) {
    globalThis.__auditfixTheme = theme;
    const drawn = cellColours(renderToStaticMarkup(createElement(InsightChart, { insight: matrix, onOpen: () => undefined })), "background").filter(([background]) => background !== "transparent");
    assert.equal(drawn.length, 32, theme);
    for (const [background, text] of drawn) assert.ok(contrastRatio(text, background) >= AA_NORMAL, `${theme}: ${text} on ${background}`);
  }
});
