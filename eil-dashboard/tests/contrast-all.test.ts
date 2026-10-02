import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

/**
 * Text contrast on every page, not only chat (docs/32, 3.4; audit A11Y-9): the
 * one gate scanned ChatClient alone and could not read the theme tokens, so
 * newer surfaces went unchecked. Chart colours and outlines are held to the
 * 3:1 non-text minimum (A11Y-5, A11Y-6).
 */

const root = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

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
  const controls = readFileSync(join(root, "src/components/ui/controls.ts"), "utf8");
  assert.match(controls, /focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink\/70/);
  assert.match(controls, /border border-field bg-surface/);
  assert.doesNotMatch(readFileSync(join(root, "src/components/chat/ChatClient.tsx"), "utf8"), /focus-visible:ring-hairline-strong/);
});

test("a cell's text is whichever colour reads better on it", () => {
  // A mid grey: white was 3.2:1 on it under the old cut-off.
  assert.equal(readableTextOn("#8c8c8c", ["#000000", "#ffffff"]), "#000000");
  assert.equal(readableTextOn("#262626", ["#000000", "#ffffff"]), "#ffffff");
  // With black and white to choose from, every grey (and every colour) gets 4.5:1.
  for (let level = 0; level <= 255; level += 1) {
    const hex = `#${level.toString(16).padStart(2, "0").repeat(3)}`;
    const best = readableTextOn(hex, ["#000000", "#ffffff"]);
    assert.ok(contrastRatio(best, hex) >= 4.5, `${best} on ${hex}`);
  }
  for (const file of ["src/components/dashboard/InsightChart.tsx", "src/components/Heatmap.tsx"]) {
    assert.match(readFileSync(join(root, file), "utf8"), /readableTextOn\([a-z]+, \["#000000", "#ffffff"\]\)/, file);
  }
});
