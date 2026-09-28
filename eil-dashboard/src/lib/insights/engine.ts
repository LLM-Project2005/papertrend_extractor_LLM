/*
 * Runs every analysis over the selected papers and ranks what they find.
 * Pure and free: no model, no database. The route adds the model's choice and
 * wording on top, and the page falls back to this alone.
 */
import { ANALYSES } from "@/lib/insights/analyses";
import type { InsightCorpus } from "@/lib/insights/corpus";
import { indexBy } from "@/lib/insights/corpus";
import { MIN_PAPERS } from "@/lib/insights/stats";
import type { Insight, InsightNotice, InsightReport } from "@/lib/insights/types";

/** How many candidates the model is shown; the page shows up to this many too. */
export const MAX_CANDIDATES = 10;

export function buildInsightReport(corpus: InsightCorpus): InsightReport {
  const insights: Insight[] = [];
  for (const analyse of ANALYSES) {
    try {
      const insight = analyse(corpus);
      if (insight && insight.facts.length > 0) insights.push({ ...insight, score: Math.round(insight.score * 1000) / 1000 });
    } catch (error) {
      // One analysis failing must not take the page with it.
      console.warn("insight_analysis_failed", analyse.name, error instanceof Error ? error.message : String(error));
    }
  }
  insights.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const dated = corpus.papers.filter((paper) => paper.year !== null);
  const years = dated.map((paper) => paper.year as number);
  const sharedThemes = [...indexBy(corpus.papers, (paper) => paper.themes).values()].filter((ids) => ids.size >= 2).length;
  const notices: InsightNotice[] = [];
  const total = corpus.papers.length;
  if (corpus.duplicates.length > 0) {
    notices.push({
      id: "duplicates",
      text: `${corpus.duplicates.length === 1 ? "One paper looks like" : `${corpus.duplicates.length} papers look like`} a second upload of another and ${corpus.duplicates.length === 1 ? "is" : "are"} counted once here.`,
    });
  }
  const undated = total - dated.length;
  if (undated > 0) {
    notices.push({
      id: "undated",
      text: `${undated === 1 ? "One paper has" : `${undated} papers have`} no readable publication year, so ${undated === 1 ? "it is" : "they are"} left out of the patterns over time.`,
    });
  }
  const uncertain = dated.filter((paper) => paper.yearConfidence !== null && paper.yearConfidence < 0.7).length;
  if (uncertain > 0) {
    notices.push({
      id: "uncertain_years",
      text: `The year of ${uncertain === 1 ? "one paper" : `${uncertain} papers`} was read with low confidence; check ${uncertain === 1 ? "it" : "them"} in the Library before relying on dates.`,
    });
  }
  if (total < 8) {
    notices.push({
      id: "few_papers",
      text: `Only ${total === 1 ? "one paper is" : `${total} papers are`} selected. A pattern needs at least ${MIN_PAPERS} papers behind it, so widen the filters to see more.`,
    });
  } else if (insights.length === 0) {
    notices.push({
      id: "no_insights",
      text: `No pattern in these ${total} papers has at least ${MIN_PAPERS} papers behind it and holds when any one paper is removed.`,
    });
  }

  return {
    summary: {
      papers: total,
      datedPapers: dated.length,
      firstYear: years.length ? String(Math.min(...years)) : null,
      lastYear: years.length ? String(Math.max(...years)) : null,
      sharedThemes,
      duplicatesCountedOnce: corpus.duplicates.length,
    },
    insights: insights.slice(0, MAX_CANDIDATES),
    notices,
  };
}
