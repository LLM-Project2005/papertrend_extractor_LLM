import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import test from "node:test";
import React, { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Phosphor from "@phosphor-icons/react/dist/ssr";
import * as glyphs from "../src/components/ui/icon-glyphs";

/** Icons draw exactly what Phosphor drew, in the weights the app uses, and nothing else (docs/32, 3.3). */

// Every module Icons.tsx asks for as it loads, recorded before it is first imported below.
const iconsAsked: string[] = [];
(nodeModule as unknown as { registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (specifier: string, context: object) => unknown): unknown }): void }).registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.includes("/src/components/ui/Icons")) iconsAsked.push(specifier);
    return next(specifier, context);
  },
});
(globalThis as { React?: typeof React }).React = React;
const icons = () => import("../src/components/ui/Icons");

const inner = (markup: string) => markup.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
type Kept = Record<string, ReadonlyArray<readonly [string, Record<string, unknown>]>>;
const drawing = (kept: Kept, weight: string) => kept[weight].map(([tag, props], index) => renderToStaticMarkup(createElement(tag, { key: index, ...props }))).join("");
const glyphNames = () => Object.keys(glyphs).filter((key) => key.endsWith("Glyph"));

test("every kept icon draws Phosphor's own paths in each weight", () => {
  const names = glyphNames();
  assert.ok(names.length >= 80);
  for (const name of names) {
    const phosphor = (Phosphor as unknown as Record<string, ComponentType<{ weight?: string }>>)[name.replace(/Glyph$/, "Icon")];
    assert.ok(phosphor, `${name} has a Phosphor icon`);
    const kept = (glyphs as unknown as Record<string, Kept>)[name];
    for (const weight of ["regular", "bold", "fill"] as const) {
      const expected = inner(renderToStaticMarkup(createElement(phosphor, { weight })));
      assert.equal(drawing(kept, weight), expected, `${name} ${weight}`);
    }
  }
});

test("every kept icon is drawn by some icon the app uses, and the icons draw from the kept ones only", async () => {
  const exported = Object.entries(await icons()).filter(([, value]) => typeof value === "function") as Array<[string, ComponentType<{ weight?: string }>]>;
  assert.ok(exported.length >= 80);
  const drawn = new Set(exported.flatMap(([, Icon]) => (["regular", "bold", "fill"] as const).map((weight) => inner(renderToStaticMarkup(createElement(Icon, { weight }))))));
  const unused = glyphNames().filter((name) => !(["regular", "bold", "fill"] as const).some((weight) => drawn.has(drawing((glyphs as unknown as Record<string, Kept>)[name], weight))));
  assert.deepEqual(unused, [], "run node scripts/generate-icons.mjs");
  assert.ok(iconsAsked.includes("./icon-glyphs"), iconsAsked.join(", "));
  assert.deepEqual(iconsAsked.filter((specifier) => specifier.startsWith("@phosphor-icons")), [], "Icons.tsx draws from the kept glyphs only");
});

test("an icon renders as before: an inline, hidden, currentColor SVG at 1em", async () => {
  const { HomeIcon, SpinnerIcon, StarIcon } = await icons();
  const home = renderToStaticMarkup(createElement(HomeIcon, { className: "h-4 w-4" }));
  assert.match(home, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true" focusable="false" class="h-4 w-4">/);
  assert.notEqual(
    renderToStaticMarkup(createElement(StarIcon, { weight: "fill" })),
    renderToStaticMarkup(createElement(StarIcon, {})),
    "the fill weight is a different drawing"
  );
  assert.match(renderToStaticMarkup(createElement(SpinnerIcon, { className: "h-3 w-3" })), /class="animate-spin motion-reduce:animate-none h-3 w-3"/);
});
