import assert from "node:assert/strict";
import test from "node:test";
import { TRACK_COLS } from "../src/lib/constants";
import { filterDashboardData } from "../src/lib/dashboard-filters";
import type { CategoryAssignmentRow, DashboardData, TrackRow, TrendRow } from "../src/types/database";

function fixture(paperCount = 25): DashboardData {
  const papers = Array.from({ length: paperCount }, (_, index) => ({
    id: String(index + 1),
    title: `Paper ${index + 1}`,
    year: index % 2 === 0 ? "2024" : "2025",
  }));
  const trends: TrendRow[] = papers.map((paper) => ({
    paper_id: paper.id,
    folder_id: null,
    year: paper.year,
    title: paper.title,
    topic: "Assessment",
    keyword: "feedback",
    keyword_frequency: 1,
    evidence: "",
  }));
  const tracks = papers.map<TrackRow>((paper) => ({
    paper_id: paper.id,
    folder_id: null,
    year: paper.year,
    title: paper.title,
    el: paper.id === "1" ? 1 : 0,
    eli: 0,
    lae: 0,
    other: paper.id === "1" ? 0 : 1,
  }));
  const categoryAssignments: CategoryAssignmentRow[] = [{
    paper_id: "1",
    folder_id: null,
    year: "2024",
    title: "Paper 1",
    taxonomy_name: "EIL Tracks",
    category_key: "el",
    category_label: "English Linguistics",
    assignment_type: "single",
    is_other: false,
    rationale: "Current-profile classification",
    position: 0,
  }];
  return {
    trends,
    tracksSingle: tracks,
    tracksMulti: tracks,
    categoryAssignments,
    topicFamilies: [],
    useMock: false,
  };
}

const EIL_CATEGORY_KEYS = ["el", "eli", "lae", "other"];

test("show all keeps older and unclassified repository papers visible", () => {
  const filtered = filterDashboardData(fixture(), [], [...TRACK_COLS], "", EIL_CATEGORY_KEYS);
  assert.equal(new Set(filtered.tracksSingle.map((row) => row.paper_id)).size, 25);
  assert.equal(new Set(filtered.trends.map((row) => row.paper_id)).size, 25);
  assert.equal(filtered.categoryAssignments?.length ?? 0, 1);
});

test("empty category selection is also repository-wide", () => {
  const filtered = filterDashboardData(fixture(), [], [], "", EIL_CATEGORY_KEYS);
  assert.equal(new Set(filtered.tracksSingle.map((row) => row.paper_id)).size, 25);
});

test("an explicit category selection narrows to matching current-profile papers", () => {
  const filtered = filterDashboardData(fixture(), [], ["el"], "", EIL_CATEGORY_KEYS);
  assert.deepEqual([...new Set(filtered.tracksSingle.map((row) => row.paper_id))], ["1"]);
  assert.deepEqual([...new Set(filtered.trends.map((row) => row.paper_id))], ["1"]);
});

test("selecting every current category is equivalent to show all", () => {
  const filtered = filterDashboardData(fixture(), [], EIL_CATEGORY_KEYS, "", EIL_CATEGORY_KEYS);
  assert.equal(new Set(filtered.tracksSingle.map((row) => row.paper_id)).size, 25);
});
