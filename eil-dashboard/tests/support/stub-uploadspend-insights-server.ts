/*
 * src/lib/insights/server.ts for upload-spend-behaviour-routes.test.ts: the
 * insights of a fixed 30-paper collection instead of a repository's dashboard,
 * and no plan cache. Everything the routes do with them runs as written.
 */
import { buildInsightCorpus } from "../../src/lib/insights/corpus";
import { buildInsightReport } from "../../src/lib/insights/engine";
import type { BuiltInsights } from "../../src/lib/insights/server";
import type { CategoryAssignmentRow, TrendRow } from "../../src/types/database";

function collection() {
  const trends: TrendRow[] = [];
  const categoryAssignments: CategoryAssignmentRow[] = [];
  const add = (paper: number, year: number, topic: string, kind: "topic" | "method" = "topic") =>
    trends.push({ paper_id: String(paper), year: String(year), title: `Paper ${paper}`, topic, topic_kind: kind, keyword: topic.toLowerCase(), keyword_frequency: 1, evidence: "" });
  for (let paper = 1; paper <= 30; paper += 1) {
    const year = paper <= 15 ? 2012 + (paper % 6) : 2019 + (paper % 6);
    add(paper, year, paper % 3 === 0 ? "Reading" : paper % 3 === 1 ? "Vocabulary" : "Speaking");
    if ([2, 5, 8, 11, 20, 23].includes(paper)) add(paper, year, "Writing");
    if ([2, 5, 8, 11, 20, 26].includes(paper)) add(paper, year, "Feedback");
    if ([16, 18, 21, 24, 27, 29].includes(paper)) add(paper, year, "Mixed methods", "method");
    const assessment = paper % 5 === 0;
    categoryAssignments.push({
      paper_id: String(paper),
      year: String(year),
      title: `Paper ${paper}`,
      category_key: assessment ? "lae" : "eli",
      category_label: assessment ? "Assessment" : "Instruction",
      assignment_type: "single",
    });
  }
  return { trends, categoryAssignments, classificationEnabled: true };
}

export async function buildInsightsForRequest(): Promise<BuiltInsights> {
  const corpus = buildInsightCorpus(collection());
  return {
    report: buildInsightReport(corpus),
    context: { categories: ["Assessment", "Instruction"], selection: "the whole repository" },
    corpus,
    dataHash: "fixed-collection",
    filterHash: "fixed-collection",
  };
}

export async function readCachedPlan(): Promise<null> {
  return null;
}

export async function writeCachedPlan(): Promise<void> {}
