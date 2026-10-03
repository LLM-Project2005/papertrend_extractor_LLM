/*
 * Map node labels: shortened for the canvas, whole everywhere else. The label
 * rule and the free graph run; the projection view (RepositorySemanticMap)
 * loads its map with fetch in an effect and draws it with React Flow, so it
 * needs a browser and its checks stay as text.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NODE_LABEL_MAX_CHARS, nodeLabel } from "../src/lib/semantic-map-presentation";
import type { SemanticMapPoint } from "../src/types/semantic-map";

function source(file: string): string {
  return readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
}

// The graph has no `import React` of its own; classic JSX finds this one.
(globalThis as { React?: typeof React }).React = React;

async function forceGraphMarkup(points: SemanticMapPoint[], showLabels: boolean): Promise<string> {
  const { default: ForceDirectedSemanticGraph } = await import("../src/components/workspace/ForceDirectedSemanticGraph");
  const error = console.error;
  // The server renderer's warning about the tooltip <title> (see the full-title test below).
  console.error = (...args: unknown[]) => void (String(args[0]).includes("prop of <title> tags") || error(...args));
  try {
    return renderToStaticMarkup(createElement(ForceDirectedSemanticGraph, {
      points, edges: [], colors: {}, dimmedPaperIds: new Set<string>(), selectedPaperIds: new Set<string>(),
      selectedEdgeId: null, running: false, resetVersion: 0, showLabels, onPaperSelect: () => {}, onEdgeSelect: () => {},
    }));
  } finally {
    console.error = error;
  }
}

function point(paperId: string, title: string): SemanticMapPoint {
  return {
    paperId, runId: null, folderId: null, x: 300, y: 300, clusterId: 0, title, year: "2019",
    folderName: null, categories: [], topics: [], keywords: [], track: null,
  };
}

/* ------------------------------------------------------------- the label itself */

test("a long title is shortened to something a map node can carry", () => {
  // Measured on the live map: the longest rendered label was 199 characters and
  // the median 117, every one past 60. At 10px in a 220px box that wraps to six
  // or seven lines, so the label block was several times the size of the dot it
  // belonged to.
  const real =
    "ปรากฎร่วมเชิงวิชาการสำหรับนิสิตระดับบัณฑิตศึกษาที่เรียนภาษาอังกฤษในฐานะภาษาต่างประเทศ " +
    "APPLYING A RASCH-BASED ARGUMENT APPROACH TO THE VALIDATION OF THE ACADEMIC " +
    "COLLOCATIONAL COMPETENCE TEST FOR EFL STUDENTS";
  const label = nodeLabel(real);
  assert.ok(label.length <= NODE_LABEL_MAX_CHARS + 1, `label was ${label.length} characters`);
  assert.match(label, /…$/);
});

test("a title that already fits is left exactly as it is", () => {
  const short = "Rhythmical Patterns in Thai Learners";
  assert.equal(nodeLabel(short), short);
  assert.equal(/…/.test(nodeLabel(short)), false);
});

test("a title is cut at a word boundary when that keeps most of the budget", () => {
  const title = "Effects of Personal Intelligence Reading Instruction on personal intelligence profiles";
  const label = nodeLabel(title);
  // Not mid-word.
  assert.equal(/\w…$/.test(label) && !title.startsWith(label.slice(0, -1)), false);
  assert.ok(title.startsWith(label.slice(0, -1).trimEnd()));
});

test("a Thai title is cut by characters, because it has no spaces to cut at", () => {
  // Splitting on spaces does not split Thai at all, so a word-boundary rule
  // alone would keep the whole title.
  const thai = "การพัฒนาความสามารถในการอ่านภาษาอังกฤษของนักเรียนไทยระดับมัธยมศึกษาตอนปลายโดยใช้กลวิธีการอ่านแบบร่วมมือ";
  const label = nodeLabel(thai);
  assert.ok(label.length <= NODE_LABEL_MAX_CHARS + 1, `Thai label was ${label.length} characters`);
  assert.match(label, /…$/);
});

test("runs of whitespace do not inflate the length", () => {
  assert.equal(nodeLabel("  A   B  "), "A B");
});

test("an empty or missing title does not produce an ellipsis on its own", () => {
  assert.equal(nodeLabel(""), "");
  assert.equal(nodeLabel("   "), "");
});

test("the budget is small enough to fit a map node, not a paragraph", () => {
  // Two lines at 10px in a 168px box is about 60 characters; more than that and
  // the label is a paragraph pinned to a dot.
  assert.ok(NODE_LABEL_MAX_CHARS <= 60, `${NODE_LABEL_MAX_CHARS} is too generous for a node`);
  assert.ok(NODE_LABEL_MAX_CHARS >= 30, `${NODE_LABEL_MAX_CHARS} leaves nothing recognisable`);
});

/* ------------------------------------------------------ both views use it */

// Text: the projection view needs a browser (see the header).
test("the projection view shortens its node labels", () => {
  const map = source("components/workspace/RepositorySemanticMap.tsx");
  assert.match(map, /label: showPaperLabels \? nodeLabel\(point\.title\) : ""/);
  // And the box no longer reserves room for seven lines.
  assert.match(map, /w-\[168px\]/);
  assert.equal(/w-\[220px\]/.test(map), false);
});

test("the force graph shortens its node labels too, and shows them only when labels are on", async () => {
  const title = "Effects of Personal Intelligence Reading Instruction on the personal intelligence profiles of Thai undergraduates";
  assert.notEqual(nodeLabel(title), title, "the title must be long enough to be shortened");
  const shown = await forceGraphMarkup([point("1", title)], true);
  const boxes = [...shown.matchAll(/<foreignObject\b([^>]*)>([\s\S]*?)<\/foreignObject>/g)];
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0][2].replace(/<[^>]+>/g, ""), nodeLabel(title));
  assert.match(boxes[0][1], / height="48"/);
  const hidden = await forceGraphMarkup([point("1", title)], false);
  assert.equal(hidden.includes("<foreignObject"), false);
});

test("the full title is never lost, only the label is shortened", () => {
  // A reader who wants the whole title hovers the node, opens the paper list,
  // or selects it - all three still carry it in full.
  const map = source("components/workspace/RepositorySemanticMap.tsx");
  assert.match(map, /title=\{node\.title\}/, "the node tooltip must keep the full title");
  assert.match(map, /ariaLabel: `\$\{point\.title\}/, "the accessible name must keep the full title");
  // Text, not a render: React's server renderer empties a <title> with several
  // children, which the browser (the graph is client-only) renders as text.
  const graph = source("components/workspace/ForceDirectedSemanticGraph.tsx");
  assert.match(graph, /<title>\{point\.title\} \(\{point\.year\}\)<\/title>/);
});

/* ------------------------------------------------------------- the panel */

// The panel, the edges and the minimap are the projection view's: text, as above.

test("a neighborhood label is clamped rather than running down the panel", () => {
  const map = source("components/workspace/RepositorySemanticMap.tsx");
  assert.match(map, /line-clamp-2[^>]*title=\{cluster\.label\}/);
  // `block` sets display and defeats line-clamp, which needs -webkit-box.
  // With both present the label still ran to three lines on the live panel.
  const labelTag = map.slice(map.indexOf("line-clamp-2") - 40, map.indexOf("line-clamp-2") + 20);
  assert.equal(/block/.test(labelTag), false, "a display utility is overriding the clamp");
});

test("one neighborhood is explained rather than left looking broken", () => {
  // Colouring by neighborhood when there is only one paints every paper the
  // same colour, and nothing said so: the control appears not to work.
  const map = source("components/workspace/RepositorySemanticMap.tsx");
  assert.match(map, /map\.clusters\.length === 1 \?/);
  assert.match(map, /did not separate into distinct neighborhoods/);
});

test("relationship lines are legible rather than hairlines", () => {
  // They carry the meaning of the map and sat at 1.1px and half opacity
  // against white.
  const map = source("components/workspace/RepositorySemanticMap.tsx");
  assert.match(map, /strokeWidth: isFocused \? 3 : highlighted \? 2\.4 : 1\.6 \+ strength \* 0\.9/);
  assert.match(map, /opacity: isFocused \? 1 : highlighted \? 0\.92 : muted \? 0\.18 : 0\.68 \+ strength \* 0\.22/);
});

test("the minimap shows which part of the map you are looking at", () => {
  // The mask is the whole point of a minimap: at 8% opacity it was invisible,
  // so the panel showed dots and told the reader nothing about where they were.
  const map = source("components/workspace/RepositorySemanticMap.tsx");
  const mask = map.match(/maskColor="rgba\(15,23,42,\.(\d+)\)"/);
  assert.ok(mask, "no minimap mask found");
  assert.ok(Number(mask![1]) >= 15, `mask at .${mask![1]} is too faint to read`);
});
