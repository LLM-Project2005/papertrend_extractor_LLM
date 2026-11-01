/*
 * The Evidence tab as the PDF alone (2026-10-22): every passage the analysis
 * stored is found in the PDF's text and marked, one in focus, and a pager
 * steps through them in reading order across pages. A passage the PDF's text
 * does not contain is listed, not lost.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { locateMarks, type PdfMark } from "../src/components/workspace/PdfViewer";

void React;

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const PAGES = [
  { runs: ["Abstract", "This study examines peer feedback in writing classes.", "Forty learners took part."] },
  { runs: ["Method", "A pre-test and a post-test measured", "writing accuracy over twelve weeks."] },
  { runs: ["Results", "Accuracy rose by 18 percent.", "Peer feedback helped weaker writers most."] },
];

const mark = (id: string, label: string, ...candidates: string[]): PdfMark => ({ id, label, candidates });

test("passages are found, put in reading order, and merged where two keywords share one", () => {
  const { located, missing } = locateMarks(PAGES, [
    mark("1", "peer feedback", "Peer feedback helped weaker writers most."),
    mark("2", "writing accuracy", "A pre-test and a post-test measured writing accuracy over twelve weeks."),
    mark("3", "participants", "Forty learners took part."),
    mark("4", "weaker writers", "Peer feedback helped weaker writers most."),
    mark("5", "interviews", "Semi-structured interviews followed the course."),
  ]);
  assert.deepEqual(located.map((item) => [item.page, item.labels]), [
    [0, ["participants"]],
    [1, ["writing accuracy"]],
    [2, ["peer feedback", "weaker writers"]],
  ]);
  assert.deepEqual(located[1].runs, [1, 2], "a passage over two lines covers both");
  assert.deepEqual(missing.map((item) => item.label), ["interviews"], "a passage the text does not contain is kept aside");
});

test("each passage tries its candidates in order, and empty ones are skipped", () => {
  const { located } = locateMarks(PAGES, [mark("1", "accuracy", "", "Words that are nowhere.", "Accuracy rose by 18 percent.")]);
  assert.equal(located.length, 1);
  assert.equal(located[0].page, 2);
  assert.equal(locateMarks(PAGES, []).located.length, 0);
});

test("the Evidence tab is the PDF with the evidence on it, not a list beside it", async () => {
  const explorer = read("src/components/workspace/PaperAnalysisExplorerModal.tsx");
  assert.match(explorer, /marks=\{evidenceMarks\}/);
  for (const gone of ["Evidence reader", "Stored rationale", "Matched text context", "setSelectedEvidenceIndex"]) {
    assert.ok(!explorer.includes(gone), gone);
  }
  const { PaperExplorerPanel } = await import("../src/components/workspace/PaperAnalysisExplorerModal");
  const idle = async () => undefined;
  const html = renderToStaticMarkup(
    createElement(PaperExplorerPanel, {
      run: { id: "r1", status: "succeeded", source_type: "upload", display_name: "Peer feedback", created_at: "2026-10-01", updated_at: "2026-10-01" } as never,
      detail: {
        available: true,
        title: "Peer feedback in writing",
        topics: [],
        keywords: [
          { keyword: "peer feedback", topic: "Feedback", frequency: 4, evidence: "Peer feedback helped weaker writers most." },
          { keyword: "writing accuracy", topic: "Writing", frequency: 3, evidence: "A pre-test and a post-test measured writing accuracy." },
        ],
        concepts: [],
        facets: [],
        tracksSingle: [],
        tracksMulti: [],
        diagnostics: { dataSource: "canonical" },
      } as never,
      loading: false,
      error: null,
      initialTab: "evidence",
      onClose: () => undefined,
      onResolvePreviewUrl: async () => null,
      onOpenInNewTab: idle,
      onDownload: idle,
      onDownloadReport: idle,
      onToggleFavorite: idle,
      onRename: idle,
      onOpenDashboard: () => undefined,
    })
  );
  assert.match(html, /aria-label="Evidence in the PDF"/);
  assert.match(html, /Loading the PDF…/, "the PDF reader, waiting for its address");
  assert.doesNotMatch(html, /aria-pressed="(true|false)"[^>]*>(<[^>]+>)*peer feedback/, "no list of keywords to pick from");
  assert.doesNotMatch(html, /aria-live/, "nothing on the reader announces itself");
});

test("the viewer marks every passage, steps through them, and turns pages", () => {
  const viewer = read("src/components/workspace/PdfViewer.tsx");
  assert.match(viewer, /aria-label="Previous evidence"/);
  assert.match(viewer, /aria-label="Next evidence"/);
  assert.match(viewer, /aria-label="Previous page"/);
  assert.match(viewer, /aria-label="Next page"/);
  assert.match(viewer, /Evidence \{Math\.min\(activeIndex, located\.length - 1\) \+ 1\} of \{located\.length\}/);
  assert.match(viewer, /active: mark === active/, "every passage on a page is drawn, the one in focus marked as such");
  assert.match(viewer, /\{missing\.length > 0 && \(unmarked \|\| located\.length === 0\) \? \(/, "passages the text lacks are listed, open, when none is marked or the PDF says why");
  // The page in focus is drawn at once; the others as they come into view.
  assert.match(viewer, /useEffect\(\(\) => \{\n\s+if \(hasActive\) setNear\(true\);\n\s+\}, \[hasActive\]\);/);
  const css = read("src/app/globals.css");
  assert.match(css, /\.pdf-evidence-mark-soft \{\n\s+background: rgb\(var\(--highlight\) \/ 0\.14\);/); // the highlighter yellow is a token since 2026-10-31
});
