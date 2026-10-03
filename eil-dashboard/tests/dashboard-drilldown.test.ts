import assert from "node:assert/strict";
import test from "node:test";
import { keywordPaperCounts, themePaperCounts, themePapersByYear } from "../src/lib/dashboard-analytics";
import { explicitDrilldownIds, idsKey, keywordKey, markPaperIds, paperIdsByKeywordKey } from "../src/lib/dashboard-drilldown";
import type { TrendRow } from "../src/types/database";

/** A dashboard drilldown lists exactly the papers counted in what was clicked (docs/32, 2.8). */

const row = (paper_id: string, topic: string, keyword: string, year: string) =>
  ({ paper_id, topic, keyword, year, title: `Paper ${paper_id}`, keyword_frequency: 1 }) as unknown as TrendRow;

// A paper spelling a keyword two ways, papers whose rows disagree on nothing, a theme across years.
const TRENDS = [
  row("1", "Feedback", "Peer feedback", "2020"),
  row("1", "Feedback", "peer  feedback", "2020"),
  row("2", "Feedback", "Peer feedback", "2021"),
  row("3", "Writing", "accuracy", "2021"),
  row("3", "Feedback", "teacher feedback", "2021"),
];

test("every cell of the theme-by-year chart carries the papers it counts", () => {
  const rows = themePapersByYear(TRENDS, ["Feedback", "Writing"], ["2020", "2021"]);
  for (const entry of rows) {
    for (const theme of ["Feedback", "Writing"]) {
      const ids = entry[idsKey(theme)] as string[];
      assert.equal(ids.length, entry[theme], `${theme} ${entry.year}`);
    }
  }
  assert.deepEqual((rows[1][idsKey("Feedback")] as string[]).sort(), ["2", "3"]);
});

test("a keyword chip lists the papers its count folds together", () => {
  const byKey = paperIdsByKeywordKey(TRENDS);
  for (const count of keywordPaperCounts(TRENDS)) {
    assert.deepEqual([...(byKey.get(keywordKey(count.keyword)) ?? [])].sort(), [...count.paperIds].sort(), count.keyword);
  }
  assert.deepEqual([...(byKey.get(keywordKey("PEER feedback")) ?? [])].sort(), ["1", "2"]);
  // Themes already carried their ids.
  for (const theme of themePaperCounts(TRENDS)) assert.equal(theme.paperIds.length, theme.papers);
});

test("a clicked mark's ids are found however Recharts passes the row", () => {
  assert.deepEqual(markPaperIds({ topic: "T", paperIds: ["1", 2] }), ["1", "2"]);
  assert.deepEqual(markPaperIds({ payload: { topic: "T", paperIds: ["3"] } }), ["3"]);
  assert.deepEqual(markPaperIds({ year: "2021", [idsKey("EL")]: ["4"] }, "EL"), ["4"]);
  assert.equal(markPaperIds({ year: "2021" }, "EL"), undefined);
  assert.equal(markPaperIds(null), undefined);
});

test("the chart's ids are the list, limited to the papers in view", () => {
  const inView = new Set(["1", "2", "3"]);
  assert.deepEqual([...explicitDrilldownIds({ paperIds: ["2", "3", "gone"] }, inView)!], ["2", "3"]);
  assert.equal(explicitDrilldownIds({ paperIds: [] }, inView), null);
  assert.equal(explicitDrilldownIds({}, inView), null);
  // The dashboard listing exactly these, and every chart handing them over, run in
  // small-fixes2-behaviour-dashboard.test.ts.
});
