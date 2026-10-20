/*
 * The shared charts (docs/38), drawn: the axis, the squares, the switch
 * between papers and shares, and which chart each chat answer gets. Also
 * charts saved before docs/38, which must still draw.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { drawsAsUnits, formatPercent, niceAxis, position, sharePercent, varies } from "../src/lib/charts/scale";
import { narrowHidden } from "../src/components/charts/parts";
import type { Insight } from "../src/lib/insights/types";

void React;

test("an axis starts at zero and ends at a rounded value at or above the largest", () => {
  const cases: Array<[number, boolean, number]> = [
    [1, true, 1],
    [2, true, 2],
    [3, true, 3],
    [7, true, 7],
    [18, true, 20],
    [37, true, 40],
    [10_190, true, 12_000],
    [0.42, false, 0.5],
    [67, false, 70],
  ];
  for (const [max, integer, end] of cases) {
    const axis = niceAxis(max, { integer });
    assert.equal(axis.ticks[0], 0, `${max} starts at 0`);
    assert.ok(axis.max >= max, `${max} fits under ${axis.max}`);
    assert.equal(axis.max, end, `${max} runs to ${end}, not ${axis.max}`);
    assert.equal(axis.ticks[axis.ticks.length - 1], axis.max);
    if (integer) assert.ok(axis.ticks.every(Number.isInteger), `${max}: whole ticks ${axis.ticks}`);
    assert.ok(axis.ticks.length >= 2 && axis.ticks.length <= 8, `${max}: ${axis.ticks.length} ticks`);
  }
  assert.deepEqual(niceAxis(0).ticks, [0, 1], "nothing to draw still has an axis");
  assert.equal(niceAxis(97, { cap: 100 }).max, 100, "a share never runs past 100%");
  assert.equal(niceAxis(Number.NaN).max, 1);
});

test("a bar is placed on the axis, never on the largest bar", () => {
  const axis = niceAxis(3, { integer: true });
  // The old chart drew 1 of 1, 1 of 1 and 1 of 1 as three full bars.
  assert.equal(position(1, niceAxis(1, { integer: true })), 100);
  assert.equal(position(2, niceAxis(20, { integer: true })), 10, "2 of an axis to 20 is a tenth of it");
  assert.equal(position(3, axis), 100);
  assert.equal(position(-1, axis), 0);
  assert.equal(position(500, axis), 100, "never past the end");
});

test("small counts of papers are squares; quantities and large counts are bars", () => {
  assert.equal(drawsAsUnits([1, 1, 1], "papers"), true);
  assert.equal(drawsAsUnits([15, 3], "papers"), true);
  assert.equal(drawsAsUnits([16, 3], "papers"), false);
  assert.equal(drawsAsUnits([2.5, 1], "papers"), false);
  assert.equal(drawsAsUnits([3, 1], "value"), false, "words are never squares");
  assert.equal(drawsAsUnits([0, 0], "papers"), false);
});

test("a share is a whole percent, and a small one is not rounded to nothing", () => {
  assert.equal(sharePercent(1, 6), 17);
  assert.equal(sharePercent(2, 5), 40);
  assert.equal(sharePercent(1, 5000), 0.02);
  assert.equal(formatPercent(sharePercent(1, 5000)), "<0.1%", "1 paper of 5,000 is not 0%");
  assert.equal(formatPercent(sharePercent(3, 1000)), "0.3%");
  assert.equal(formatPercent(29), "29%");
  assert.equal(sharePercent(1, 0), 0);
  assert.equal(varies([1, 1, 1]), false);
  assert.equal(varies([1, 2]), true);
});

test("on a phone, every other axis label is left out, keeping both ends", () => {
  const shown = (count: number) => Array.from({ length: count }, (_, index) => index).filter((index) => !narrowHidden(index, count));
  assert.deepEqual(shown(4), [0, 1, 2, 3], "four fit");
  assert.deepEqual(shown(7), [0, 2, 4, 6]);
  assert.deepEqual(shown(6), [0, 2, 5], "the one beside the last goes");
});

async function bars(props: Record<string, unknown>) {
  const { default: Bars } = await import("../src/components/charts/Bars");
  return renderToStaticMarkup(createElement(Bars, props as never));
}

test("counts of papers are drawn one square per paper, each opening its paper", async () => {
  const html = await bars({
    rows: [
      { key: "a", label: "Academic Writing", value: 3, paperIds: ["p1", "p2", "p3"] },
      { key: "b", label: "Global Englishes", value: 1, paperIds: ["p4"] },
    ],
    measure: "papers",
    total: 6,
    onOpen: () => undefined,
    paperTitles: new Map([["p1", "The first paper"]]),
  });
  assert.match(html, /data-units="true"/);
  assert.equal((html.match(/<span data-bar="true" class="block h-3\.5/g) ?? []).length, 4, "four squares for four papers");
  assert.match(html, /aria-label="Open The first paper"/, "a square names its paper");
  assert.match(html, /Papers, out of 6/);
  assert.match(html, /aria-pressed="true"[^>]*>Papers</, "counts first");
  assert.match(html, /One square is one paper/);
  assert.doesNotMatch(html, /\d+% of papers|here ·/);
});

test("large counts are bars on an axis, with every tick printed", async () => {
  const html = await bars({ rows: [{ key: "a", label: "A", value: 37, paperIds: [] }, { key: "b", label: "B", value: 12, paperIds: [] }], measure: "papers", total: 120 });
  assert.doesNotMatch(html, /data-units/);
  for (const tick of ["0", "10", "20", "30", "40"]) assert.match(html, new RegExp(`>${tick}</span>`), `tick ${tick}`);
  assert.match(html, /width:92\.5%/, "37 of an axis to 40");
  assert.match(html, /width:30%/, "12 of 40");
});

test("equal values say so above the chart", async () => {
  const html = await bars({ rows: ["a", "b", "c"].map((key) => ({ key, label: key, value: 20, paperIds: [] })), measure: "papers", total: 60 });
  assert.match(html, /All 3 have the same value, 20 papers of 60 \(33%\), so none stands out\./);
});

test("a quantity carries its unit on the axis and needs no switch", async () => {
  const html = await bars({ rows: [{ key: "a", label: "Paper A", value: 10_190 }, { key: "b", label: "Paper B", value: 6_019 }], measure: "value", unit: "words" });
  assert.match(html, />Words</);
  assert.doesNotMatch(html, /aria-pressed/);
  assert.match(html, /10,190/);
});

test("a comparison of groups is in shares of each group, with the counts behind them", async () => {
  const { default: GroupedBars } = await import("../src/components/charts/GroupedBars");
  const html = renderToStaticMarkup(
    createElement(GroupedBars, {
      series: [
        { key: "left", label: "2011–2021", color: "grey", of: 17 },
        { key: "right", label: "2022–2025", color: "blue", of: 24 },
      ],
      rows: [{ key: "w", label: "Writing", values: [5, 12], paperIds: ["p1"] }],
      measure: "papers",
    })
  );
  assert.match(html, /2011–2021<span class="text-mute"> · 17 papers/);
  assert.match(html, />29%</, "5 of 17");
  assert.match(html, />50%</, "12 of 24");
  assert.match(html, /title="2011–2021: 5 of 17 papers \(29%\); 2022–2025: 12 of 24 papers \(50%\)"/);
  assert.match(html, /Each bar is a share of its own group/);
});

test("insights saved before docs/38 still draw, without their old share lines", async () => {
  const { default: InsightChart } = await import("../src/components/dashboard/InsightChart");
  const old: Insight = {
    id: "ask",
    family: "composition",
    question: "Papers by theme",
    view: { measure: "asked", rows: "theme" },
    chart: {
      kind: "bars",
      valueLabel: "Papers",
      unit: "papers",
      rows: [
        { label: "Writing", value: 2, detail: "40% of papers", paperIds: ["a", "b"] },
        { label: "Reading", value: 1, detail: "25% here · 17% of all papers", paperIds: ["c"] },
      ],
    },
    facts: [],
    takeaway: "",
    score: 1,
    paperIds: ["a", "b", "c"],
    basis: "",
  };
  const html = renderToStaticMarkup(createElement(InsightChart, { insight: old, onOpen: () => undefined }));
  assert.doesNotMatch(html, /40% of papers|% here/);
  assert.match(html, /data-units="true"/);
  const compare: Insight = {
    ...old,
    chart: { kind: "compare", leftLabel: "2011–2021", rightLabel: "2022–2025", unit: "percent", sequence: "time", rows: [{ label: "Writing", left: 20, right: 45, paperIds: ["a"] }] },
  };
  const drawn = renderToStaticMarkup(createElement(InsightChart, { insight: compare, onOpen: () => undefined }));
  assert.match(drawn, />20%</);
  assert.match(drawn, />45%</);
  assert.doesNotMatch(drawn, /aria-pressed/, "no counts to switch to");
});

async function chatChart(chart: Record<string, unknown>) {
  const { default: ChatChartCard } = await import("../src/components/chat/ChatChartCard");
  return renderToStaticMarkup(createElement(ChatChartCard, { chart: { scopeLabel: "testtest", xKey: "label", metric: "word_count", ...chart } as never }));
}

test("each chat chart gets the form its data needs", async () => {
  const words = Array.from({ length: 5 }, (_, index) => ({ label: `Paper ${index}`, words: 5000 + index * 900, paperId: `p${index}` }));
  assert.match(await chatChart({ chartType: "bar", title: "Words per paper", yKeys: ["words"], data: words }), /data-chart="bars"/);
  assert.match(await chatChart({ chartType: "table", title: "t", yKeys: ["words"], data: words }), /data-chart="table"/);
  assert.match(await chatChart({ chartType: "line", title: "t", yKeys: ["Median participants"], data: [{ label: "2020", "Median participants": 40 }, { label: "2022", "Median participants": 55 }] }), /data-chart="line"/);
  assert.match(await chatChart({ chartType: "bar", title: "t", yKeys: ["Median"], data: [{ label: "2020", Median: 4 }, { label: "2021", Median: 6 }] }), /data-chart="columns"/, "years are columns");
  assert.match(await chatChart({ chartType: "bar", title: "t", yKeys: ["Introduction", "Methods"], stacked: true, data: [{ label: "A", Introduction: 500, Methods: 900 }] }), /data-chart="stacked"/);
  assert.match(await chatChart({ chartType: "bar", title: "t", yKeys: ["Pre-test", "Post-test"], data: [{ label: "Group A", "Pre-test": 12.4, "Post-test": 17.9 }] }), /data-chart="grouped"/);
  const parts = (count: number) => Array.from({ length: count }, (_, index) => ({ label: `Part ${index}`, Papers: count - index }));
  assert.match(await chatChart({ chartType: "pie", title: "t", yKeys: ["Papers"], data: parts(4) }), /data-chart="pie"/);
  assert.match(await chatChart({ chartType: "pie", title: "t", yKeys: ["Papers"], data: parts(9) }), /data-chart="bars"/, "a pie of nine is drawn as bars");
});

test("bars that are papers take their research area's colour, with a legend", async () => {
  const data = [
    { label: "Paper A", words: 9000, paperId: "a" },
    { label: "Paper B", words: 7000, paperId: "b" },
    { label: "Paper C", words: 5000, paperId: "c" },
  ];
  const html = await chatChart({ chartType: "bar", title: "Words per paper", yKeys: ["words"], data, groups: { label: "Research area", byPaper: { a: "Assessment", b: "Instruction", c: "Assessment" } } });
  assert.match(html, /aria-label="Legend"/);
  assert.match(html, />Assessment</);
  assert.match(html, />Instruction</);
  assert.match(html, /background-color:#2a78d6/, "the first area's colour");
  assert.match(html, /background-color:#d95926/, "the second's");
  // Without areas, one colour for every bar.
  const plain = await chatChart({ chartType: "bar", title: "Words per paper", yKeys: ["words"], data });
  assert.doesNotMatch(plain, /aria-label="Legend"/);
  assert.doesNotMatch(plain, /data-bar="true"[^>]*style="[^"]*background/, "no colour written in");
  assert.ok((plain.match(/data-bar="true" class="[^"]*bg-accent/g) ?? []).length === 3, "each bar in the accent");
});

test("answers counted by papers are squares out of the papers that state one", async () => {
  const html = await chatChart({
    chartType: "bar",
    title: "Where the studies were conducted",
    metric: "reported_value",
    yKeys: ["Papers"],
    data: [{ label: "Thailand", Papers: 3 }, { label: "China", Papers: 1 }],
    sources: [1, 2, 3, 4].map((n) => ({ paperId: `p${n}`, title: `Paper ${n}`, year: "2023", value: "x", quote: "" })),
  });
  assert.match(html, /Papers, out of the 4 that state it/);
  assert.match(html, /data-units="true"/);
});
