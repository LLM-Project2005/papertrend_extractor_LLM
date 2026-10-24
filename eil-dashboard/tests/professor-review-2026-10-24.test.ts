/*
 * The professor's review of 2026-10-24 (docs/40): theme colours that mean one
 * theme everywhere, one Topics tab in the paper window, a scan said to be a
 * scan, axis names over two lines, and the semantic map saved as a picture.
 * The chat's usage meter and the withdrawn second model are tested in
 * second-chat-model.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CATEGORICAL_PALETTE, NEUTRAL_MARK } from "../src/lib/chart-palette";
import {
  COLOURED_THEMES,
  OTHER_THEME_COLOR,
  THEME_PALETTE,
  colouredThemes,
  keywordThemeKey,
  keywordThemes,
  paperThemes,
  themeColor,
  themeColorMap,
  tint,
  topicKey,
} from "../src/lib/theme-colors";
import { effectiveTextKind, pageCharacterCount, pageListText, pageTextKind, textKindChip, textSourceFromQuality } from "../src/lib/pdf-text-kind";
import { wrapLabel } from "../src/lib/chart-ticks";
import { MAP_IMAGE, drawSemanticMap, fitText, mapImageFileName, mapImageLayout } from "../src/lib/semantic-map-png";
import { readPaperTab, PAPER_EXPLORER_TABS } from "../src/lib/paper-address";
import type { TrendRow } from "../src/types/database";

void React;

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const row = (paper: string, topic: string, keyword = topic.toLowerCase(), extra: Partial<TrendRow> = {}): TrendRow => ({
  paper_id: paper,
  year: "2022",
  title: `Paper ${paper}`,
  topic,
  keyword,
  keyword_frequency: 1,
  evidence: "",
  ...extra,
});

/** Eighteen themes: Theme 1 in eighteen papers, Theme 2 in seventeen, ... Theme 18 in one; and a method in every paper. */
function eighteenThemes(): TrendRow[] {
  const rows: TrendRow[] = [];
  for (let theme = 1; theme <= 18; theme += 1) {
    for (let paper = 1; paper <= 19 - theme; paper += 1) rows.push(row(`p${paper}`, `Theme ${theme}`, `kw${theme}`));
  }
  for (let paper = 1; paper <= 18; paper += 1) rows.push(row(`p${paper}`, "Mixed methods", "survey", { topic_kind: "method" }));
  return rows;
}

/* ------------------------------------------------------------ theme colours */

test("the sixteen themes with the most papers take the sixteen colours in order; the rest are grey", () => {
  // Sixteen, the user's choice over eight (2026-10-24): the eight chart colours, then the same hues a shade deeper.
  const colors = themeColorMap(eighteenThemes());
  assert.equal(COLOURED_THEMES, 16);
  assert.deepEqual(THEME_PALETTE.light.slice(0, 8), [...CATEGORICAL_PALETTE]);
  for (let theme = 1; theme <= 16; theme += 1) {
    assert.equal(themeColor(colors, `Theme ${theme}`), THEME_PALETTE.light[theme - 1], `Theme ${theme}`);
    assert.equal(themeColor(colors, `Theme ${theme}`, true), THEME_PALETTE.dark[theme - 1], `Theme ${theme}, dark page`);
  }
  assert.equal(themeColor(colors, "Theme 9"), "#215ea7", "theme 9: a deeper blue than theme 1's");
  assert.equal(themeColor(colors, "Theme 17"), OTHER_THEME_COLOR);
  assert.equal(themeColor(colors, "Theme 18", true), OTHER_THEME_COLOR);
  assert.equal(OTHER_THEME_COLOR, NEUTRAL_MARK);
  assert.equal(themeColor(colors, "Mixed methods"), OTHER_THEME_COLOR, "a method theme is not ranked, though it is in every paper");
  assert.equal(themeColor(colors, "No such theme"), OTHER_THEME_COLOR);
  for (const mode of ["light", "dark"] as const) assert.equal(new Set(THEME_PALETTE[mode]).size, 16, `${mode}: no colour is used twice`);
  assert.deepEqual(colouredThemes(colors).map((entry) => entry.theme).slice(0, 3), ["Theme 1", "Theme 2", "Theme 3"], "a legend in rank order");
  assert.equal(colors.papers["Theme 1"], 18);
});

test("a tie in papers goes to the theme first by name, so a colour never depends on row order", () => {
  const rows = [row("1", "Writing"), row("2", "Writing"), row("1", "Reading"), row("2", "Reading")];
  assert.deepEqual(themeColorMap(rows).byTheme, themeColorMap([...rows].reverse()).byTheme);
  assert.equal(themeColor(themeColorMap(rows), "Reading"), CATEGORICAL_PALETTE[0]);
});

test("the dashboard colours themes from the whole repository, before its filters", () => {
  const client = read("src/components/DashboardClient.tsx");
  assert.match(client, /const themeColors = useMemo\(\(\) => themeColorMap\(data\?\.trends \?\? \[\]\), \[data\]\);/);
  assert.doesNotMatch(client, /themeColorMap\(filteredData/);
  for (const tab of ["TrendAnalysis", "TrackAnalysis", "KeywordExplorer"]) {
    assert.doesNotMatch(read(`src/components/tabs/${tab}.tsx`), /TOPIC_PALETTE\[index|categoricalColor\(index\)/, `${tab}: no colour by position`);
  }
});

test("a keyword wears the colour of the theme most of its rows are filed under", () => {
  const rows = [row("1", "Writing", "Peer feedback"), row("2", "Writing", "peer  feedback"), row("3", "Assessment", "peer feedback")];
  const colors = themeColorMap(rows);
  const themes = keywordThemes(rows, colors);
  assert.equal(themes.get(keywordThemeKey("Peer Feedback")), "Writing", "folded as the keyword counts are");
});

test("a paper's topic labels find their themes, and a method is grey", () => {
  const rows = [
    ...eighteenThemes(),
    row("p1", "Theme 1", "k", { raw_topic: "English Present Tense Usage" }),
    row("p1", "Mixed methods", "survey", { topic_kind: "method", raw_topic: "Gap-Filling Questionnaires" }),
  ];
  const themes = paperThemes(rows, "p1", themeColorMap(rows));
  const tense = themes.get(topicKey("  english present   tense usage "));
  assert.ok(tense);
  assert.equal(tense.theme, "Theme 1");
  assert.equal(tense.color, CATEGORICAL_PALETTE[0]);
  assert.equal(tense.coloured, true);
  const method = themes.get(topicKey("Gap-Filling Questionnaires"));
  assert.ok(method?.method);
  assert.equal(method.color, OTHER_THEME_COLOR);
  assert.equal(paperThemes(rows, null, themeColorMap(rows)).size, 0);
  assert.equal(tint("#2a78d6", 0.1), "#2a78d61a");
});

/* ------------------------------------------------------------ scanned PDFs */

test("how the analysis read a PDF says whether it is a scan", () => {
  assert.deepEqual(textSourceFromQuality({ extraction_method: "vision_fallback", translation_strategy: "not_needed" }), { kind: "scanned", translated: false });
  assert.deepEqual(textSourceFromQuality({ extraction_method: "fitz_text+vision_pages" }), { kind: "partly_scanned", translated: false });
  assert.deepEqual(textSourceFromQuality({ extraction_method: "fitz_text", translation_strategy: "chunked_translation" }), { kind: "text", translated: true });
  assert.deepEqual(textSourceFromQuality({ extraction_method: "unknown", translation_strategy: "multilingual_fallback" }), { kind: null, translated: false });
  assert.deepEqual(textSourceFromQuality(null), { kind: null, translated: false });
  const route = read("src/app/api/workspace/library/[runId]/analysis/route.ts");
  assert.match(route, /textSource: textSourceFromQuality\(quality\),/);
});

test("for an older paper, the PDF's own pages say it: a page with almost no text is a picture", () => {
  assert.equal(pageCharacterCount(["  The present", " study  ", ""]), 15);
  assert.deepEqual(pageTextKind([0, 3, 0]), { kind: "scanned", imagePages: [0, 1, 2] });
  assert.deepEqual(pageTextKind([4, 900, 1200]), { kind: "partly_scanned", imagePages: [0] });
  assert.deepEqual(pageTextKind([800, 900]), { kind: "text", imagePages: [] });
  assert.deepEqual(pageTextKind([]), { kind: null, imagePages: [] });
  assert.equal(effectiveTextKind("text", "scanned"), "text", "the analysis's record first");
  assert.equal(effectiveTextKind(null, "scanned"), "scanned");
  assert.equal(pageListText([0]), "page 1");
  assert.equal(pageListText([0, 1]), "pages 1 and 2");
  assert.equal(pageListText([0, 3, 8]), "pages 1, 4 and 9");
  assert.equal(pageListText([0, 1, 2, 3, 4, 5, 6]), "7 pages");
  assert.equal(textKindChip("scanned"), "Scanned PDF");
  assert.equal(textKindChip("partly_scanned"), "Partly scanned");
  assert.equal(textKindChip("text"), null);
});

test("the Evidence tab says why nothing is marked, and lists the passages", async () => {
  const { unmarkedNotice } = await import("../src/components/workspace/PdfViewer");
  const scan = unmarkedNotice({ kind: "scanned", translated: false, imagePages: [0, 1], located: 0, missing: 12 });
  assert.equal(scan?.title, "This PDF is a scanned image.");
  assert.match(scan?.body ?? "", /pictures of text, so the evidence can't be highlighted on them\. Papertrend read the pages with OCR\. The 12 passages it found are listed below\./);
  const part = unmarkedNotice({ kind: "partly_scanned", translated: false, imagePages: [0, 1], located: 4, missing: 2 });
  assert.match(part?.body ?? "", /^Pages 1 and 2 are scanned images, so passages on them can't be highlighted\./);
  assert.match(part?.body ?? "", /The passages it could not mark are listed below\.$/);
  assert.match(unmarkedNotice({ kind: "partly_scanned", translated: false, imagePages: [2], located: 4, missing: 1 })?.body ?? "", /^Page 3 is a scanned image, so passages on it/);
  assert.equal(unmarkedNotice({ kind: "text", translated: true, imagePages: [], located: 0, missing: 3 })?.title, "This paper was analysed in an English translation.");
  assert.equal(unmarkedNotice({ kind: "text", translated: false, imagePages: [], located: 0, missing: 3 }), null, "a typed PDF: the plain wording");
  assert.equal(unmarkedNotice({ kind: "scanned", translated: false, imagePages: [], located: 3, missing: 0 }), null);
  const viewer = read("src/components/workspace/PdfViewer.tsx");
  assert.match(viewer, /<ul aria-label="Passages not marked on the PDF"/, "listed open, not folded away");
});

/* ---------------------------------------------------- the paper's Topics tab */

const DETAIL = {
  available: true,
  paper_id: "p1",
  title: "Native speakers and the present tense",
  topics: ["English Present Tense Usage", "Gap-Filling Questionnaires"],
  keywords: [
    { keyword: "Present Simple", topic: "English Present Tense Usage", frequency: 19, evidence: "The participants mostly used the Present Simple." },
    { keyword: "Present Perfect", topic: "English Present Tense Usage", frequency: 30, evidence: "The Present Perfect conveys a range of temporal dimensions." },
    { keyword: "gap-filling test", topic: "Gap-Filling Questionnaires", frequency: 7, evidence: "A gap-filling test of the English Present Tense." },
  ],
  concepts: [
    { label: "English Present Tense Usage", totalFrequency: 77, relatedKeywords: ["Present Simple", "Present Perfect Progressive"], firstEvidence: "", evidenceSnippets: [], matchedTerms: [] },
    { label: "Locations in Time", totalFrequency: 22, relatedKeywords: ["temporal adverbials"], firstEvidence: "The notion of tense involves locations in time.", evidenceSnippets: [], matchedTerms: [] },
  ],
  facets: [{ facetType: "research_design", label: "Descriptive study", evidence: "This descriptive study examined usage." }],
  tracksSingle: [],
  tracksMulti: [],
  extracted: { year: null, typology: null, authorKeywords: [], methodTopics: ["Gap-Filling Questionnaires"], analysisNotes: [], duplicateOf: null, textSource: { kind: "scanned", translated: false } },
  diagnostics: { dataSource: "canonical" },
};

test("Keywords and Topics are one tab: each topic with its theme, its keywords and their evidence", async () => {
  const { PaperExplorerPanel, buildTopicGroups, themeLine } = await import("../src/components/workspace/PaperAnalysisExplorerModal");
  const themes = new Map([
    [topicKey("English Present Tense Usage"), { theme: "Grammar and Usage", papers: 6, color: CATEGORICAL_PALETTE[2], coloured: true, method: false }],
    [topicKey("Locations in Time"), { theme: "Locations in Time", papers: 1, color: OTHER_THEME_COLOR, coloured: false, method: false }],
  ]);
  const rows = DETAIL.keywords.map((keyword, index) => ({ ...keyword, index, context: "", matchType: "stored_evidence_only" as const, section: "Full text" }));
  const groups = buildTopicGroups(DETAIL as never, rows, themes);
  assert.deepEqual(groups.map((group) => [group.label, group.mentions]), [
    ["English Present Tense Usage", 77],
    ["Locations in Time", 22],
    ["Gap-Filling Questionnaires", 7],
  ]);
  assert.deepEqual(groups[0].rows.map((row) => row.keyword), ["Present Perfect", "Present Simple"], "most mentioned first");
  assert.deepEqual(groups[0].otherKeywords, ["Present Perfect Progressive"], "a keyword already listed is not repeated");
  assert.equal(groups[1].evidence, "The notion of tense involves locations in time.");
  assert.equal(themeLine(groups[0]), "Theme: Grammar and Usage · 6 papers");
  assert.equal(themeLine(groups[1]), "Only in this paper");
  assert.equal(themeLine(groups[2]), "Research method");

  const idle = async () => undefined;
  const html = renderToStaticMarkup(
    createElement(PaperExplorerPanel, {
      run: { id: "r1", status: "succeeded", source_type: "upload", display_name: "Present tense", created_at: "2026-10-01", updated_at: "2026-10-01" } as never,
      detail: DETAIL as never,
      loading: false,
      error: null,
      initialTab: "topics",
      themes,
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
  const tabs = [...html.matchAll(/class="tab-btn [^"]*">([^<]+)<\/button>/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ["Overview", "Topics", "Evidence", "Preview"]);
  assert.match(html, new RegExp(`data-topic="English Present Tense Usage"[^>]*style="border-left-width:4px;border-left-color:${CATEGORICAL_PALETTE[2]}"`));
  assert.match(html, /Theme: Grammar and Usage · 6 papers/);
  assert.match(html, /Only in this paper/);
  assert.match(html, /Research method/);
  assert.equal((html.match(/Show in PDF/g) ?? []).length, 3, "one way to each keyword's passage");
  assert.match(html, /Also found/);
  assert.match(html, /This descriptive study examined usage\./);
  assert.match(html, /data-text-kind=""[^>]*>Scanned PDF</, "the header says it is a scan");
});

test("an address that names the Keywords tab opens Topics", () => {
  assert.deepEqual(PAPER_EXPLORER_TABS, ["overview", "topics", "evidence", "preview"]);
  assert.equal(readPaperTab("keywords"), "topics");
  assert.equal(readPaperTab("topics"), "topics");
  assert.equal(readPaperTab("nonsense"), "overview");
  assert.match(read("src/components/admin/AdminImportClient.tsx"), /readPaperTab\(searchParams\.get\("tab"\)\)/);
});

/* ------------------------------------------------------- names on two lines */

test("an axis name goes onto two lines at spaces, and only the second is cut", () => {
  assert.deepEqual(wrapLabel("Teacher Cognition and Beliefs", 17), ["Teacher Cognition", "and Beliefs"]);
  assert.deepEqual(wrapLabel("Teacher Cognition and Beliefs", 42), ["Teacher Cognition and Beliefs"]);
  assert.deepEqual(wrapLabel("Formative and Classroom Assessment Practices in Thai Universities", 24), ["Formative and Classroom", "Assessment Practices in…"]);
  assert.deepEqual(wrapLabel("Supercalifragilisticexpialidocious", 10), ["Supercali…"]);
  assert.deepEqual(wrapLabel("", 10), []);
});

/* ------------------------------------------------------- the map as a picture */

test("the map's picture fits every paper inside the plot, keeping its shape", () => {
  const points = [
    { x: -3, y: 10 },
    { x: 7, y: 15 },
    { x: 2, y: 20 },
  ];
  const { plot, place } = mapImageLayout(points);
  for (const point of points.map(place)) {
    assert.ok(point.x >= plot.left && point.x <= plot.right, `x ${point.x}`);
    assert.ok(point.y >= plot.top && point.y <= plot.bottom, `y ${point.y}`);
  }
  const [a, b, c] = points.map(place);
  // One scale on both axes: the map is not stretched.
  assert.ok(Math.abs((b.x - a.x) / 10 - (c.y - a.y) / 10) < 1e-9);
  assert.equal(plot.right, MAP_IMAGE.width - MAP_IMAGE.padding - MAP_IMAGE.legendWidth, "the key has its own column");
  assert.equal(fitText("A very long paper title indeed", 12), "A very long…");
  assert.equal(mapImageFileName("testtest", new Date("2026-10-24T05:00:00Z")), "testtest-semantic-map-2026-10-24.png");
  assert.equal(mapImageFileName("งานวิจัย EIL", new Date("2026-10-24T05:00:00Z")), "งานวิจัย-eil-semantic-map-2026-10-24.png");
});

test("the picture draws each paper, each link and the colour key, on white", () => {
  const calls: string[] = [];
  const context = new Proxy(
    {},
    {
      get: (_target, name: string) => (...args: unknown[]) => void calls.push(`${name}(${args.map((arg) => (typeof arg === "number" ? Math.round(arg) : String(arg))).join(",")})`),
      set: (_target, name: string, value: unknown) => {
        calls.push(`${name}=${String(value)}`);
        return true;
      },
    }
  ) as unknown as Parameters<typeof drawSemanticMap>[0];
  drawSemanticMap(context, {
    title: "testtest: semantic map",
    subtitle: "3 papers · 2 links",
    points: [
      { id: "1", x: 0, y: 0, color: "#2a78d6", label: "One" },
      { id: "2", x: 1, y: 1, color: "#d95926" },
      { id: "3", x: 2, y: 0, color: "#2a78d6", faded: true },
    ],
    edges: [
      { source: "1", target: "2" },
      { source: "2", target: "9" },
    ],
    legendTitle: "Colour: Research area",
    legend: [
      { label: "English Language Instruction", color: "#2a78d6", count: 2 },
      { label: "English Linguistics", color: "#d95926", count: 1 },
    ],
    footnote: "Made with Papertrend.",
  });
  assert.equal(calls[0], "fillStyle=#ffffff");
  assert.equal(calls[1], `fillRect(0,0,${MAP_IMAGE.width},${MAP_IMAGE.height})`);
  assert.equal(calls.filter((call) => call.startsWith("lineTo(")).length, 1, "a link to a paper not drawn is left out");
  assert.equal(calls.filter((call) => call.startsWith("arc(")).length, 3 + 2, "three papers and two key entries");
  assert.ok(calls.includes("fillText(testtest: semantic map,48,70)"));
  assert.ok(calls.some((call) => call.startsWith("fillText(English Language Instruction (2),")));
  assert.ok(calls.some((call) => call.startsWith("fillText(One,")), "a paper's label when labels are on");
  assert.ok(calls.includes("globalAlpha=0.2"), "a faded paper stays faded");
});

test("the map offers the picture, and over the map the wheel zooms instead of scrolling the page", () => {
  const map = read("src/components/workspace/RepositorySemanticMap.tsx");
  assert.match(map, /await downloadSemanticMapPng\(/);
  assert.match(map, /const live = layoutMode === "force" \? positionsRef\.current\?\.\(\) \?\? \{\} : \{\};/, "the free graph's positions as they are now");
  assert.match(map, /Scroll to zoom · drag to move/);
  const graph = read("src/components/workspace/ForceDirectedSemanticGraph.tsx");
  assert.match(graph, /event\.preventDefault\(\);\n\s+const focus = graphPoint\(event\.clientX, event\.clientY\);/);
  assert.doesNotMatch(graph, /Drag nodes \/ drag canvas \/ scroll to zoom/);
});

/* ------------------------------------------------------------- the heatmap */

test("a heatmap can leave its zeros blank, and its cells fill the column under a long heading", async () => {
  const { default: Heatmap } = await import("../src/components/Heatmap");
  const html = renderToStaticMarkup(
    createElement(Heatmap, { rows: ["English Language Instruction"], cols: ["English Language Instruction", "English Linguistics"], values: [[40, 0]], columnWidth: "7rem", hideZeros: true })
  );
  assert.match(html, /<th title="English Language Instruction" style="width:7rem;min-width:7rem;max-width:7rem"/);
  assert.equal((html.match(/class="flex h-8 w-full /g) ?? []).length, 2);
  assert.match(html, />40<\/div>/);
  assert.match(html, /color:[^"]+"><\/div>/, "the zero cell is empty");
});

/* ------------------------------------------------- a scan's evidence, in its text */

const OCR = [
  "[Page 1]",
  "",
  "# A Corpus-Based Study of Spoken Discourse Markers",
  "",
  "This research was undertaken with two main **objectives**.",
  "",
  "---",
  "",
  "[Page 7]",
  "",
  "Discourse markers reveal substantially more pragmatic functions in speech than in writing.",
  "Thai EFL learners exhibit deficiency in pragmatic competence.",
].join("\n");

test("a scan's OCR text is read in its pages, without the page breaks and Markdown marks", async () => {
  const { textPages, lineSegments } = await import("../src/components/workspace/EvidenceText");
  const pages = textPages(OCR);
  assert.deepEqual(pages.map((page) => page.number), [1, 7], "the PDF's own page numbers");
  assert.deepEqual(pages[0].lines, [
    { text: "A Corpus-Based Study of Spoken Discourse Markers", heading: true },
    { text: "This research was undertaken with two main objectives.", heading: false },
  ]);
  assert.equal(pages[1].lines.length, 2, "the --- between pages is not a line");
  assert.deepEqual(textPages("No markers here.\nA second line."), [{ number: null, lines: [{ text: "No markers here.", heading: false }, { text: "A second line.", heading: false }] }]);
  assert.deepEqual(lineSegments("abcdefgh", [{ start: 2, end: 5, active: false }, { start: 4, end: 6, active: true }]), [
    { text: "ab", mark: "none" },
    { text: "cd", mark: "soft" },
    { text: "ef", mark: "active" },
    { text: "gh", mark: "none" },
  ]);
});

test("every passage is marked in the scan's text, one in focus, with the same pager as the PDF", async () => {
  const { default: EvidenceText } = await import("../src/components/workspace/EvidenceText");
  const html = renderToStaticMarkup(
    createElement(EvidenceText, {
      text: OCR,
      marks: [
        { id: "0", label: "pragmatic functions", candidates: ["Discourse markers reveal substantially more pragmatic functions in speech than in writing."] },
        { id: "1", label: "objectives", candidates: ["This research was undertaken with two main objectives."] },
        { id: "2", label: "interviews", candidates: ["Semi-structured interviews followed."] },
      ],
    })
  );
  assert.match(html, /Evidence 1 of 2/);
  assert.match(html, /objectives<\/span><span class="text-mute"> · page 1<\/span>/, "in reading order, with the PDF's page");
  assert.match(html, /2 passages on 2 pages/);
  assert.equal((html.match(/data-evidence-mark="active"/g) ?? []).length, 1);
  assert.equal((html.match(/data-evidence-mark="other"/g) ?? []).length, 1);
  assert.match(html, /This PDF is a scanned image,<\/span> so its evidence is shown in the text Papertrend read from it with OCR\. The Preview tab shows the PDF itself\./);
  assert.match(html, /1 passage not found in the text/);
  assert.match(html, />Page 7</);
  const css = read("src/app/globals.css");
  assert.match(css, /\.dark \.text-evidence-mark \{\n\s+background: rgb\(250 204 21 \/ 0\.32\);/, "no multiply blend, so the mark shows on the dark page");
});

test("the paper window shows a scan's evidence in its text, and the keyword button says so", async () => {
  const { PaperExplorerPanel } = await import("../src/components/workspace/PaperAnalysisExplorerModal");
  const idle = async () => undefined;
  const scanned = {
    ...DETAIL,
    raw_text: OCR,
    keywords: [{ keyword: "objectives", topic: "Research aims", frequency: 2, evidence: "This research was undertaken with two main objectives." }],
    concepts: [],
  };
  const draw = (tab: "evidence" | "topics", detail: unknown) =>
    renderToStaticMarkup(
      createElement(PaperExplorerPanel, {
        run: { id: "r2", status: "succeeded", source_type: "upload", display_name: "Scan", created_at: "2026-10-01", updated_at: "2026-10-01" } as never,
        detail: detail as never,
        loading: false,
        error: null,
        initialTab: tab,
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
  const evidence = draw("evidence", scanned);
  assert.match(evidence, /aria-label="Evidence in the paper&#x27;s text"/);
  assert.match(evidence, /data-evidence-text=""/);
  assert.doesNotMatch(evidence, /Loading the PDF…/, "no PDF to wait for");
  assert.match(draw("topics", scanned), />Show in text</);
  // A typed PDF keeps the PDF with its marks.
  const typed = { ...scanned, extracted: { ...scanned.extracted, textSource: { kind: "text", translated: false } } };
  assert.match(draw("evidence", typed), /aria-label="Evidence in the PDF"/);
  assert.match(draw("topics", typed), />Show in PDF</);
});
