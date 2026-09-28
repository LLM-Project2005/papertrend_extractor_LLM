/*
 * The page's plan: which insights to show, in what order, in whose words.
 *
 * Without a model, code picks the strongest insights and uses their computed
 * sentences. With one, a single small call picks and orders them and writes
 * the titles and takeaways, and `checkPlan` holds every number it writes to
 * the facts it was shown. Anything that fails goes back to the computed text,
 * so a model can make the page better written but never wrong.
 */
import type { ChatMessage } from "@/lib/openai";
import { fixedViewSummary } from "@/lib/insights/fixed-views";
import { allowedFacts, corpusFacts, insightLabels, unbackedClaims } from "@/lib/insights/check";
import type { Insight, InsightPlan, InsightPlanCard, InsightReport } from "@/lib/insights/types";

/** Bumped whenever the prompt or the checks change, so cached plans are rewritten. */
export const INSIGHTS_PROMPT_VERSION = "insights-v1";
export const MAX_CARDS = 5;
const TITLE_MAX = 90;
const TAKEAWAY_MAX = 280;
const HEADLINE_MAX = 100;
const SUMMARY_MAX = 320;
const CAVEAT_MAX = 180;

export interface InsightContext {
  repositoryName?: string | null;
  /** The analysis profile's name, e.g. "English as an International Language". */
  domain?: string | null;
  categories?: string[];
  /** The filters in words, e.g. "years 2022–2025; search 'writing'". */
  selection?: string | null;
}

function computedHeadline(report: InsightReport): string {
  const { papers, firstYear, lastYear } = report.summary;
  const span = firstYear && lastYear ? (firstYear === lastYear ? ` from ${firstYear}` : ` from ${firstYear}–${lastYear}`) : "";
  return `What stands out in these ${papers} papers${span}`;
}

function computedSummary(report: InsightReport): string {
  return report.insights.length
    ? "The strongest patterns in the selected papers, each resting on at least 3 papers and holding when any one of them is removed."
    : "No pattern in the selected papers is strong enough to show yet.";
}

export function computedPlan(report: InsightReport, now = new Date()): InsightPlan {
  return {
    headline: computedHeadline(report),
    summary: computedSummary(report),
    cards: report.insights.slice(0, MAX_CARDS).map((insight) => ({
      insightId: insight.id,
      title: insight.question,
      takeaway: insight.takeaway,
    })),
    caveats: [],
    source: "computed",
    generatedAt: now.toISOString(),
  };
}

/* ------------------------------------------------------------ the prompt */

function candidateForPrompt(insight: Insight) {
  return {
    id: insight.id,
    question: insight.question,
    kind: insight.family,
    papers: insight.paperIds.length,
    basis: insight.basis,
    facts: Object.fromEntries(insight.facts.map((fact) => [fact.id, `${fact.value}${fact.unit === "percent" ? "%" : fact.unit === "ratio" ? "x" : ""} = ${fact.text}`])),
    draft: insight.takeaway,
  };
}

export function buildInsightMessages(report: InsightReport, context: InsightContext): ChatMessage[] {
  const payload = {
    repository: {
      name: context.repositoryName ?? undefined,
      field: context.domain ?? undefined,
      categories: context.categories?.length ? context.categories : undefined,
    },
    selection: {
      description: context.selection || "the whole repository",
      papers: report.summary.papers,
      years: report.summary.firstYear ? `${report.summary.firstYear}–${report.summary.lastYear}` : "none dated",
      duplicate_uploads_counted_once: report.summary.duplicatesCountedOnce || undefined,
    },
    already_on_other_tabs: fixedViewSummary(),
    candidates: report.insights.map(candidateForPrompt),
  };
  return [
    {
      role: "system",
      content:
        "You edit the Insights page of Papertrend, a tool researchers use to understand a collection of academic papers. " +
        "Code has already found every candidate insight and computed its numbers. You choose which to show, order them, and explain them. " +
        "You never compute or invent a number: every number you write must be one of the facts of the insight you are describing, written as digits exactly as given.",
    },
    {
      role: "user",
      content: [
        "Choose the 3 to 5 candidates a researcher in this field would find most useful and least obvious, and call write_insights_page once.",
        "",
        "Rules:",
        "- Lead with the most surprising finding that has solid support. Prefer findings about how the research is changing or what connects to what.",
        "- Do not pick two candidates that make the same point. Fewer strong cards beat padding; if only 1 or 2 are worth showing, show only those.",
        "- A title states the finding in plain words (at most 12 words), not a question and not a chart name.",
        "- A takeaway is 1 or 2 sentences (at most 45 words): what the numbers show, then why it matters to someone studying this field. Use the draft's facts; you may reorder and rephrase.",
        "- Write numbers as digits, only from that candidate's facts (or the selection's paper count and years). No other numbers, no 'twice' or 'half' unless a ratio fact says so.",
        "- Say 'papers', not 'studies', when counting. Associations are not causes: write 'appear together', not 'drives' or 'leads to'.",
        "- The headline (at most 12 words) names the single most important finding. The summary (1 or 2 sentences) says what the page shows overall.",
        "- Caveats: at most 2 short notes on real limits of this data, e.g. a small selection, or duplicate uploads counted once. Omit if none.",
        "",
        JSON.stringify(payload),
      ].join("\n"),
    },
  ];
}

export function insightTool(report: InsightReport) {
  return {
    type: "function",
    function: {
      name: "write_insights_page",
      description: "Choose, order and explain the insights shown on the page.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          headline: { type: "string", description: "The single most important finding, at most 12 words." },
          summary: { type: "string", description: "What the page shows overall, 1 or 2 sentences." },
          cards: {
            type: "array",
            minItems: 1,
            maxItems: MAX_CARDS,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                insight_id: { type: "string", enum: report.insights.map((insight) => insight.id) },
                title: { type: "string" },
                takeaway: { type: "string" },
              },
              required: ["insight_id", "title", "takeaway"],
            },
          },
          caveats: { type: "array", maxItems: 2, items: { type: "string" } },
        },
        required: ["headline", "summary", "cards"],
      },
    },
  };
}

/* ------------------------------------------------------------ the checks */

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Holds a model's plan to the facts. Unknown insights are dropped, and any
 * title, takeaway, headline or summary with a number no fact backs (or over
 * its length) is replaced by the computed text. `corrected` counts the
 * replacements, so a model that keeps getting numbers wrong shows up.
 */
export function checkPlan(raw: unknown, report: InsightReport, model: string, now = new Date()): InsightPlan {
  const fallback = computedPlan(report, now);
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const byId = new Map(report.insights.map((insight) => [insight.id, insight]));
  let corrected = 0;
  const cards: InsightPlanCard[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(value.cards) ? value.cards : []) {
    const card = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const insight = byId.get(clean(card.insight_id));
    if (!insight || seen.has(insight.id) || cards.length >= MAX_CARDS) continue;
    seen.add(insight.id);
    const facts = allowedFacts(insight, report);
    const labels = insightLabels(insight);
    let title = clean(card.title);
    let takeaway = clean(card.takeaway);
    if (!title || title.length > TITLE_MAX || unbackedClaims(title, facts, labels).length > 0) {
      title = insight.question;
      corrected += 1;
    }
    if (!takeaway || takeaway.length > TAKEAWAY_MAX || unbackedClaims(takeaway, facts, labels).length > 0) {
      takeaway = insight.takeaway;
      corrected += 1;
    }
    cards.push({ insightId: insight.id, title, takeaway });
  }
  if (cards.length === 0) return { ...fallback, corrected };

  // The headline and summary may use the facts of any card shown.
  const shown = cards.map((card) => byId.get(card.insightId)!);
  const pageFacts = [...shown.flatMap((insight) => allowedFacts(insight, report)), ...corpusFacts(report)];
  const pageLabels = shown.flatMap(insightLabels);
  let headline = clean(value.headline);
  if (!headline || headline.length > HEADLINE_MAX || unbackedClaims(headline, pageFacts, pageLabels).length > 0) {
    headline = fallback.headline;
    corrected += 1;
  }
  let summary = clean(value.summary);
  if (!summary || summary.length > SUMMARY_MAX || unbackedClaims(summary, pageFacts, pageLabels).length > 0) {
    summary = fallback.summary;
    corrected += 1;
  }
  const caveats = (Array.isArray(value.caveats) ? value.caveats : [])
    .map(clean)
    .filter((caveat) => caveat && caveat.length <= CAVEAT_MAX && unbackedClaims(caveat, pageFacts, pageLabels).length === 0)
    .slice(0, 2);
  return { headline, summary, cards, caveats, source: "model", model, generatedAt: now.toISOString(), corrected };
}
