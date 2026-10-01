import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Phosphor from "@phosphor-icons/react/dist/ssr";
import * as glyphs from "../src/components/ui/icon-glyphs";
import { HomeIcon, SpinnerIcon, StarIcon } from "../src/components/ui/Icons";

/** Icons draw exactly what Phosphor drew, in the weights the app uses, and nothing else (docs/32, 3.3). */

const inner = (markup: string) => markup.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");

test("every kept icon draws Phosphor's own paths in each weight", () => {
  const names = Object.keys(glyphs).filter((key) => key.endsWith("Glyph"));
  assert.ok(names.length >= 80);
  for (const name of names) {
    const phosphor = (Phosphor as unknown as Record<string, ComponentType<{ weight?: string }>>)[name.replace(/Glyph$/, "Icon")];
    assert.ok(phosphor, `${name} has a Phosphor icon`);
    const kept = (glyphs as unknown as Record<string, Record<string, ReadonlyArray<readonly [string, Record<string, unknown>]>>>)[name];
    for (const weight of ["regular", "bold", "fill"] as const) {
      const expected = inner(renderToStaticMarkup(createElement(phosphor, { weight })));
      const drawn = kept[weight].map(([tag, props], index) => renderToStaticMarkup(createElement(tag, { key: index, ...props }))).join("");
      assert.equal(drawn, expected, `${name} ${weight}`);
    }
  }
});

test("the kept icons are exactly the ones Icons.tsx uses", () => {
  const icons = readFileSync(new URL("../src/components/ui/Icons.tsx", import.meta.url), "utf8");
  const block = icons.match(/import \{([^}]*)\} from "\.\/icon-glyphs";/)?.[1] ?? "";
  const imported = block.split(",").map((part) => part.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean).sort();
  const generated = Object.keys(glyphs).filter((key) => key.endsWith("Glyph")).sort();
  assert.deepEqual(generated, [...new Set(imported)], "run node scripts/generate-icons.mjs");
  assert.doesNotMatch(icons, /@phosphor-icons\/react/, "Icons.tsx draws from the kept glyphs only");
});

test("an icon renders as before: an inline, hidden, currentColor SVG at 1em", () => {
  const home = renderToStaticMarkup(createElement(HomeIcon, { className: "h-4 w-4" }));
  assert.match(home, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true" focusable="false" class="h-4 w-4">/);
  assert.notEqual(
    renderToStaticMarkup(createElement(StarIcon, { weight: "fill" })),
    renderToStaticMarkup(createElement(StarIcon, {})),
    "the fill weight is a different drawing"
  );
  assert.match(renderToStaticMarkup(createElement(SpinnerIcon, { className: "h-3 w-3" })), /class="animate-spin motion-reduce:animate-none h-3 w-3"/);
});
